import { InvalidToken, verifyLogoutToken } from "@/lib/iden";
import { endIdenSession, errorMessage } from "@/lib/session";

/**
 * OpenID Connect Back-Channel Logout. IDEN's server, not a browser, POSTs here
 * when an IDEN session ends: the person signed out, or ended the session from
 * another device, changed their password, or was deactivated. There is no
 * cookie and no CSRF token; the signed logout token is the proof.
 */
export async function POST(request: Request) {
  let token = "";
  try {
    token = String((await request.formData()).get("logout_token") ?? "");
  } catch {}
  if (!token) return reply(400, "invalid_request", "Expected a form body with logout_token.");

  try {
    const claims = await verifyLogoutToken(token);
    endIdenSession({ sid: claims.sid, sub: claims.sub });
  } catch (error) {
    if (error instanceof InvalidToken) return reply(400, "invalid_request", error.message);
    // IDEN's keys or discovery could not be fetched; not the sender's fault.
    return reply(503, "temporarily_unavailable", errorMessage(error));
  }
  return reply(200);
}

// Section 2.8: no caching, and an error body when the token is refused.
function reply(status: number, error?: string, description?: string) {
  const body = error ? JSON.stringify({ error, error_description: description }) : null;
  return new Response(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(body && { "Content-Type": "application/json" }) },
  });
}
