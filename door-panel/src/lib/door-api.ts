// The door controller's decision. This is the "API" half of the sample: it sees
// only a Bearer access token, validates it offline against IDEN's keys, and
// never looks up a person, a role, or a group. It shares nothing with the panel
// but configuration; it would work the same as a separate service.

import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTPayload } from "jose";
import { BUILDING_AUDIENCE, FACE_ACR, FACE_MAX_AGE, ISSUER } from "./config";
import { doorById } from "./doors";

export type Verdict = { status: number; body: Record<string, unknown>; wwwAuthenticate?: string };

const SAFE_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"];

const cache = globalThis as typeof globalThis & {
  doorApiKeys?: { at: number; algorithms: string[]; keys: ReturnType<typeof createRemoteJWKSet> };
};

/** IDEN's keys, from discovery, kept for five minutes (jose refetches on an unknown kid). */
async function keys() {
  if (cache.doorApiKeys && Date.now() - cache.doorApiKeys.at < 300_000) return cache.doorApiKeys;
  const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`discovery answered HTTP ${response.status}`);
  const meta = await response.json();
  if (meta.issuer !== ISSUER) throw new Error(`discovery names issuer ${meta.issuer}`);
  const algorithms = (meta.id_token_signing_alg_values_supported ?? []).filter((a: string) =>
    SAFE_ALGORITHMS.includes(a),
  );
  cache.doorApiKeys = { at: Date.now(), algorithms, keys: createRemoteJWKSet(new URL(meta.jwks_uri)) };
  return cache.doorApiKeys;
}

/** RFC 6750 Section 3: a challenge, with quotes and backslashes kept out of the values. */
function challenge(params: Record<string, string | number>) {
  const parts = Object.entries(params).map(([k, v]) =>
    typeof v === "number" ? `${k}=${v}` : `${k}="${v.replace(/["\\]/g, "'")}"`,
  );
  return ["Bearer realm=\"building\"", ...parts].join(", ");
}

function refuse(status: number, error: string, description: string, extra: Record<string, string | number> = {}): Verdict {
  return {
    status,
    body: { error, error_description: description, ...extra },
    wwwAuthenticate: challenge({ error, error_description: description, ...extra }),
  };
}

export async function decide(authorization: string | null, doorId: string): Promise<Verdict> {
  const door = doorById(doorId);
  if (!door) return { status: 404, body: { error: "not_found", error_description: "There is no such door." } };

  const [scheme, token] = (authorization ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    // RFC 6750 Section 3.1: no error code when no credentials were sent at all.
    return { status: 401, body: { error: "unauthorized" }, wwwAuthenticate: challenge({}) };
  }

  let trusted;
  try {
    trusted = await keys();
  } catch (error) {
    // IDEN could not be asked for its keys: not the caller's fault.
    return { status: 503, body: { error: "temporarily_unavailable", error_description: String(error) } };
  }

  let claims: JWTPayload & Record<string, any>;
  try {
    // RFC 9068: an access token says it is one. An ID token, signed by the same
    // key, must not open doors.
    const typ = String(decodeProtectedHeader(token).typ ?? "").toLowerCase();
    if (typ !== "at+jwt" && typ !== "application/at+jwt") throw new Error(`Not an access token (typ ${typ || "none"}).`);
    ({ payload: claims } = await jwtVerify(token, trusted.keys, {
      algorithms: trusted.algorithms,
      issuer: ISSUER,
      // Without this, any valid IDEN token would do, including one issued to
      // some other API.
      audience: BUILDING_AUDIENCE,
      clockTolerance: 30,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
    }));
  } catch (error) {
    if (error instanceof errors.JWKSTimeout) {
      return { status: 503, body: { error: "temporarily_unavailable", error_description: error.message } };
    }
    return refuse(401, "invalid_token", error instanceof Error ? error.message : String(error));
  }

  const scopes = String(claims.scope ?? "").split(" ");
  if (!scopes.includes(door.scope)) {
    return refuse(403, "insufficient_scope", `This badge does not open the ${door.name.toLowerCase()}.`, {
      scope: door.scope,
    });
  }

  if (door.face) {
    const faceUsed = claims.acr === FACE_ACR && Array.isArray(claims.amr) && claims.amr.includes("face");
    const recent = typeof claims.auth_time === "number" && Date.now() / 1000 - claims.auth_time <= FACE_MAX_AGE;
    if (!faceUsed || !recent) {
      // RFC 9470: the client sends the person back to sign in as asked, then retries.
      return refuse(
        403,
        "insufficient_user_authentication",
        faceUsed ? "The face check is too old." : "This door needs a face check.",
        { acr_values: FACE_ACR, max_age: FACE_MAX_AGE },
      );
    }
  }

  return { status: 200, body: { door: door.id, opened: true, sub: claims.sub, acr: claims.acr ?? null } };
}
