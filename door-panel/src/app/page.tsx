// The panel. The server works out who is signed in and which doors their
// token names; the doors themselves (taps, animations, polling) are in panel.tsx.
// Tokens never reach the browser: only decoded claims are shown, in the drawer.

import { redirect } from "next/navigation";
import { scopesOf } from "@/lib/badge";
import { BUILDING_AUDIENCE, CLIENT_ID, FACE_MAX_AGE, IDLE_SECONDS, ISSUER } from "@/lib/config";
import { DOORS } from "@/lib/doors";
import { loadSession, now, type Session } from "@/lib/session";
import { Panel } from "./panel";

export default async function Page() {
  const session = await loadSession();
  if (!session) redirect("/session");

  const flash = session.flash;
  session.flash = null;
  const autoOpen = session.autoOpen;
  session.autoOpen = null;

  const badge = session.badge;
  const held = scopesOf(badge);
  const claims = badge?.idClaims;
  const person = claims && {
    name: String(claims.name ?? claims.preferred_username ?? claims.email ?? "Signed in"),
    picture: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : undefined,
  };

  return (
    <>
      <Panel
        csrf={session.csrf}
        person={person ?? null}
        doors={DOORS.map((d) => ({ id: d.id, name: d.name, face: !!d.face, onBadge: held.includes(d.scope) }))}
        flash={flash}
        autoOpen={autoOpen}
        idleSeconds={IDLE_SECONDS}
      />
      <Drawer session={session} held={held} />
    </>
  );
}

function Drawer({ session, held }: { session: Session; held: string[] }) {
  const badge = session.badge;
  const access = badge?.accessClaims;
  const ago = (ts?: number) => (typeof ts === "number" ? `${Math.max(0, Math.round(now() - ts))}s ago` : "—");

  return (
    <details className="drawer">
      <summary>How it works</summary>
      <div className="drawer-grid">
        <section className="card explain">
          <h2>What you are looking at</h2>
          <ol className="beats">
            <li className="beat" style={{ background: "var(--yellow)" }}>
              <b>Ask for every door</b>
              <span>IDEN hands back only the ones your roles allow.</span>
            </li>
            <li className="beat" style={{ background: "var(--blue)" }}>
              <b>Colour is a hint</b>
              <span>
                Every tap is checked by the door API: for <code>{BUILDING_AUDIENCE}</code>, with the door&apos;s scope.
              </span>
            </li>
            <li className="beat" style={{ background: "var(--pink)" }}>
              <b>Access removed?</b>
              <span>Gone on the next tap.</span>
            </li>
            <li className="beat" style={{ background: "var(--green)" }}>
              <b>Access added?</b>
              <span>
                A silent trip back to IDEN: <code>prompt=none</code>.
              </span>
            </li>
            <li className="beat" style={{ background: "var(--lavender)" }}>
              <b>The vault wants a face</b>
              <span>From the last {FACE_MAX_AGE / 60} minutes, or back to IDEN.</span>
            </li>
            <li className="beat" style={{ background: "var(--card)" }}>
              <b>Signed out anywhere?</b>
              <span>The doors lock in seconds.</span>
            </li>
          </ol>
          <dl className="facts">
            <div>
              <dt>Issuer</dt>
              <dd>{ISSUER}</dd>
            </div>
            <div>
              <dt>Client</dt>
              <dd>{CLIENT_ID}</dd>
            </div>
          </dl>
        </section>

        {badge && access && (
          <section className="card">
            <h2>This badge</h2>
            <div className="chips">
              {DOORS.map((d) => (
                <span key={d.id} className={`chip-static ${held.includes(d.scope) ? "yes" : "no"}`}>
                  {held.includes(d.scope) ? "✓" : "✕"} <code>{d.scope}</code>
                </span>
              ))}
            </div>
            <dl className="kv">
              <dt>acr</dt>
              <dd>
                <code>{String(access.acr ?? "—")}</code>
              </dd>
              <dt>amr</dt>
              <dd>
                <code>{Array.isArray(access.amr) ? access.amr.join(", ") : "—"}</code>
              </dd>
              <dt>Signed in</dt>
              <dd>{ago(access.auth_time)}</dd>
              <dt>Token issued</dt>
              <dd>{ago(access.iat)}</dd>
              <dt>aud</dt>
              <dd>
                <code>{[access.aud].flat().join(", ")}</code>
              </dd>
            </dl>
          </section>
        )}
      </div>
    </details>
  );
}
