import { assurance, InvalidToken, OAuthFailure, peek, tokenRequest, userinfo, verifyIdToken } from "@/lib/iden";
import { action, backHome, errorMessage } from "@/lib/session";

export const POST = action(async (session) => {
  const result = session.result;
  const refreshToken = result?.tokens?.refresh_token;
  if (!result?.idToken || !refreshToken) return backHome(session, "error", "No refresh token. Request offline_access.");
  try {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (tokens.id_token) {
      // OIDC Core Section 12.2: same person, and the nonce (if any) unchanged.
      const idToken = await verifyIdToken(tokens.id_token, result.nonce, false);
      if (idToken.claims.sub !== result.idToken.claims.sub) {
        throw new InvalidToken("Refreshed ID token names a different sub.");
      }
      result.idToken = idToken;
      result.assurance = assurance(result.request.acr_values ?? "", idToken.claims);
    }
    result.tokens = tokens;
    result.accessToken = peek(tokens.access_token);
    result.userinfo = await userinfo(tokens.access_token, result.idToken.claims.sub!);
  } catch (error) {
    if (error instanceof OAuthFailure) {
      return backHome(session, "error", `Refresh refused: ${error.error} — ${error.description}`);
    }
    return backHome(session, "error", `Refresh failed: ${errorMessage(error)}`);
  }
  return backHome(session, "ok", "Refreshed. The refresh token was rotated — the old one is spent.");
});
