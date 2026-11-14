import { NextResponse } from "next/server";
import { ISSUER } from "@/lib/config";

const CSP = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:", // the `picture` claim
  // The forms end in a redirect to IDEN, which form-action covers.
  `form-action 'self' ${new URL(ISSUER).origin}`,
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  // The callback URL carries an authorization code. Never leak it onward.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
