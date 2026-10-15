// Talking to IDEN: discovery, the token endpoint, ID token validation, userinfo.

import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";
import { ACR_LEVELS, CLIENT_ID, CLIENT_SECRET, ISSUER } from "./config";
import type { Assurance, Claims, Decoded, Userinfo } from "./session";

/** IDEN could not be reached, or answered in a way we refuse to trust. */
export class ProviderError extends Error {}

/** IDEN refused a token request. */
export class OAuthFailure extends Error {
  constructor(
    public error: string,
    public description = "",
  ) {
    super(error);
  }
}

/** The ID token failed a check. */
export class InvalidToken extends Error {}

// Asymmetric only: a symmetric algorithm would let anyone holding the public
// key — everyone — forge a token.
const SAFE_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"];

export type Metadata = Record<string, string> & {
  acr_values_supported?: string[];
  id_token_signing_alg_values_supported: string[];
};

// Shared across route bundles, like the sessions.
const cache = globalThis as typeof globalThis & {
  idenMetadata?: { value: Metadata; at: number };
  idenJwks?: { uri: string; keys: ReturnType<typeof createRemoteJWKSet> };
};

function call(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
}

/** The discovery document, cached for five minutes. */
export async function metadata(): Promise<Metadata> {
  if (cache.idenMetadata && Date.now() - cache.idenMetadata.at < 300_000) return cache.idenMetadata.value;
  let value: Metadata;
  try {
    const response = await call(`${ISSUER}/.well-known/openid-configuration`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    value = await response.json();
  } catch (error) {
    throw new ProviderError(`Could not read IDEN's discovery document: ${(error as Error).message}`);
  }
  // OIDC Discovery Section 4.3: the document must name the issuer we trust.
  if (value.issuer !== ISSUER) {
    throw new ProviderError(`Discovery says the issuer is "${value.issuer}", but IDEN_ISSUER is "${ISSUER}".`);
  }
  cache.idenMetadata = { value, at: Date.now() };
  return value;
}

/** IDEN's keys. jose refetches them when a token names a `kid` it hasn't seen. */
function jwks(uri: string) {
  if (cache.idenJwks?.uri !== uri) cache.idenJwks = { uri, keys: createRemoteJWKSet(new URL(uri)) };
  return cache.idenJwks.keys;
}

/**
 * client_secret_basic for a confidential client; client_id alone otherwise.
 * RFC 6749 Section 2.3.1 form-encodes both halves before Basic encoding them.
 */
function clientAuth(body: URLSearchParams): Record<string, string> {
  if (!CLIENT_SECRET) {
    body.set("client_id", CLIENT_ID);
    return {};
  }
  const pair = `${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent(CLIENT_SECRET)}`;
  return { Authorization: `Basic ${Buffer.from(pair).toString("base64")}` };
}

/** A POST to one of IDEN's client-authenticated endpoints. */
export async function clientPost(endpoint: string, data: Record<string, string>) {
  const body = new URLSearchParams(data);
  const headers = clientAuth(body);
  return call(endpoint, { method: "POST", headers, body });
}

export async function tokenRequest(data: Record<string, string>): Promise<Record<string, string>> {
  const meta = await metadata();
  const response = await clientPost(meta.token_endpoint, data);
  const text = await response.text();
  let body: Record<string, string> = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (response.status !== 200) {
    throw new OAuthFailure(body.error ?? `http_${response.status}`, body.error_description ?? text.slice(0, 300));
  }
  return body;
}

/** Every check OIDC Core Section 3.1.3.7 asks of a client. */
export async function verifyIdToken(raw: string, nonce: string, nonceRequired = true): Promise<Decoded> {
  const meta = await metadata();
  try {
    const header = decodeProtectedHeader(raw);
    // An access or logout token is signed by the same key; refuse them by kind.
    const typ = String(header.typ ?? "JWT").toLowerCase();
    if (typ === "at+jwt" || typ === "logout+jwt") throw new InvalidToken(`Not an ID token (typ ${header.typ}).`);

    const { payload, protectedHeader } = await jwtVerify<Claims>(raw, jwks(meta.jwks_uri), {
      algorithms: meta.id_token_signing_alg_values_supported.filter((a) => SAFE_ALGORITHMS.includes(a)),
      audience: CLIENT_ID,
      issuer: ISSUER,
      clockTolerance: 30,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
    });
    if ("events" in payload) throw new InvalidToken("A logout token is not an ID token.");
    if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== CLIENT_ID) {
      throw new InvalidToken("azp does not name this client.");
    }
    if ("nonce" in payload || nonceRequired) {
      const got = Buffer.from(String(payload.nonce ?? ""));
      const sent = Buffer.from(nonce);
      if (!nonce || got.length !== sent.length || !timingSafeEqual(got, sent)) {
        throw new InvalidToken("nonce does not match the one we sent.");
      }
    }
    return { header: protectedHeader, claims: payload };
  } catch (error) {
    throw error instanceof InvalidToken ? error : new InvalidToken((error as Error).message);
  }
}

/**
 * An access token's contents, for display only. It is addressed to APIs, which
 * validate it — this application never trusts what it says.
 */
export function peek(raw: string): Decoded {
  try {
    return { header: decodeProtectedHeader(raw), claims: decodeJwt(raw) };
  } catch {
    return { header: {}, claims: { note: "Not a JWT." } };
  }
}

export async function userinfo(accessToken: string, sub: string): Promise<Userinfo> {
  const meta = await metadata();
  const response = await call(meta.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { body: text.slice(0, 300) };
  }
  const result: Userinfo = { status: response.status, body };
  if (response.status === 200 && (body as { sub?: string })?.sub !== sub) {
    // OIDC Core Section 5.3.2: otherwise the response may describe someone else.
    result.warning = "sub does not match the ID token — do not use these claims.";
  }
  const challenge = response.headers.get("www-authenticate");
  if (challenge) result.wwwAuthenticate = challenge;
  return result;
}

/** Did the sign-in reach the level we asked for? */
export function assurance(requested: string, claims: Claims): Assurance {
  const levels = Object.keys(ACR_LEVELS);
  const received = String(claims.acr ?? "");
  const wanted = requested.split(" ").filter((v) => levels.includes(v));
  let met: boolean | null = null;
  if (wanted.length && levels.includes(received)) {
    met = levels.indexOf(received) >= Math.min(...wanted.map((v) => levels.indexOf(v)));
  } else if (wanted.length) {
    met = false;
  }
  return { requested, received, met, amr: claims.amr ?? [], authTime: claims.auth_time };
}
