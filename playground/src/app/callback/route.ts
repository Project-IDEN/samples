import type { NextRequest } from "next/server";
import { ERROR_HINTS, ISSUER, PENDING_TTL, REDIRECT_URI } from "@/lib/config";
import { assurance, InvalidToken, OAuthFailure, peek, tokenRequest, userinfo, verifyIdToken } from "@/lib/iden";
import { backHome, errorMessage, loadSession, newSession, now, type Result } from "@/lib/session";

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
      newSession(response).flash = ["error", "Unknown or expired state. Start again."];
      return response;
    }
    return backHome(session, "error", "Unknown or expired state. Nothing was exchanged; start again.");
  }

  const result: Result = { request: pending.params, authorizeUrl: pending.url, nonce: pending.nonce, at: now() };
  session.result = result;

  // RFC 9207: IDEN names itself on every response. A different (or missing)
  // issuer means the response came from somewhere we did not send the person.
  if (query.get("iss") !== ISSUER) {
    result.error = {
      error: "issuer_mismatch",
      description: `Callback iss was "${query.get("iss")}", expected "${ISSUER}".`,
    };
    return backHome(session);
  }

  const error = query.get("error");
  if (error) {
    result.error = { error, description: query.get("error_description") ?? "", hint: ERROR_HINTS[error] };
    return backHome(session);
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code: query.get("code") ?? "",
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    });
    const idToken = await verifyIdToken(tokens.id_token ?? "", pending.nonce);
    result.tokens = tokens;
    result.idToken = idToken;
    result.accessToken = peek(tokens.access_token);
    result.assurance = assurance(pending.params.acr_values ?? "", idToken.claims);
    result.userinfo = await userinfo(tokens.access_token, idToken.claims.sub!);
  } catch (error) {
    if (error instanceof OAuthFailure) result.error = { error: error.error, description: error.description };
    else if (error instanceof InvalidToken) result.error = { error: "invalid_id_token", description: error.message };
    else result.error = { error: "provider_error", description: errorMessage(error) };
  }
  // Redirect so the code leaves the address bar and a reload cannot replay it.
  return backHome(session);
}
