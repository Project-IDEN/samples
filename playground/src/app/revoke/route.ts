import { clientPost, metadata } from "@/lib/iden";
import { action, backHome, errorMessage, field } from "@/lib/session";

export const POST = action(async (session, form) => {
  const which = field(form, "which");
  const token = session.result?.tokens?.[which];
  if (!["access_token", "refresh_token"].includes(which) || !token) {
    return backHome(session, "error", "Nothing to revoke.");
  }
  try {
    const meta = await metadata();
    const response = await clientPost(meta.revocation_endpoint, { token, token_type_hint: which });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    return backHome(session, "error", `Revocation failed: ${errorMessage(error)}`);
  }
  const followUp = which === "access_token" ? "Call userinfo" : "Refresh";
  return backHome(session, "ok", `Revoked the ${which.replace("_", " ")}. ${followUp} to watch IDEN refuse it.`);
});
