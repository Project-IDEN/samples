# IDEN Door Panel

A touchscreen panel of doors, for showing IDEN's **access control** without talking about roles,
scopes or tokens. Everyone understands a keycard: yours opens some doors and not others, security
can change which, and the vault wants more than a card.

| Door | Opens for | Scope |
|---|---|---|
| Lobby | Everyone in **Building staff** | `building:lobby:open` |
| Lab | **Lab team** | `building:lab:open` |
| Server room | **IT team** | `building:server-room:open` |
| Vault | **Security team**, with a face check in the last 5 minutes | `building:vault:open` |

Who holds what is decided in IDEN by groups and roles. The panel contains no role checks: it
reads the scopes in the token IDEN gives it, and the door API checks them again.

## The demo, in a couple of minutes

One person, Alice, whose job changes while you watch. You need **two browsers**, or two browser
profiles: the panel signed in as Alice (on a tablet or a second screen), and the IDEN dashboard
signed in as an administrator (on your laptop). A browser holds one IDEN account at a time, so
signing in as Alice next to the admin dashboard would sign the administrator out.

1. **"This is Alice. She has just started."** Sign in to the panel as `alice`. Only the lobby is
   green. Tap the lab: it shakes, *access denied*.
2. **"She joins the lab."** In the dashboard, add Alice to **Lab team**. Tap the lab again: a moment
   of *checking your badge with IDEN*, then it opens. Nothing was redeployed.
3. **"She moves to IT."** Add her to **IT team** and remove her from **Lab team**. Wait ten seconds,
   then tap: the server room opens, the lab is denied.
4. **"Promoted to security. The vault needs more than a badge."** Add her to **Security team** and
   tap the vault. IDEN asks for her face; back on the panel, the vault opens.
5. **"Sign out anywhere, and the doors lock."** In the panel's browser, open the IDEN dashboard (it
   signs in as Alice without asking) and sign out. Within two seconds the panel slams every door
   shut: *Badge deactivated*.

Run `pnpm seed` again afterwards to put Alice back in **Building staff** only.

Open **How it works** under the doors for the details: Alice's scopes, `acr` / `amr`, the last
request to the door API with its status and `WWW-Authenticate`, and both tokens decoded.

A panel nobody touches for a minute signs out of the panel and of IDEN, so at an unattended booth
the next visitor never inherits the last one's session. **For a presented demo, set
`DOOR_PANEL_IDLE_SECONDS=0`**: while you work in the dashboard nobody touches the panel, and it
would sign Alice out halfway through.

## Run it

You need a running IDEN that the panel's server and your browser can both reach at its issuer URL,
and that can reach the panel at `DOOR_PANEL_URL` to deliver back-channel logout. See the
[IDEN quick start](https://github.com/Project-IDEN/iden#quick-start).

All of the panel's settings live in one file, `.env`. `pnpm dev`, `pnpm seed` and
`docker compose` all read it.

### 1. Configure

```bash
cp .env.example .env    # set IDEN_ISSUER and DOOR_PANEL_URL
```

### 2. Set it up in IDEN

`pnpm seed` creates everything through IDEN's admin API: the **building** API and its four door
scopes, a role and a group per door, the demo person `alice` in **Building staff**, and the
panel's client, whose secret it writes into `.env`. It needs Node 22.18 or later, which runs the
panel's TypeScript settings directly, and no `pnpm install`.

It needs an administrator's access token in `.env` as `ADMIN_TOKEN`. Copy one from the IDEN
dashboard: sign in as an administrator, open the browser's developer tools, and run this in the
**Console**:

```js
JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find((k) => k.startsWith("oidc.user:")))).access_token
```

The token lasts ten minutes, so paste a fresh one before each run. Then:

```bash
pnpm seed
```

It prints Alice's password once (set `DEMO_PASSWORD` to choose it). Then enrol the presenter's face
on Alice at a kiosk, or the vault cannot open. An account holds one face, and enrolling again
replaces it, so whoever presents next re-enrols theirs first.

Run it again whenever you like: whatever already exists is kept and brought into line, and Alice
goes back to **Building staff** alone, which resets her between demos.

<details>
<summary>The same, by hand in the dashboard</summary>

Signed in as an administrator, under **Administration**. `DOOR_PANEL_URL` is wherever the panel is
reached.

**1. The building API and its doors.** Under **APIs**, create one:

| Field | Value |
|---|---|
| Name | `building` |
| Audience | `https://building.example/doors` |

Then add a scope for each door:

| Value | What it allows |
|---|---|
| `building:lobby:open` | Open the lobby door. |
| `building:lab:open` | Open the lab. |
| `building:server-room:open` | Open the server room. |
| `building:vault:open` | Open the vault. |

The audience can be any absolute URI. If you choose another, set `BUILDING_AUDIENCE` to it.

**2. A role and a group for each door.** Under **Roles**, then **Groups**:

| Role | Scope | Group (holds the role) |
|---|---|---|
| `building-staff` | `building:lobby:open` | Building staff |
| `lab-researcher` | `building:lab:open` | Lab team |
| `it-technician` | `building:server-room:open` | IT team |
| `security-officer` | `building:vault:open` | Security team |

**3. Alice.** Under **Users**, create `alice` (display name *Alice*) in **Building staff** only.

**4. The panel's client.** Under **Clients**, create one:

| Field | Value |
|---|---|
| Name | Door Panel |
| Client ID | `door-panel` |
| Application type | **Web application** (confidential: codes are exchanged and tokens refreshed on the server) |
| Redirect URIs | `DOOR_PANEL_URL/callback` |
| Post-logout redirect URIs | `DOOR_PANEL_URL/` |
| Scopes, under *What may it ask for?* | The four door scopes. The OpenID ones need no grant |
| Skip the consent screen | **On.** A first-party panel, and the silent re-check below has no page to ask on |
| Back-channel logout URI | `DOOR_PANEL_URL/backchannel-logout`. IDEN's server must be able to reach it |

Copy the client secret into `.env` as `DOOR_PANEL_CLIENT_SECRET`. It is shown only once.

</details>

### 3. Start

```bash
docker compose up --build -d
```

Open `DOOR_PANEL_URL`. Without Docker: `pnpm install && pnpm dev`.

| Variable | Default | Purpose |
|---|---|---|
| `IDEN_ISSUER` | *(required)* | IDEN's issuer URL. Must match IDEN's `IDEN_ISSUER` exactly |
| `DOOR_PANEL_URL` | *(required)* | Where browsers reach the panel, and IDEN's server reaches its back-channel URL |
| `DOOR_PANEL_CLIENT_SECRET` | *(required)* | The client's secret. `pnpm seed` writes it |
| `ADMIN_TOKEN` | — | `pnpm seed` only. An administrator's access token, valid ten minutes |
| `DEMO_PASSWORD` | *(generated)* | `pnpm seed` only. Alice's password when she is created |
| `DOOR_PANEL_IDLE_SECONDS` | `60` | Sign out after this long untouched. `0` turns it off; do that for a presented demo |
| `DOOR_PANEL_CLIENT_ID` | `door-panel` | The panel's client |
| `BUILDING_AUDIENCE` | `https://building.example/doors` | The building API's audience |
| `DOOR_API_URL` | `http://127.0.0.1:5200/api/doors` | Where the panel's server reaches the door API |

## How it works

```
door-panel/
├── src/
│   ├── proxy.ts                 # security headers on every response
│   ├── app/
│   │   ├── page.tsx             # who is signed in, which doors; the "How it works" drawer
│   │   ├── panel.tsx            # the doors: taps, animations, status polling, idle sign-out
│   │   ├── open/[door]/         # a tap: asks the door API, refreshes, re-checks, steps up
│   │   ├── api/doors/[door]/    # the door API: Bearer token in, 200 / 401 / 403 out
│   │   ├── authorize/ callback/ logout/ backchannel-logout/ status/ session/ health/
│   └── lib/
│       ├── doors.ts             # the four doors and their scopes
│       ├── badge.ts             # sign-in, refresh, the silent re-check
│       ├── door-api.ts          # access token validation, used only by the door API
│       ├── iden.ts              # discovery, token endpoint, ID and logout token checks
│       ├── session.ts           # in-memory sessions, CSRF, back-channel session lookup
│       └── config.ts
└── scripts/seed.mjs             # sets IDEN up, from config.ts and doors.ts
```

**Two parts that do not trust each other.** The panel is a confidential OIDC client like the
playground. The door API is a resource server: it receives only `Authorization: Bearer`, and
`door-api.ts` imports nothing from the panel. It runs in the same process to keep the demo to one
container, but the panel reaches it over HTTP exactly as it would a separate service, and
`DOOR_API_URL` can point elsewhere. The API validates offline, against IDEN's published keys:

- the signature, with asymmetric algorithms only;
- `typ` is `at+jwt`, so an ID token, signed by the same key, cannot open a door;
- `iss`, and `aud` is the building's audience, so a token for some other API cannot either;
- the door's scope is in `scope`, or `403 insufficient_scope`;
- for the vault, `acr` is `urn:iden:acr:mfa-face`, `amr` includes `face`, and `auth_time` is
  within five minutes, or `403` with
  `WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="urn:iden:acr:mfa-face", max_age=300`
  ([RFC 9470](https://www.rfc-editor.org/rfc/rfc9470)). The panel answers that by sending the person
  to IDEN with those values, then tries the door again.

**Every sign-in asks for every door.** IDEN grants only what the person's roles and groups allow,
and quietly leaves out the rest. The tiles' colours come from the scopes granted, but they are only
a hint: a tap on a red door still asks the API.

**Why access changes show up straight away.** IDEN works the scopes out again on every token it
issues, but a refresh can only ever *narrow* what the original sign-in granted. So:

- *taken away* — each tap refreshes a token more than ten seconds old, and the new one no longer
  carries the scope;
- *added* — a `403 insufficient_scope` sends the browser to IDEN once more with `prompt=none`. IDEN
  answers from the session it already has, without showing a page, with a fresh grant; the panel
  then tries the door once more and shows the answer, whatever it is.

**Single sign-out, both ways.**

- *Out of the panel:* **Sign out** (or a minute untouched) ends the panel's session and sends the
  browser to IDEN's `end_session_endpoint` with `id_token_hint`, which ends the IDEN session and tells
  every other application it reached.
- *Into the panel:* when an IDEN session ends anywhere — the dashboard, another application, a
  password change, an administrator deactivating the account — IDEN POSTs a logout token to
  `/backchannel-logout`. It is checked as Back-Channel Logout 1.0 asks (signature, `iss`, `aud`,
  `typ` `logout+jwt`, the `events` claim, `sid` or `sub`, no `nonce`, each `jti` once), and every
  panel signed in with that `sid` is signed out. The screen polls `/status` every two seconds, which
  is how the lock-down reaches it.
- A refresh IDEN refuses (`invalid_grant`), or a silent re-check answered `login_required`, also
  locks the panel: either way, IDEN no longer knows this sign-in.

Otherwise it is built like the playground: PKCE, `state` and `nonce` on every request; `iss`
checked on the callback (RFC 9207); the ID token fully validated; tokens kept on the server in
memory behind an `HttpOnly` cookie, so the browser sees decoded claims only; a CSRF token on every
POST; strict headers; a hardened container. Sessions are in memory, so run **one instance**.
