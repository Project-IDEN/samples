import type { NextRequest } from "next/server";
import { makeBadge, scopesOf } from "@/lib/badge";
import { ISSUER, PENDING_TTL, REDIRECT_URI } from "@/lib/config";
import { DOORS } from "@/lib/doors";
import { InvalidToken, OAuthFailure, tokenRequest } from "@/lib/iden";
import { backHome, errorMessage, loadSession, newSession, now, signOut } from "@/lib/session";

// What an error back from IDEN means for a door panel.
const HINTS: Record<string, string> = {
  unmet_authentication_requirements:
    "No face is enrolled for this person, or biometrics are off in IDEN. Enrol the face at a kiosk first.",
  access_denied: "Sign-in was cancelled.",
  consent_required: "IDEN wants consent for the new doors. Register the panel with consent skipped, or sign in again.",
  interaction_required: "IDEN needs the person to do something on its pages. Sign in again.",
};

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const state = query.get("state") ?? "";
  const session = await loadSession();
  const pending = session?.pending[state];
  if (session) delete session.pending[state];

  if (!session || !pending || now() - pending.at > PENDING_TTL) {
    // Not a response to a request this browser made — possibly an injected
    // code (login CSRF). Nothing is exchanged.
    if (!session) {
      const response = backHome(null);
      newSession(response).flash = ["error", "Unknown or expired sign-in. Start again."];
      return response;
    }
    return backHome(session, "error", "Unknown or expired sign-in. Nothing was exchanged; start again.");
  }

  // RFC 9207: IDEN names itself on every response, errors included.
  if (query.get("iss") !== ISSUER) {
    return backHome(session, "error", `The sign-in came back from "${query.get("iss")}", not ${ISSUER}.`);
  }

  const error = query.get("error");
  if (error) {
    // A silent check found no IDEN session at all: whoever was here is gone.
    if (pending.silent && error === "login_required") {
      signOut(session, ["locked", "Badge deactivated. You are no longer signed in to IDEN."]);
      return backHome(session);
    }
    const description = query.get("error_description");
    return backHome(session, "error", HINTS[error] ?? `${error}${description ? `: ${description}` : ""}`);
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code: query.get("code") ?? "",
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    });
    const badge = await makeBadge(tokens, pending.nonce);
    session.badge = badge;
  } catch (error) {
    if (error instanceof OAuthFailure) return backHome(session, "error", `${error.error}: ${error.description}`);
    if (error instanceof InvalidToken) return backHome(session, "error", `Refused the ID token: ${error.message}`);
    return backHome(session, "error", errorMessage(error));
  }

  const held = scopesOf(session.badge);
  if (!DOORS.some((d) => held.includes(d.scope))) {
    session.flash = ["error", "Signed in, but IDEN put no doors on this badge. Check the person's groups, and that the panel's client may grant the building scopes."];
  }
  if (pending.door) session.autoOpen = { door: pending.door, after: pending.silent ? "silent" : "face" };
  // Redirect so the code leaves the address bar and a reload cannot replay it.
  return backHome(session);
}
