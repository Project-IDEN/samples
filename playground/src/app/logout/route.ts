import { NextResponse } from "next/server";
import { CLIENT_ID, POST_LOGOUT_REDIRECT_URI } from "@/lib/config";
import { metadata } from "@/lib/iden";
import { action, backHome, errorMessage } from "@/lib/session";

/**
 * Forget the tokens here, then end the IDEN session too.
 *
 * A GET redirect rather than a POST form: IDEN's session cookie is
 * SameSite=Lax, which a browser only sends cross-site on a top-level GET.
 */
export const POST = action(async (session) => {
  const idToken = session.result?.tokens?.id_token;
  session.result = null;
  session.pending = {};
  let meta;
  try {
    meta = await metadata();
  } catch (error) {
    return backHome(session, "error", `Signed out here, but not of IDEN: ${errorMessage(error)}`);
  }
  const params = new URLSearchParams({ client_id: CLIENT_ID, post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI });
  if (idToken) params.set("id_token_hint", idToken);
  session.flash = ["ok", "Signed out of the playground and of IDEN."];
  return NextResponse.redirect(`${meta.end_session_endpoint}?${params}`, 303);
});
