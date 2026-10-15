# IDEN OIDC Playground

A small web app for trying out IDEN's OpenID Connect sign-in. You pick an assurance level, scopes,
and a few request options. You sign in through IDEN. The playground then shows exactly what came
back: the verified ID token, the `acr` / `amr` it carries, userinfo, the access token, and the raw
token response.

Its main job is to test **step-up and biometric sign-in** with `acr_values`:

| Tile | `acr_values` sent | IDEN asks for |
|---|---|---|
| No demand | — | Whatever the session still owes |
| Single factor | `urn:iden:acr:sfa` | A password |
| Multi-factor | `urn:iden:acr:mfa` | Password + authenticator code **or** face |
| Biometric | `urn:iden:acr:mfa-face` | Password + liveness-checked face |

After each sign-in the playground compares the level it **requested** with the `acr` it
**received**, and lists the methods used (`pwd`, `otp`, `face`, `mfa`).

Only OpenID Connect scopes can be requested: `openid` (always sent), `profile`, `email`,
`offline_access`. IDEN's own API permissions (`admin:*`, `entity:*`, …) are filtered out by the
playground, and also by IDEN, because the client is registered with no grantable scopes.

## Run it

You need a running IDEN that the playground's server and your browser can both reach at its issuer
URL. See the [IDEN quick start](https://github.com/Project-IDEN/iden#quick-start).

### 1. Register the client in IDEN

In the IDEN dashboard, go to **Administration → Clients → New**. `PLAYGROUND_URL` below is wherever
the playground is reached, for example `http://playground.example.com:5100`:

| Field | Value |
|---|---|
| Client ID | `playground` |
| Type | **Confidential** (the playground exchanges the code on its server) |
| Grants | `authorization_code`, `refresh_token` |
| Redirect URI | `PLAYGROUND_URL/callback` |
| Post-logout redirect URI | `PLAYGROUND_URL/` |
| Skip consent | Off, so you can see the consent screen and test `prompt=consent` |
| Scopes | **None.** The OIDC scopes need no grant, and leaving the rest out keeps it OIDC-only |

Copy the client secret. It is shown only once.

<details>
<summary>The same thing with <code>curl</code></summary>

```bash
curl -X POST "$IDEN_ISSUER/admin/clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "playground",
    "name": "OIDC Playground",
    "clientType": "confidential",
    "allowedGrants": ["authorization_code", "refresh_token"],
    "redirectUris": ["'"$PLAYGROUND_URL"'/callback"],
    "postLogoutRedirectUris": ["'"$PLAYGROUND_URL"'/"],
    "skipConsent": false,
    "grantableScopeIds": []
  }'
```

</details>

A **public** client works too. Leave `PLAYGROUND_CLIENT_SECRET` empty and PKCE alone protects the
code.

### 2. Configure and start

```bash
cp .env.example .env              # set IDEN_ISSUER, PLAYGROUND_URL, PLAYGROUND_CLIENT_SECRET
docker compose up --build -d
```

Caddy serves the playground on port **5100**, over plain HTTP. Open `PLAYGROUND_URL`.

### 3. Set up the people you test with

To test a level, the test account must be able to reach it:

- **`mfa`** needs an authenticator app, set up in the dashboard under your account's security
  settings.
- **`mfa-face`** needs IDEN's biometric module (`IDEN_BIOMETRIC_ENABLED=true` plus one of the
  `deploy/docker-compose.engine-*.yml` files) and a face enrolled at a kiosk. When the module is
  off, the footer shows *biometric module off*, because discovery stops advertising
  `urn:iden:acr:mfa-face`.

If an account can't reach the level you asked for, IDEN returns
`unmet_authentication_requirements`. The playground shows that error with a hint about what to set
up.

## Things to try

| Try | Expect |
|---|---|
| Sign in with **Single factor**, then again with **Biometric** | The second sign-in asks only for your face (step-up), and `acr` rises to `mfa-face` |
| **Biometric** with an account that has no face enrolled | `unmet_authentication_requirements` |
| `prompt=none` while signed out | `login_required`, and no page is shown |
| `prompt=consent` | The consent screen, even after you have already agreed |
| `max_age=0` | A fresh sign-in, every time |
| Add `offline_access`, then **Refresh tokens** twice | The refresh token rotates each time |
| **Revoke access token**, then **Call userinfo** | `401` with a `WWW-Authenticate` challenge |
| **Revoke refresh token**, then **Refresh tokens** | `invalid_grant` |
| **Sign out everywhere** | Ends both the playground session and the IDEN session |

## Configuration

All settings are in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `IDEN_ISSUER` | *(required)* | IDEN's issuer URL. The browser signs in there and the server calls it directly. Must match IDEN's `IDEN_ISSUER` exactly |
| `PLAYGROUND_URL` | *(required)* | Where the browser reaches the playground. Redirect URIs are built from it |
| `PLAYGROUND_CLIENT_ID` | `playground` | The client registered in step 1 |
| `PLAYGROUND_CLIENT_SECRET` | *(empty)* | Its secret. Leave empty for a public client |

If `PLAYGROUND_URL` is `https://` (TLS ended by something in front of Caddy), the session cookie
becomes `__Host-` prefixed and `Secure`.

### Without Docker

```bash
pnpm install
IDEN_ISSUER=http://localhost:8000 PLAYGROUND_CLIENT_SECRET=... pnpm dev
```

Open <http://localhost:5100>.

## How it is built

```
playground/
├── src/
│   ├── app/
│   │   ├── page.tsx         # one server-rendered page
│   │   ├── globals.css      # neubrutalism
│   │   ├── authorize/ callback/ refresh/ userinfo/ revoke/ logout/ clear/
│   │   │                    # route handlers, one per form or redirect
│   │   └── session/         # gives a new browser its session cookie
│   └── lib/
│       ├── config.ts        # environment and constants
│       ├── session.ts       # in-memory sessions, CSRF
│       └── iden.ts          # discovery, token endpoint, ID token checks, userinfo
├── Caddyfile                # :5100, plain HTTP, security headers
├── Dockerfile               # Next.js standalone build
├── docker-compose.yml       # playground + caddy
└── .env.example
```

It is a Next.js app and a **confidential, server-side client**. Every button is a plain HTML form
posting to a route handler, so tokens never reach the browser's JavaScript. Security measures:

- **PKCE (S256), `state` and `nonce`** on every request. `state` is single-use and expires after
  10 minutes. A callback with an unknown `state` is refused before any code is exchanged.
- **`iss` on the callback is checked** (RFC 9207), on errors as well as on success, to stop
  mix-up attacks.
- **The ID token is fully validated** with `jose`: signature against IDEN's JWKS (asymmetric
  algorithms only, keys refetched on rotation), plus `iss`, `aud`, `azp`, `exp`, `iat` and `nonce`.
  Access and logout tokens are rejected by `typ` and `events`. A refreshed ID token must name the
  same `sub`. The userinfo `sub` must match the ID token's.
- **The access token is not trusted.** It is shown decoded, but it is addressed to APIs, which
  are the ones that validate it.
- **Tokens stay on the server**, in memory, keyed by a random `HttpOnly`, `SameSite=Lax` cookie.
  Sessions expire after an hour.
- **Every POST requires a CSRF token.** Form input is checked against allowlists, so only known
  scopes, `acr_values` and `prompt` values ever reach IDEN.
- **Strict headers from Caddy:** a CSP limiting forms to the playground and IDEN,
  `frame-ancestors 'none'`, and `Referrer-Policy: no-referrer` (the callback URL carries a code).
  After the callback the app redirects, so the code never stays in the address bar or history.
- **Hardened containers:** non-root Node, read-only filesystems, all capabilities dropped,
  `no-new-privileges`. Only Caddy publishes a port.

Sessions are held in memory, so the app runs as **one instance**, and a restart signs everyone out
of the playground. Back-channel logout is not implemented.
