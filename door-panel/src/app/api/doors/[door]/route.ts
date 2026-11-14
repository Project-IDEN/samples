import { decide } from "@/lib/door-api";

/**
 * The door controller API. Open a door by presenting an access token for the
 * building audience that carries the door's scope. Callers are servers, not
 * browsers: there is no cookie here and no session.
 */
export async function POST(request: Request, context: { params: Promise<{ door: string }> }) {
  const { door } = await context.params;
  const verdict = await decide(request.headers.get("authorization"), door);
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (verdict.wwwAuthenticate) headers["WWW-Authenticate"] = verdict.wwwAuthenticate;
  return Response.json(verdict.body, { status: verdict.status, headers });
}
