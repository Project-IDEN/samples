import { NextResponse } from "next/server";
import { startSignIn } from "@/lib/badge";
import { action, backHome, errorMessage } from "@/lib/session";

/** "Sign in with IDEN". Every sign-in asks for every door; IDEN trims the token. */
export const POST = action(async (session) => {
  try {
    return NextResponse.redirect(await startSignIn(session), 303);
  } catch (error) {
    return backHome(session, "error", errorMessage(error));
  }
});
