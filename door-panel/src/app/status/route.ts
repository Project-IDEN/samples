import { loadSession } from "@/lib/session";

/**
 * Polled by the panel every few seconds. Cheap — it reads memory only — and
 * it is how a sign-out that happened elsewhere (back-channel logout) reaches
 * the screen without a reload.
 */
export async function GET() {
  const session = await loadSession();
  return Response.json({ signedIn: !!session?.badge }, { headers: { "Cache-Control": "no-store" } });
}
