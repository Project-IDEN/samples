import { userinfo } from "@/lib/iden";
import { action, backHome, errorMessage } from "@/lib/session";

export const POST = action(async (session) => {
  const result = session.result;
  if (!result?.tokens || !result.idToken) return backHome(session, "error", "Sign in first.");
  try {
    result.userinfo = await userinfo(result.tokens.access_token, result.idToken.claims.sub!);
  } catch (error) {
    return backHome(session, "error", `Userinfo failed: ${errorMessage(error)}`);
  }
  return backHome(session, "ok", `Userinfo answered ${result.userinfo.status}.`);
});
