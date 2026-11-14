import { NextResponse } from "next/server";
import { CLIENT_ID, POST_LOGOUT_REDIRECT_URI } from "@/lib/config";
import { metadata } from "@/lib/iden";
import { action, backHome, errorMessage, signOut } from "@/lib/session";

/**
 * Sign out here and of IDEN, which in turn tells every other application this
 * session reached (back-channel logout). The panel's idle timer posts here too:
 * on a shared screen, the next person must not inherit the last one's IDEN
 * session.
 *
 * A GET redirect rather than a POST form: IDEN's session cookie is
 * SameSite=Lax, which a browser only sends cross-site on a top-level GET.
 */
export const POST = action(async (session, form) => {
  const idToken = session.badge?.tokens.id_token;
  const idle = form.get("reason") === "idle";
  signOut(session, ["ok", idle ? "Signed out after a minute untouched." : "Signed out of the panel and of IDEN."]);
  session.pending = {};
  let meta;
  try {
    meta = await metadata();
  } catch (error) {
    return backHome(session, "error", `Signed out here, but not of IDEN: ${errorMessage(error)}`);
  }
  const params = new URLSearchParams({ client_id: CLIENT_ID, post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI });
  if (idToken) params.set("id_token_hint", idToken);
  return NextResponse.redirect(`${meta.end_session_endpoint}?${params}`, 303);
});
