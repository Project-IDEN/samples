// A person's "badge" is the set of tokens IDEN issued them. Getting one,
// renewing it, and asking IDEN again when access may have changed.

import { createHash } from "node:crypto";
import { CLIENT_ID, FACE_ACR, FACE_MAX_AGE, MAX_PENDING, PENDING_TTL, REDIRECT_URI } from "./config";
import { REQUESTED_SCOPES } from "./doors";
import { InvalidToken, metadata, OAuthFailure, peek, tokenRequest, verifyIdToken } from "./iden";
import { type Badge, now, randomToken, type Session, signOut } from "./session";

type SignInOptions = {
  /** Open this door when the person comes back. */
  door?: string;
  /** prompt=none: no page is shown; IDEN answers from the session it already has. */
  silent?: boolean;
  /** Ask for a face, within the last FACE_MAX_AGE seconds. */
  face?: boolean;
};

/** The authorization URL to send the browser to, with its state remembered. */
export async function startSignIn(session: Session, options: SignInOptions = {}): Promise<string> {
  const meta = await metadata();
  const verifier = randomToken(64);
  const state = randomToken();
  const nonce = randomToken();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: REQUESTED_SCOPES.join(" "),
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  if (options.silent) params.set("prompt", "none");
  if (options.face) {
    params.set("acr_values", FACE_ACR);
    params.set("max_age", String(FACE_MAX_AGE));
  }

  // One browser may start several attempts; keep the newest few, briefly.
  const t = now();
  const recent = Object.entries(session.pending)
    .filter(([, p]) => t - p.at < PENDING_TTL)
    .sort(([, a], [, b]) => a.at - b.at)
    .slice(-(MAX_PENDING - 1));
  session.pending = Object.fromEntries(recent);
  session.pending[state] = { verifier, nonce, at: t, door: options.door, silent: options.silent };
  return `${meta.authorization_endpoint}?${params}`;
}

/** Turn a token response into a badge, checking the ID token on the way. */
export async function makeBadge(tokens: Record<string, string>, nonce: string, previous?: Badge): Promise<Badge> {
  if (!tokens.access_token) throw new InvalidToken("No access token in the response.");
  const idToken = await verifyIdToken(tokens.id_token ?? "", nonce, !previous);
  // OIDC Core Section 12.2: a refreshed ID token names the same person.
  if (previous && idToken.claims.sub !== previous.idClaims.sub) {
    throw new InvalidToken("Refreshed ID token names a different sub.");
  }
  const access = peek(tokens.access_token);
  return {
    tokens: {
      access_token: tokens.access_token,
      // Rotated on every refresh; the old one is spent.
      refresh_token: tokens.refresh_token ?? previous?.tokens.refresh_token,
      id_token: tokens.id_token,
    },
    idClaims: idToken.claims,
    nonce,
    accessHeader: access.header,
    accessClaims: access.claims,
    obtainedAt: now(),
  };
}

/**
 * Ask IDEN for a fresh access token. IDEN works out the scopes again on every
 * refresh, so access taken away since sign-in is gone from the new token.
 * (Access *added* since sign-in is not: a refresh never grows past what the
 * sign-in granted. That takes a new authorization; see the silent sign-in.)
 *
 * "ended": IDEN refused the refresh token, so the IDEN session is over and the
 * panel signs out.
 */
export async function refreshBadge(session: Session): Promise<"ok" | "ended" | "none"> {
  const badge = session.badge;
  const refreshToken = badge?.tokens.refresh_token;
  if (!badge || !refreshToken) return "none";
  try {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    session.badge = await makeBadge(tokens, badge.nonce, badge);
    return "ok";
  } catch (error) {
    if (error instanceof OAuthFailure && error.error === "invalid_grant") {
      signOut(session, ["locked", "Badge deactivated. IDEN no longer accepts this sign-in."]);
      return "ended";
    }
    throw error;
  }
}

export function scopesOf(badge: Badge | null): string[] {
  return String(badge?.accessClaims.scope ?? "").split(" ").filter(Boolean);
}
