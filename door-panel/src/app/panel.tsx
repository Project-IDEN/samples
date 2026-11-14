"use client";

// The doors on screen. Every decision is made on the server; this file only
// asks, animates the answer, notices a sign-out that happened elsewhere, and
// signs an idle panel out.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoOpen, Flash } from "@/lib/session";

type DoorView = { id: string; name: string; face: boolean; onBadge: boolean };
type Moment = "idle" | "busy" | "open" | "denied" | "error";
type Outcome =
  | { outcome: "open" | "denied" | "signed-out" | "expired" }
  | { outcome: "recheck" | "face"; url: string }
  | { outcome: "error"; message: string };

const POLL_MS = 2000;
const WARN_SECONDS = 10;

export function Panel(props: {
  csrf: string;
  person: { name: string; picture?: string } | null;
  doors: DoorView[];
  flash: Flash | null;
  autoOpen: AutoOpen | null;
  idleSeconds: number;
}) {
  const { csrf, person, doors, autoOpen, idleSeconds } = props;
  const router = useRouter();
  const [moments, setMoments] = useState<Record<string, { moment: Moment; note?: string }>>({});
  const [modal, setModal] = useState<null | { kind: "face"; door: string; url: string } | { kind: "recheck" }>(null);
  const [locked, setLocked] = useState(false);
  const [left, setLeft] = useState(idleSeconds);
  const logoutForm = useRef<HTMLFormElement>(null);
  const logoutReason = useRef<HTMLInputElement>(null);
  const lastActive = useRef(Date.now());
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const show = useCallback((door: string, moment: Moment, note?: string, ms = 0) => {
    clearTimeout(timers.current[door]);
    setMoments((m) => ({ ...m, [door]: { moment, note } }));
    if (ms) timers.current[door] = setTimeout(() => setMoments((m) => ({ ...m, [door]: { moment: "idle" } })), ms);
  }, []);

  /** The doors slam shut, then the page reloads to the sign-in screen. */
  const lockDown = useCallback(() => {
    setModal(null);
    setLocked(true);
    setTimeout(() => window.location.reload(), 2200);
  }, []);

  const tap = useCallback(
    async (door: string, after?: string) => {
      lastActive.current = Date.now();
      show(door, "busy");
      let result: Outcome;
      try {
        const response = await fetch(`/open/${door}${after ? `?after=${after}` : ""}`, {
          method: "POST",
          headers: { "x-csrf": csrf },
        });
        result = await response.json();
      } catch {
        result = { outcome: "error", message: "The panel could not reach its server." };
      }
      switch (result.outcome) {
        case "open":
          show(door, "open", undefined, 3500);
          break;
        case "denied":
          show(door, "denied", undefined, 1800);
          break;
        case "recheck":
          show(door, "busy");
          setModal({ kind: "recheck" });
          setTimeout(() => window.location.assign(result.url), 700);
          return;
        case "face":
          show(door, "idle");
          setModal({ kind: "face", door, url: result.url });
          return;
        case "signed-out":
          lockDown();
          return;
        case "expired":
          window.location.reload();
          return;
        case "error":
          show(door, "error", result.message, 4000);
          break;
      }
      router.refresh(); // the drawer shows the badge as it is now
    },
    [csrf, lockDown, router, show],
  );

  // Back from IDEN (a silent re-check or a face check): try the door again, once.
  const retried = useRef(false);
  useEffect(() => {
    if (autoOpen && !retried.current) {
      retried.current = true;
      void tap(autoOpen.door, autoOpen.after);
    }
  }, [autoOpen, tap]);

  // A sign-out elsewhere reaches the server by back-channel logout; this is
  // how it reaches the screen.
  useEffect(() => {
    if (!person) return;
    const id = setInterval(async () => {
      try {
        const response = await fetch("/status", { cache: "no-store" });
        if (response.ok && !(await response.json()).signedIn) lockDown();
      } catch {}
    }, POLL_MS);
    return () => clearInterval(id);
  }, [person, lockDown]);

  // Sign out a panel nobody is touching.
  useEffect(() => {
    if (!person || !idleSeconds) return;
    const touch = () => {
      lastActive.current = Date.now();
      setLeft(idleSeconds);
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const id = setInterval(() => {
      const remaining = idleSeconds - Math.floor((Date.now() - lastActive.current) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        if (logoutReason.current) logoutReason.current.value = "idle";
        logoutForm.current?.requestSubmit();
      }
    }, 1000);
    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [person, idleSeconds]);

  const flash = props.flash;

  return (
    <main className={`panel ${locked ? "is-locked" : ""}`}>
      <header className="top">
        <h1>
          <img className="logo" src="/icon.svg" alt="" width={48} height={48} />
          <span className="mark">IDEN</span> Door Panel
        </h1>
        {person && (
          <div className="who">
            {person.picture ? (
              <img className="avatar" src={person.picture} alt="" />
            ) : (
              <span className="avatar" aria-hidden>
                {person.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <span className="label">Signed in</span>
              <strong>{person.name}</strong>
            </div>
            <form method="post" action="/logout" ref={logoutForm}>
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="reason" defaultValue="button" ref={logoutReason} />
              <button className="btn danger" type="submit">
                Sign out
              </button>
            </form>
          </div>
        )}
      </header>

      {flash && (
        <p className={`banner ${flash[0]}`} role="status">
          {flash[1]}
        </p>
      )}
      {person && idleSeconds > 0 && left <= WARN_SECONDS && left > 0 && (
        <p className="banner warn" role="status">
          Signing out in {left}… tap anywhere to stay.
        </p>
      )}

      <div className={`doors ${person ? "" : "is-asleep"}`}>
        {doors.map((door) => {
          const { moment, note } = moments[door.id] ?? { moment: "idle" as Moment };
          const kind = !door.onBadge ? "off" : door.face ? "face" : "on";
          return (
            <button
              key={door.id}
              type="button"
              className={`door door-${kind} is-${moment}`}
              onClick={() => tap(door.id)}
              disabled={!person || moment === "busy" || locked}
              aria-live="polite"
            >
              <DoorIcon open={moment === "open"} />
              <span className="door-name">{door.name}</span>
              <span className="door-state">{label(door, moment, note)}</span>
              <span className="door-badge" aria-hidden>
                {moment === "open" ? "✓" : kind === "off" ? "✕" : kind === "face" ? <FaceIcon /> : "✓"}
              </span>
            </button>
          );
        })}

        {!person && (
          <div className="card signin">
            <p className="eyebrow">Building access</p>
            <h2>Who&apos;s there?</h2>
            <p>Sign in, and the doors your badge opens light up.</p>
            <form method="post" action="/authorize">
              <input type="hidden" name="csrf" value={csrf} />
              <button className="btn primary" type="submit">
                Sign in with IDEN
              </button>
            </form>
          </div>
        )}
      </div>

      {modal?.kind === "face" && (
        <div className="overlay" role="dialog" aria-modal aria-labelledby="face-title">
          <div className="card modal">
            <FaceIcon big />
            <h2 id="face-title">The vault wants your face</h2>
            <p>IDEN will look at you through the camera. It takes a few seconds.</p>
            <div className="modal-actions">
              <button className="btn primary" type="button" onClick={() => window.location.assign(modal.url)}>
                Check my face
              </button>
              <button className="btn" type="button" onClick={() => setModal(null)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {modal?.kind === "recheck" && (
        <div className="overlay" role="status">
          <div className="card modal">
            <h2>Checking your badge with IDEN…</h2>
          </div>
        </div>
      )}
      {locked && (
        <div className="overlay lockdown" role="alert">
          <div className="card modal">
            <h2>Badge deactivated</h2>
            <p>IDEN ended this sign-in, so every door is locked.</p>
          </div>
        </div>
      )}
    </main>
  );
}

function label(door: DoorView, moment: Moment, note?: string) {
  if (moment === "busy") return "Checking…";
  if (moment === "open") return "Open — come in";
  if (moment === "denied") return "Access denied";
  if (moment === "error") return note ?? "Something went wrong";
  if (!door.onBadge) return "Not on your badge";
  return door.face ? "On your badge + face" : "On your badge";
}

function DoorIcon({ open }: { open: boolean }) {
  return (
    <svg className="door-icon" viewBox="0 0 64 80" aria-hidden>
      <rect x="6" y="4" width="52" height="72" fill="var(--ink)" />
      {open ? (
        <>
          <rect x="10" y="8" width="44" height="68" fill="var(--bg)" />
          <path d="M10 8 L34 14 L34 74 L10 76 Z" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
          <circle cx="29" cy="44" r="2.5" fill="var(--ink)" />
        </>
      ) : (
        <>
          <rect x="10" y="8" width="44" height="68" fill="var(--card)" stroke="var(--ink)" strokeWidth="3" />
          <rect x="17" y="15" width="30" height="20" fill="none" stroke="var(--ink)" strokeWidth="3" />
          <circle cx="45" cy="46" r="3" fill="var(--ink)" />
        </>
      )}
    </svg>
  );
}

function FaceIcon({ big }: { big?: boolean }) {
  return (
    <svg className={big ? "face-icon big" : "face-icon"} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="9" cy="10" r="1.4" fill="currentColor" />
      <circle cx="15" cy="10" r="1.4" fill="currentColor" />
      <path d="M8.5 15c2 2 5 2 7 0" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
