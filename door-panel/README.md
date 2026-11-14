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

## The demo, in under a minute

1. **"This is Alice. She works in the lab."** Sign in as `alice`. The lobby and lab are green, the
   server room and vault are hatched. Tap the server room: it shakes, *access denied*.
2. **"Security gives her the server room."** In the IDEN dashboard, add Alice to **IT team**. Tap
   the server room again: a moment of *checking your badge with IDEN*, then it opens. Nothing was
   redeployed.
3. **"And takes it away again."** Remove her from **IT team** and wait ten seconds. Tap: denied.
4. **"The vault needs more than a badge."** Sign in as `carol`, tap the vault, and IDEN asks for
   her face. Back on the panel, the vault opens.
5. **"Sign out anywhere, and the doors lock."** Sign out of the IDEN dashboard in the same browser.
   Within two seconds the panel slams every door shut: *Badge deactivated*.

Open **How it works** under the doors for the details: this person's scopes, `acr` / `amr`, the
last request to the door API with its status and `WWW-Authenticate`, and both tokens decoded.

A panel nobody touches for a minute signs out of the panel and of IDEN, so at a booth the next
person never inherits the last one's session.

## Run it

You need a running IDEN that the panel's server and your browser can both reach at its issuer URL,
and that can reach the panel at `DOOR_PANEL_URL` to deliver back-channel logout. See the
[IDEN quick start](https://github.com/Project-IDEN/iden#quick-start).

### 1. Set it up in IDEN

`scripts/seed.mjs` creates everything through IDEN's admin API: the **building** API and its four
door scopes, a role and a group per door, the demo people `alice`, `bob`, `carol` and `dave`, and
the panel's client. It can be run again safely; whatever already exists is kept and brought into
line.

```bash
IDEN_ISSUER=https://iden.example.com \
DOOR_PANEL_URL=http://doors.example.com:5200 \
ADMIN_TOKEN=<an administrator's access token> \
DEMO_PASSWORD=<12+ characters, optional> \
node scripts/seed.mjs
```

It prints the client secret and the demo passwords once. Then enrol Carol's face at a kiosk, or
the vault cannot open for anyone.

<details>
<summary>What it registers for the client</summary>

| Field | Value |
|---|---|
| Client ID | `door-panel` |
| Type | **Confidential** (codes are exchanged and tokens refreshed on the server) |
| Grants | `authorization_code`, `refresh_token` |
| Redirect URI | `DOOR_PANEL_URL/callback` |
| Post-logout redirect URI | `DOOR_PANEL_URL/` |
| Back-channel logout URI | `DOOR_PANEL_URL/backchannel-logout` |
| Skip consent | **On.** A first-party panel, and the silent re-check below has no page to ask on |
| Grantable scopes | The four door scopes |

</details>

### 2. Configure and start

```bash
cp .env.example .env    # IDEN_ISSUER, DOOR_PANEL_URL, DOOR_PANEL_CLIENT_SECRET
docker compose up --build -d
```

Open `DOOR_PANEL_URL`. Without Docker:

```bash
pnpm install
IDEN_ISSUER=http://localhost:8000 DOOR_PANEL_CLIENT_SECRET=... pnpm dev
```

| Variable | Default | Purpose |
|---|---|---|
| `IDEN_ISSUER` | *(required)* | IDEN's issuer URL. Must match IDEN's `IDEN_ISSUER` exactly |
| `DOOR_PANEL_URL` | *(required)* | Where browsers reach the panel, and IDEN's server reaches its back-channel URL |
| `DOOR_PANEL_CLIENT_ID` | `door-panel` | The client the seed registered |
| `DOOR_PANEL_CLIENT_SECRET` | *(required)* | Its secret |
| `BUILDING_AUDIENCE` | `https://building.example/doors` | The building API's audience. Must match the seed |
| `DOOR_PANEL_IDLE_SECONDS` | `60` | Sign out after this long untouched. `0` turns it off |
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
└── scripts/seed.mjs             # sets IDEN up
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
