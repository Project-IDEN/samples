// One server-rendered page. Every button is a plain HTML form posting to a
// route handler, so tokens never reach the browser's JavaScript.

import { redirect } from "next/navigation";
import {
  ACR_LEVELS,
  AMR_NAMES,
  CLIENT_ID,
  CLIENT_SECRET,
  ISSUER,
  OIDC_SCOPES,
  PROMPTS,
  REDIRECT_URI,
} from "@/lib/config";
import { metadata, type Metadata } from "@/lib/iden";
import { errorMessage, loadSession, type Result } from "@/lib/session";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const when = (ts?: number) =>
  ts ? new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";

export default async function Page() {
  const session = await loadSession();
  if (!session) redirect("/session");

  let meta: Metadata | null = null;
  let providerError = "";
  try {
    meta = await metadata();
  } catch (error) {
    providerError = errorMessage(error);
  }

  const flash = session.flash;
  session.flash = null;
  const { form, result, csrf } = session;
  const advertised = meta?.acr_values_supported ?? [];
  const chosenScopes = form.scope ?? ["openid", "profile", "email"];

  return (
    <>
      <header className="top">
        <h1>
          <span className="mark">IDEN</span> OIDC Playground
        </h1>
        <dl className="facts">
          <div>
            <dt>Issuer</dt>
            <dd>{ISSUER}</dd>
          </div>
          <div>
            <dt>Client</dt>
            <dd>
              {CLIENT_ID} <span className="tag">{CLIENT_SECRET ? "confidential" : "public"}</span>
            </dd>
          </div>
          <div>
            <dt>Redirect URI</dt>
            <dd>{REDIRECT_URI}</dd>
          </div>
        </dl>
      </header>

      {flash && (
        <p className={`banner ${flash[0]}`} role="status">
          {flash[1]}
        </p>
      )}
      {providerError && (
        <p className="banner error" role="alert">
          <strong>Can&apos;t reach IDEN.</strong> {providerError}
        </p>
      )}

      <main className="layout">
        <form className="card request" method="post" action="/authorize">
          <input type="hidden" name="csrf" value={csrf} />

          <h2>
            <span className="step">1</span> Assurance <code>acr_values</code>
          </h2>
          <p className="muted">
            The minimum sign-in strength to demand. If the current session falls short, IDEN steps the person up.
          </p>
          <div className="tiles">
            <label className="tile">
              <input type="radio" name="acr_values" value="" defaultChecked={!form.acr_values} />
              <span className="tile-body">
                <strong>No demand</strong>
                <span>Whatever the session already has</span>
                <code>—</code>
              </span>
            </label>
            {Object.entries(ACR_LEVELS).map(([value, [label, detail]]) => (
              <label key={value} className={`tile ${value.endsWith("mfa-face") ? "tile-face" : ""}`}>
                <input type="radio" name="acr_values" value={value} defaultChecked={form.acr_values === value} />
                <span className="tile-body">
                  <strong>{label}</strong>
                  <span>{detail}</span>
                  <code>{value}</code>
                  {meta && !advertised.includes(value) && <em className="tag warn">not advertised</em>}
                </span>
              </label>
            ))}
          </div>

          <h2>
            <span className="step">2</span> Scopes <code>scope</code>
          </h2>
          <div className="chips">
            {Object.entries(OIDC_SCOPES).map(([value, detail]) => (
              <label key={value} className="chip" title={detail}>
                <input
                  type="checkbox"
                  name="scope"
                  value={value}
                  defaultChecked={value === "openid" || chosenScopes.includes(value)}
                  disabled={value === "openid"}
                />
                <span>{value}</span>
              </label>
            ))}
          </div>
          <p className="muted small">
            OpenID Connect scopes only. <code>openid</code> is always sent.
          </p>

          <details className="advanced" open={Boolean(form.prompt || form.max_age || form.login_hint)}>
            <summary>
              <span className="step">3</span> Advanced
            </summary>
            <div className="fields">
              <label>
                <span>prompt</span>
                <select name="prompt" defaultValue={form.prompt ?? ""}>
                  {PROMPTS.map((p) => (
                    <option key={p} value={p}>
                      {p || "(none sent)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  max_age <small>seconds</small>
                </span>
                <input
                  type="text"
                  name="max_age"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 0 or 300"
                  defaultValue={form.max_age ?? ""}
                />
              </label>
              <label>
                <span>login_hint</span>
                <input
                  type="text"
                  name="login_hint"
                  maxLength={254}
                  autoComplete="off"
                  placeholder="someone@example.org"
                  defaultValue={form.login_hint ?? ""}
                />
              </label>
            </div>
            <p className="muted small">
              <code>prompt=login</code> forces a fresh sign-in. <code>max_age=0</code> does too. <code>prompt=none</code>{" "}
              never shows a page and fails instead.
            </p>
          </details>

          <button className="btn primary" type="submit" disabled={!meta}>
            Sign in with IDEN →
          </button>
        </form>

        <section className="results">
          <Results result={result} csrf={csrf} />
        </section>
      </main>

      <footer className="foot">
        {meta && (
          <>
            Discovery: <code>acr_values_supported</code>
            {advertised.map((v) => (
              <code key={v} className="pill">
                {v}
              </code>
            ))}
            {!advertised.includes("urn:iden:acr:mfa-face") && <span className="tag warn">biometric module off</span>}
          </>
        )}
      </footer>
    </>
  );
}

function Results({ result, csrf }: { result: Result | null; csrf: string }) {
  if (!result) {
    return (
      <div className="card empty">
        <h2>No sign-in yet</h2>
        <ol className="flow">
          <li>Pick an assurance level and scopes.</li>
          <li>IDEN asks for whatever is missing: a password, then a code or your face.</li>
          <li>The playground exchanges the code (PKCE), verifies the ID token and shows what came back.</li>
        </ol>
        <p className="muted small">
          To test biometrics, choose <code>urn:iden:acr:mfa-face</code>. The account needs an enrolled face, and IDEN
          needs <code>IDEN_BIOMETRIC_ENABLED=true</code>.
        </p>
      </div>
    );
  }

  if (result.error || !result.idToken || !result.tokens || !result.assurance) {
    const error = result.error ?? { error: "unknown_error" };
    return (
      <>
        <div className="card verdict bad">
          <p className="eyebrow">IDEN said no</p>
          <h2>
            <code>{error.error}</code>
          </h2>
          {error.description && <p>{error.description}</p>}
          {error.hint && <p className="hint">{error.hint}</p>}
          <PostButton action="/clear" csrf={csrf}>
            Dismiss
          </PostButton>
        </div>
        <details className="card raw" open>
          <summary>Authorization request</summary>
          <pre>{pretty(result.request)}</pre>
        </details>
      </>
    );
  }

  const a = result.assurance;
  const { header, claims } = result.idToken;
  const tokens = result.tokens;
  const userinfo = result.userinfo;
  const verdict = a.met === null ? "neutral" : a.met ? "good" : "bad";
  const initial = String(claims.name || claims.preferred_username || "?").slice(0, 1).toUpperCase();

  return (
    <>
      <div className={`card verdict ${verdict}`}>
        <p className="eyebrow">
          {a.met === null
            ? "Signed in. No level was demanded"
            : a.met
              ? "Requested level reached"
              : "Below the requested level"}
        </p>
        <div className="acr-pair">
          <div>
            <span className="label">Requested</span>
            <code>{a.requested || "—"}</code>
          </div>
          <div className="arrow" aria-hidden="true">
            →
          </div>
          <div>
            <span className="label">
              Received <code>acr</code>
            </span>
            <code className="big">{a.received || "—"}</code>
          </div>
        </div>
        <div className="amr">
          <span className="label">
            Methods used <code>amr</code>
          </span>
          {a.amr.map((m) => (
            <span key={m} className={`chip-static ${m === "face" ? "face" : ""}`}>
              {AMR_NAMES[m] ?? m} <code>{m}</code>
            </span>
          ))}
        </div>
        <p className="small">Authenticated {when(a.authTime)}</p>
      </div>

      <div className="card who">
        {claims.picture ? (
          <img src={claims.picture} alt="" width={72} height={72} />
        ) : (
          <div className="avatar" aria-hidden="true">
            {initial}
          </div>
        )}
        <dl>
          {claims.name && (
            <div>
              <dt>name</dt>
              <dd>{claims.name}</dd>
            </div>
          )}
          {claims.preferred_username && (
            <div>
              <dt>preferred_username</dt>
              <dd>{claims.preferred_username}</dd>
            </div>
          )}
          {claims.email && (
            <div>
              <dt>email</dt>
              <dd>
                {claims.email} {claims.email_verified && <span className="tag ok">verified</span>}
              </dd>
            </div>
          )}
          <div>
            <dt>sub</dt>
            <dd>
              <code>{claims.sub}</code>
            </dd>
          </div>
          <div>
            <dt>scope granted</dt>
            <dd>
              <code>{tokens.scope}</code>
            </dd>
          </div>
        </dl>
      </div>

      <div className="card actions">
        <PostButton
          action="/refresh"
          csrf={csrf}
          disabled={!tokens.refresh_token}
          title={tokens.refresh_token ? undefined : "Request offline_access to get a refresh token"}
        >
          Refresh tokens
        </PostButton>
        <PostButton action="/userinfo" csrf={csrf}>
          Call userinfo
        </PostButton>
        <PostButton action="/revoke" csrf={csrf} which="access_token">
          Revoke access token
        </PostButton>
        <PostButton action="/revoke" csrf={csrf} which="refresh_token" disabled={!tokens.refresh_token}>
          Revoke refresh token
        </PostButton>
        <PostButton action="/logout" csrf={csrf} danger>
          Sign out everywhere
        </PostButton>
      </div>

      <details className="card raw" open>
        <summary>
          ID token <span className="tag ok">verified</span>
        </summary>
        <ul className="checks">
          <li>
            Signature against IDEN&apos;s JWKS (<code>kid</code> {header.kid}, <code>{header.alg}</code>)
          </li>
          <li>
            <code>iss</code> is {ISSUER}
          </li>
          <li>
            <code>aud</code> is {CLIENT_ID}
          </li>
          <li>
            <code>nonce</code> matches the one we sent
          </li>
          <li>
            Not expired: <code>exp</code> {when(claims.exp)}
          </li>
        </ul>
        <pre>{pretty(claims)}</pre>
      </details>

      {userinfo && (
        <details className="card raw">
          <summary>
            Userinfo <span className={`tag ${userinfo.status === 200 ? "ok" : "warn"}`}>{userinfo.status}</span>
          </summary>
          {userinfo.warning && <p className="banner error">{userinfo.warning}</p>}
          {userinfo.wwwAuthenticate && (
            <p className="small">
              <code>WWW-Authenticate: {userinfo.wwwAuthenticate}</code>
            </p>
          )}
          <pre>{pretty(userinfo.body)}</pre>
        </details>
      )}

      {result.accessToken && (
        <details className="card raw">
          <summary>
            Access token <span className="tag">decoded, not verified</span>
          </summary>
          <p className="muted small">Addressed to APIs, which verify it. An application never trusts what it says.</p>
          <pre>{pretty(result.accessToken.header)}</pre>
          <pre>{pretty(result.accessToken.claims)}</pre>
        </details>
      )}

      <details className="card raw">
        <summary>Token response</summary>
        <pre className="wrap">{pretty(tokens)}</pre>
      </details>

      <details className="card raw">
        <summary>Authorization request</summary>
        <pre>{pretty(result.request)}</pre>
      </details>
    </>
  );
}

function PostButton(props: {
  action: string;
  csrf: string;
  which?: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form method="post" action={props.action}>
      <input type="hidden" name="csrf" value={props.csrf} />
      {props.which && <input type="hidden" name="which" value={props.which} />}
      <button className={props.danger ? "btn danger" : "btn"} type="submit" disabled={props.disabled} title={props.title}>
        {props.children}
      </button>
    </form>
  );
}
