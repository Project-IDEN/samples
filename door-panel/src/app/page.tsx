// The panel. The server works out who is signed in and which doors their
// token names; the doors themselves (taps, animations, polling) are in panel.tsx.
// Tokens never reach the browser: only decoded claims are shown, in the drawer.

import { redirect } from "next/navigation";
import { scopesOf } from "@/lib/badge";
import { BUILDING_AUDIENCE, CLIENT_ID, FACE_MAX_AGE, IDLE_SECONDS, ISSUER } from "@/lib/config";
import { DOORS } from "@/lib/doors";
import { type DoorCall, loadSession, now, type Session } from "@/lib/session";
import { Panel } from "./panel";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

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
          <ol>
            <li>
              Signing in asks IDEN for <em>every</em> door. IDEN gives back a token naming only the doors this
              person&apos;s roles and groups allow. The panel has no idea what a role is.
            </li>
            <li>
              A door&apos;s colour comes from that token, but it is only a hint. Every tap, even on a red door,
              asks the door API, which checks the token itself: signed by IDEN, addressed to{" "}
              <code>{BUILDING_AUDIENCE}</code>, carrying the door&apos;s scope.
            </li>
            <li>
              Access taken away in the dashboard shows up on the next tap: the panel refreshes the token first and
              IDEN works the scopes out again. Access <em>added</em> takes a quick, invisible trip back to IDEN (
              <code>prompt=none</code>), because a refresh never grows past what the sign-in granted.
            </li>
            <li>
              The vault also wants a face check from the last {FACE_MAX_AGE / 60} minutes. The API says so with{" "}
              <code>insufficient_user_authentication</code>, and the panel sends the person back to IDEN for it.
            </li>
            <li>
              Signing out anywhere — the dashboard, another app, a password change — makes IDEN tell the panel
              (back-channel logout), and the doors lock within seconds.
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

        {session.lastCall && <LastCall call={session.lastCall} />}

        {badge && (
          <details className="card raw">
            <summary>
              Access token <span className="tag">decoded</span>
            </summary>
            <p className="muted small">What the door API sees and verifies. The panel never trusts it.</p>
            <pre>{pretty(badge.accessHeader)}</pre>
            <pre>{pretty(badge.accessClaims)}</pre>
          </details>
        )}
        {badge && (
          <details className="card raw">
            <summary>
              ID token <span className="tag">verified</span>
            </summary>
            <p className="muted small">Who signed in, for the panel. Its <code>sid</code> is what back-channel logout names.</p>
            <pre>{pretty(badge.idClaims)}</pre>
          </details>
        )}
      </div>
    </details>
  );
}

function LastCall({ call }: { call: DoorCall }) {
  const good = call.status === 200;
  return (
    <section className={`card ${good ? "call-ok" : "call-bad"}`}>
      <h2>
        Last door request <span className="tag">{call.status}</span>
      </h2>
      <pre className="wrap">
        {`${call.method} ${call.url}\nAuthorization: Bearer <access token>`}
        {call.wwwAuthenticate && `\n\n→ WWW-Authenticate: ${call.wwwAuthenticate}`}
      </pre>
      <pre>{pretty(call.body)}</pre>
      {call.steps.length > 0 && (
        <ul className="steps">
          {call.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
