// Sessions live in this process's memory, so run a single instance. A restart
// signs everyone out of the playground, which for a playground is fine.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { JWTPayload, ProtectedHeaderParameters } from "jose";
import { APP_URL, SECURE } from "./config";

const SESSION_TTL = 60 * 60;
const MAX_SESSIONS = 1000;
export const COOKIE = SECURE ? "__Host-playground" : "playground";

export type Claims = JWTPayload & Record<string, any>;
export type Decoded = { header: ProtectedHeaderParameters; claims: Claims };

export type Pending = {
  verifier: string;
  nonce: string;
  params: Record<string, string>;
  url: string;
  at: number;
};

export type Result = {
  request: Record<string, string>;
  authorizeUrl: string;
  nonce: string;
  at: number;
  error?: { error: string; description?: string; hint?: string };
  tokens?: Record<string, string>;
  idToken?: Decoded;
  accessToken?: Decoded;
  assurance?: Assurance;
  userinfo?: Userinfo;
};

export type Assurance = {
  requested: string;
  received: string;
  met: boolean | null;
  amr: string[];
  authTime?: number;
};

export type Userinfo = {
  status: number;
  body: unknown;
  warning?: string;
  wwwAuthenticate?: string;
};

export type FormState = {
  scope?: string[];
  acr_values?: string;
  prompt?: string;
  max_age?: string;
  login_hint?: string;
};

export type Session = {
  csrf: string;
  seen: number;
  pending: Record<string, Pending>; // state -> request
  result: Result | null;
  flash: ["ok" | "error", string] | null;
  form: FormState; // last request, to prefill
};

// On globalThis: Next bundles each route separately, and they must share one map.
const g = globalThis as typeof globalThis & { playgroundSessions?: Map<string, Session> };
const SESSIONS = (g.playgroundSessions ??= new Map());

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
  const session: Session = { csrf: randomToken(), seen: now(), pending: {}, result: null, flash: null, form: {} };
  SESSIONS.set(sid, session);
  response.cookies.set(COOKIE, sid, {
    maxAge: SESSION_TTL,
    path: "/",
    secure: SECURE,
    httpOnly: true,
    sameSite: "lax",
  });
  return session;
}

/** A 303 back to the page, optionally with a message to show once. */
export function backHome(session: Session | null, kind?: "ok" | "error", message = "") {
  if (session && kind) session.flash = [kind, message];
  return NextResponse.redirect(`${APP_URL}/`, 303);
}

/** Every POST: a live session, and a CSRF token proving the form is ours. */
export function action(handler: (session: Session, form: FormData) => Promise<Response>) {
  return async (request: Request) => {
    const form = await request.formData();
    const session = await loadSession();
    const csrf = Buffer.from(String(form.get("csrf") ?? ""));
    const expected = Buffer.from(session?.csrf ?? "");
    if (!session || csrf.length !== expected.length || !timingSafeEqual(csrf, expected)) {
      return new Response("Session expired. Reload the playground.", { status: 403 });
    }
    return handler(session, form);
  };
}

export function field(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
