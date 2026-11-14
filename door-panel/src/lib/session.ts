// Sessions live in this process's memory, so run a single instance. A restart
// signs everyone out of the panel, which for a demo is fine.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { JWTPayload, ProtectedHeaderParameters } from "jose";
import { APP_URL, SECURE } from "./config";

const SESSION_TTL = 60 * 60;
const MAX_SESSIONS = 1000;
export const COOKIE = SECURE ? "__Host-door-panel" : "door-panel";

export type Claims = JWTPayload & Record<string, any>;

export type Pending = {
  verifier: string;
  nonce: string;
  at: number;
  /** Open this door once the sign-in comes back. */
  door?: string;
  /** A prompt=none round trip to pick up access granted since sign-in. */
  silent?: boolean;
};

/** Everything IDEN gave this person, held on the server. */
export type Badge = {
  tokens: { access_token: string; refresh_token?: string; id_token: string };
  idClaims: Claims;
  /** The sign-in's nonce; a refreshed ID token that carries one must repeat it. */
  nonce: string;
  accessHeader: ProtectedHeaderParameters;
  accessClaims: Claims;
  obtainedAt: number;
};

/** The last request the panel made to the door API, for the "How it works" drawer. */
export type DoorCall = {
  door: string;
  method: string;
  url: string;
  status: number;
  wwwAuthenticate?: string;
  body: unknown;
  at: number;
  steps: string[];
};

/** Why the panel went to IDEN before opening `door`; a second try never goes again. */
export type AutoOpen = { door: string; after: "signin" | "silent" | "face" };

export type Flash = ["ok" | "error" | "locked", string];

export type Session = {
  csrf: string;
  seen: number;
  pending: Record<string, Pending>; // state -> request
  badge: Badge | null;
  flash: Flash | null;
  lastCall: DoorCall | null;
  /** A door to open as soon as the page loads, after a round trip to IDEN. */
  autoOpen: AutoOpen | null;
};

// On globalThis: Next bundles each route separately, and they must share one map.
const g = globalThis as typeof globalThis & { doorPanelSessions?: Map<string, Session> };
const SESSIONS = (g.doorPanelSessions ??= new Map());

export const now = () => Date.now() / 1000;
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export async function loadSession(): Promise<Session | null> {
  const sid = (await cookies()).get(COOKIE)?.value ?? "";
  const session = SESSIONS.get(sid);
  if (!session || now() - session.seen > SESSION_TTL) return null;
  session.seen = now();
  return session;
}

/** A fresh session, with its cookie set on `response`. */
export function newSession(response: NextResponse): Session {
  for (const [sid, s] of SESSIONS) if (now() - s.seen > SESSION_TTL) SESSIONS.delete(sid);
  // Maps iterate in insertion order, so the first key is the oldest session.
  while (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value!);
  const sid = randomToken();
  const session: Session = {
    csrf: randomToken(),
    seen: now(),
    pending: {},
    badge: null,
    flash: null,
    lastCall: null,
    autoOpen: null,
  };
  SESSIONS.set(sid, session);
  response.cookies.set(COOKIE, sid, { maxAge: SESSION_TTL, path: "/", secure: SECURE, httpOnly: true, sameSite: "lax" });
  return session;
}

/** Forget whoever is signed in on this panel. */
export function signOut(session: Session, flash: Flash | null = null) {
  session.badge = null;
  session.lastCall = null;
  session.autoOpen = null;
  session.flash = flash;
}

/**
 * Back-channel logout: lock every panel signed in with the IDEN session that
 * just ended. With `sid`, only that session's sign-ins (and, if `sub` is given
 * too, only that person's); without it, everything `sub` signed in to.
 */
export function endIdenSession({ sid, sub }: { sid?: string; sub?: string }): number {
  let ended = 0;
  for (const session of SESSIONS.values()) {
    const claims = session.badge?.idClaims;
    if (!claims) continue;
    const matches = sid ? claims.sid === sid && (!sub || claims.sub === sub) : claims.sub === sub;
    if (!matches) continue;
    signOut(session, ["locked", "Badge deactivated. IDEN ended your session, so the panel locked."]);
    ended++;
  }
  return ended;
}

/** A 303 back to the panel, optionally with a message to show once. */
export function backHome(session: Session | null, kind?: Flash[0], message = "") {
  if (session && kind) session.flash = [kind, message];
  return NextResponse.redirect(`${APP_URL}/`, 303);
}

function sameToken(given: string, session: Session | null) {
  const a = Buffer.from(given);
  const b = Buffer.from(session?.csrf ?? "");
  return !!session && a.length === b.length && timingSafeEqual(a, b);
}

/** A form POST: a live session, and a CSRF token proving the form is ours. */
export function action(handler: (session: Session, form: FormData) => Promise<Response>) {
  return async (request: Request) => {
    const form = await request.formData();
    const session = await loadSession();
    if (!sameToken(String(form.get("csrf") ?? ""), session)) {
      return new Response("Session expired. Reload the panel.", { status: 403 });
    }
    return handler(session!, form);
  };
}

/** A fetch() from the panel's own script: the CSRF token travels in a header. */
export function jsonAction<P>(handler: (session: Session, params: P, request: Request) => Promise<Response>) {
  return async (request: Request, context: { params: Promise<P> }) => {
    const session = await loadSession();
    if (!sameToken(request.headers.get("x-csrf") ?? "", session)) {
      return Response.json({ outcome: "expired" }, { status: 403 });
    }
    return handler(session!, await context.params, request);
  };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
