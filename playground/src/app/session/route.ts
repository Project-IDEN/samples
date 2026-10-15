import { backHome, newSession } from "@/lib/session";

/** Where the page sends a browser that has no session yet. */
export async function GET() {
  const response = backHome(null);
  newSession(response);
  return response;
}
