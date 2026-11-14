import { refreshBadge, startSignIn } from "@/lib/badge";
import { BADGE_RECHECK_SECONDS, DOOR_API_URL } from "@/lib/config";
import { type Door, doorById } from "@/lib/doors";
import { type DoorCall, errorMessage, jsonAction, now, type Session } from "@/lib/session";

/**
 * A tap on a door. The panel's server asks the door API, with the person's
 * access token, and tells the screen what happened:
 *
 *   open        the API said 200
 *   denied      the API said 403 insufficient_scope, even after asking IDEN again
 *   recheck     go to IDEN silently (prompt=none) to pick up access granted
 *               since sign-in, then try again
 *   face        go to IDEN for a face check (the API said
 *               insufficient_user_authentication), then try again
 *   signed-out  IDEN has ended this sign-in
 *   error       anything else
 *
 * The tile's colour on screen is only a hint. Even a red door is asked for:
 * the API decides, not the panel.
 */
export const POST = jsonAction<{ door: string }>(async (session, params, request) => {
  const door = doorById(params.door);
  if (!door) return Response.json({ outcome: "error", message: "No such door." }, { status: 404 });
  if (!session.badge) return Response.json({ outcome: "signed-out" });
  // Set when the page retries a door after a round trip to IDEN, so it never loops.
  const after = new URL(request.url).searchParams.get("after");
  const steps: string[] = [];

  try {
    // A badge more than a few seconds old is renewed first: IDEN works the
    // scopes out again, so a role taken away in the dashboard is gone now
    // rather than when the access token expires.
    if (now() - session.badge.obtainedAt > BADGE_RECHECK_SECONDS) {
      const renewed = await refreshBadge(session);
      if (renewed === "ended") return Response.json({ outcome: "signed-out" });
      if (renewed === "ok") steps.push("Refreshed the access token first, so IDEN re-checked this person's access.");
    }

    let call = await callDoor(session, door, steps);
    if (call.status === 401 && (await refreshBadge(session)) === "ok") {
      steps.push("The API refused the token (401); refreshed it and tried again.");
      call = await callDoor(session, door, steps);
    }
    if (!session.badge) return Response.json({ outcome: "signed-out" });
    session.lastCall = call;

    const error = (call.body as { error?: string } | null)?.error;
    if (call.status === 200) return Response.json({ outcome: "open" });

    if (error === "insufficient_scope") {
      // A refresh can take access away but never add it: it stays within what
      // the sign-in granted. Access granted since then needs a new
      // authorization, which IDEN answers silently from its session.
      if (after === "silent") return Response.json({ outcome: "denied" });
      steps.push("403 insufficient_scope: asking IDEN again silently (prompt=none) in case access was granted since sign-in.");
      return Response.json({ outcome: "recheck", url: await startSignIn(session, { door: door.id, silent: true }) });
    }

    if (error === "insufficient_user_authentication") {
      if (after === "face") {
        return Response.json({ outcome: "error", message: "The face check did not reach the level the door asks for." });
      }
      steps.push("403 insufficient_user_authentication: sending the person to IDEN for a face check (RFC 9470).");
      return Response.json({ outcome: "face", url: await startSignIn(session, { door: door.id, face: true }) });
    }

    const description = (call.body as { error_description?: string } | null)?.error_description;
    return Response.json({ outcome: "error", message: description ?? `The door API answered ${call.status}.` });
  } catch (error) {
    return Response.json({ outcome: "error", message: errorMessage(error) });
  }
});

/** One request to the door API, exactly as a separate service would receive it. */
async function callDoor(session: Session, door: Door, steps: string[]): Promise<DoorCall> {
  const url = `${DOOR_API_URL}/${door.id}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.badge!.tokens.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { body: text.slice(0, 300) };
  }
  return {
    door: door.id,
    method: "POST",
    url,
    status: response.status,
    wwwAuthenticate: response.headers.get("www-authenticate") ?? undefined,
    body,
    at: now(),
    steps, // the same list: what happens after the call is part of the story too
  };
}
