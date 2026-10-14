"""IDEN OIDC playground.

A confidential, server-side OpenID Connect client for trying out IDEN's
authorization code flow: scopes, `acr_values` (biometric step-up included),
`prompt`, `max_age`, refresh, revocation and sign-out.

Tokens never reach the browser's JavaScript — there is none. They live in this
process, keyed by an HttpOnly cookie, and are only ever rendered as HTML for the
person who signed in.
"""

import base64
import hashlib
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, urlencode, urlsplit

import httpx
import jwt
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# --- Configuration ----------------------------------------------------------

# What the browser sees, and what `iss` must equal in every token.
ISSUER = os.environ.get("IDEN_ISSUER", "http://localhost:8000").rstrip("/")
# What this server uses to reach IDEN. Differs from the issuer only when the
# two run in separate containers, where `localhost` means "this container".
INTERNAL_URL = (os.environ.get("IDEN_INTERNAL_URL") or ISSUER).rstrip("/")
CLIENT_ID = os.environ.get("PLAYGROUND_CLIENT_ID", "playground")
# Empty means a public client: PKCE alone proves the code is ours.
CLIENT_SECRET = os.environ.get("PLAYGROUND_CLIENT_SECRET", "")
APP_URL = os.environ.get("PLAYGROUND_URL", "http://localhost:5100").rstrip("/")

REDIRECT_URI = f"{APP_URL}/callback"
POST_LOGOUT_REDIRECT_URI = f"{APP_URL}/"
SECURE = APP_URL.startswith("https://")

# The playground asks for OpenID Connect's own scopes and nothing else. IDEN
# enforces the same from its side when the client has no grantable scopes.
OIDC_SCOPES = {
    "openid": "Required. Without it there is no ID token.",
    "profile": "name, preferred_username, picture",
    "email": "email, email_verified",
    "offline_access": "A refresh token",
}

# Ordered weakest to strongest — IDEN treats them the same way.
ACR_LEVELS = {
    "urn:iden:acr:sfa": ("Single factor", "Password"),
    "urn:iden:acr:mfa": ("Multi-factor", "Password + authenticator code or face"),
    "urn:iden:acr:mfa-face": ("Biometric", "Password + liveness-checked face"),
}

AMR_NAMES = {
    "pwd": "Password",
    "otp": "Authenticator code",
    "face": "Face",
    "mfa": "Multi-factor",
}

PROMPTS = ("", "login", "consent", "select_account", "none")

# What each error returned to /callback means in IDEN, and what to try next.
ERROR_HINTS = {
    "unmet_authentication_requirements": (
        "This account has no sign-in method that reaches the requested level. "
        "For urn:iden:acr:mfa-face, the provider needs IDEN_BIOMETRIC_ENABLED=true "
        "and the person needs a face enrolled at a kiosk. For urn:iden:acr:mfa, "
        "they need an authenticator app (or a face) set up in the dashboard."
    ),
    "login_required": (
        "prompt=none was sent, and there is no IDEN session that satisfies the "
        "request (or max_age / acr_values ask for more than it has). Sign in "
        "once without prompt=none, then try again."
    ),
    "consent_required": (
        "prompt=none was sent, but the person has not yet agreed to these "
        "scopes for this application. Sign in once without prompt=none."
    ),
    "access_denied": "The person declined on the consent screen.",
    "unauthorized_client": (
        "The client is not allowed the authorization_code grant. Check its "
        "allowed grants in the IDEN dashboard."
    ),
}

# Asymmetric only: a symmetric algorithm would let anyone holding the public
# key — everyone — forge a token.
SAFE_ALGORITHMS = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "EdDSA"}

SESSION_TTL = 60 * 60
PENDING_TTL = 10 * 60
MAX_PENDING = 5
MAX_SESSIONS = 1000
COOKIE = "__Host-playground" if SECURE else "playground"


class ProviderError(Exception):
    """IDEN could not be reached, or answered in a way we refuse to trust."""


class OAuthFailure(Exception):
    def __init__(self, error: str, description: str = ""):
        super().__init__(error)
        self.error, self.description = error, description


# --- Sessions ---------------------------------------------------------------
#
# In memory, so one process holds them all: run a single worker. A restart
# signs everyone out of the playground, which for a playground is fine.


@dataclass
class Session:
    csrf: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    seen: float = field(default_factory=time.monotonic)
    pending: dict[str, dict] = field(default_factory=dict)  # state -> request
    result: dict | None = None
    flash: tuple[str, str] | None = None
    form: dict = field(default_factory=dict)  # last request, to prefill


SESSIONS: dict[str, Session] = {}


def load_session(request: Request) -> Session | None:
    session = SESSIONS.get(request.cookies.get(COOKIE, ""))
    if session is None or time.monotonic() - session.seen > SESSION_TTL:
        return None
    session.seen = time.monotonic()
    return session


def new_session() -> tuple[str, Session]:
    now = time.monotonic()
    for sid in [s for s, v in SESSIONS.items() if now - v.seen > SESSION_TTL]:
        del SESSIONS[sid]
    while len(SESSIONS) >= MAX_SESSIONS:
        del SESSIONS[min(SESSIONS, key=lambda s: SESSIONS[s].seen)]
    sid = secrets.token_urlsafe(32)
    SESSIONS[sid] = Session()
    return sid, SESSIONS[sid]


def require_session(request: Request, csrf: str) -> Session:
    """Every POST: a live session, and a CSRF token proving the form is ours."""
    session = load_session(request)
    if session is None or not secrets.compare_digest(session.csrf, csrf):
        raise HTTPException(403, "Session expired. Reload the playground.")
    return session


def back_home(session: Session, kind: str | None = None, message: str = ""):
    if kind:
        session.flash = (kind, message)
    return RedirectResponse("/", status_code=303)


# --- Talking to IDEN --------------------------------------------------------

http = httpx.AsyncClient(timeout=10, follow_redirects=False)
_metadata: dict = {}
_jwks: dict = {}


def internal(url: str) -> str:
    """A provider URL as this server must call it."""
    return INTERNAL_URL + url[len(ISSUER) :] if url.startswith(ISSUER) else url


async def metadata(fresh: bool = False) -> dict:
    """The discovery document, cached for five minutes."""
    if not fresh and _metadata and time.monotonic() - _metadata["at"] < 300:
        return _metadata["value"]
    try:
        response = await http.get(f"{INTERNAL_URL}/.well-known/openid-configuration")
        response.raise_for_status()
        value = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError(f"Could not read IDEN's discovery document: {exc}") from exc
    # OIDC Discovery Section 4.3: the document must name the issuer we trust.
    if value.get("issuer") != ISSUER:
        raise ProviderError(
            f"Discovery says the issuer is {value.get('issuer')!r}, "
            f"but IDEN_ISSUER is {ISSUER!r}."
        )
    _metadata.update(value=value, at=time.monotonic())
    return value


async def signing_key(kid: str | None) -> jwt.PyJWK:
    """The JWK named `kid`, refetching once in case IDEN rotated its keys."""
    for refetch in (False, True):
        if refetch or "keys" not in _jwks:
            meta = await metadata()
            response = await http.get(internal(meta["jwks_uri"]))
            response.raise_for_status()
            _jwks["keys"] = jwt.PyJWKSet.from_dict(response.json()).keys
        for key in _jwks["keys"]:
            if key.key_id == kid:
                return key
    raise jwt.InvalidTokenError(f"No key with kid {kid!r} in IDEN's JWKS.")


def client_auth(data: dict) -> httpx.BasicAuth | None:
    """client_secret_basic for a confidential client; client_id alone otherwise.

    RFC 6749 Section 2.3.1 form-encodes both halves before Basic encoding them.
    """
    if CLIENT_SECRET:
        return httpx.BasicAuth(quote(CLIENT_ID, safe=""), quote(CLIENT_SECRET, safe=""))
    data["client_id"] = CLIENT_ID
    return None


async def token_request(data: dict) -> dict:
    meta = await metadata()
    auth = client_auth(data)
    response = await http.post(internal(meta["token_endpoint"]), data=data, auth=auth)
    try:
        body = response.json()
    except ValueError:
        body = {}
    if response.status_code != 200:
        raise OAuthFailure(
            body.get("error", f"http_{response.status_code}"),
            body.get("error_description", response.text[:300]),
        )
    return body


async def verify_id_token(raw: str, nonce: str | None, nonce_required: bool = True) -> dict:
    """Every check OIDC Core Section 3.1.3.7 asks of a client."""
    meta = await metadata()
    header = jwt.get_unverified_header(raw)
    # An access or logout token is signed by the same key; refuse them by kind.
    if header.get("typ", "JWT").lower() in ("at+jwt", "logout+jwt"):
        raise jwt.InvalidTokenError(f"Not an ID token (typ {header['typ']}).")
    algorithms = [a for a in meta["id_token_signing_alg_values_supported"] if a in SAFE_ALGORITHMS]
    claims = jwt.decode(
        raw,
        await signing_key(header.get("kid")),
        algorithms=algorithms,
        audience=CLIENT_ID,
        issuer=ISSUER,
        leeway=30,
        options={"require": ["iss", "sub", "aud", "exp", "iat"]},
    )
    if "events" in claims:
        raise jwt.InvalidTokenError("A logout token is not an ID token.")
    if isinstance(claims["aud"], list) and len(claims["aud"]) > 1 and claims.get("azp") != CLIENT_ID:
        raise jwt.InvalidTokenError("azp does not name this client.")
    if "nonce" in claims or nonce_required:
        if not nonce or not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
            raise jwt.InvalidTokenError("nonce does not match the one we sent.")
    return {"header": header, "claims": claims}


def peek(raw: str) -> dict:
    """An access token's contents, for display only. It is addressed to APIs,
    which validate it — this application never trusts what it says."""
    try:
        return {
            "header": jwt.get_unverified_header(raw),
            "claims": jwt.decode(raw, options={"verify_signature": False}),
        }
    except jwt.PyJWTError:
        return {"header": {}, "claims": {"note": "Not a JWT."}}


async def userinfo(access_token: str, sub: str) -> dict:
    meta = await metadata()
    response = await http.get(
        internal(meta["userinfo_endpoint"]),
        headers={"Authorization": f"Bearer {access_token}"},
    )
    try:
        body = response.json()
    except ValueError:
        body = {"body": response.text[:300]}
    result = {"status": response.status_code, "body": body}
    if response.status_code == 200 and body.get("sub") != sub:
        # OIDC Core Section 5.3.2: otherwise the response may describe someone else.
        result["warning"] = "sub does not match the ID token — do not use these claims."
    if challenge := response.headers.get("www-authenticate"):
        result["www_authenticate"] = challenge
    return result


def assurance(requested: str, claims: dict) -> dict:
    """Did the sign-in reach the level we asked for?"""
    levels = list(ACR_LEVELS)
    received = claims.get("acr", "")
    wanted = [v for v in requested.split() if v in levels]
    met = None
    if wanted and received in levels:
        met = levels.index(received) >= min(levels.index(v) for v in wanted)
    elif wanted:
        met = False
    return {
        "requested": requested,
        "received": received,
        "met": met,
        "amr": claims.get("amr", []),
        "auth_time": claims.get("auth_time"),
    }


# --- Application ------------------------------------------------------------


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await http.aclose()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
HERE = Path(__file__).parent
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
templates = Jinja2Templates(directory=HERE / "templates")
templates.env.filters["pretty"] = lambda value: json.dumps(value, indent=2, ensure_ascii=False)
templates.env.filters["when"] = lambda ts: (
    datetime.fromtimestamp(int(ts), UTC).strftime("%Y-%m-%d %H:%M:%S UTC") if ts else "—"
)

_issuer_origin = "{0.scheme}://{0.netloc}".format(urlsplit(ISSUER))
CSP = "; ".join(
    [
        "default-src 'none'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        f"img-src 'self' data: {_issuer_origin}",  # the `picture` claim
        # A form here may end in a redirect to IDEN, which form-action covers.
        f"form-action 'self' {_issuer_origin}",
        "base-uri 'none'",
        "frame-ancestors 'none'",
    ]
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # The callback URL carries an authorization code. Never leak it onward.
    response.headers["Referrer-Policy"] = "no-referrer"
    if not request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
async def index(request: Request):
    session, sid = load_session(request), None
    if session is None:
        sid, session = new_session()

    meta, provider_error = None, None
    try:
        meta = await metadata()
    except ProviderError as exc:
        provider_error = str(exc)

    flash, session.flash = session.flash, None
    response = templates.TemplateResponse(
        request,
        "index.html",
        {
            "issuer": ISSUER,
            "client_id": CLIENT_ID,
            "client_type": "confidential" if CLIENT_SECRET else "public",
            "redirect_uri": REDIRECT_URI,
            "meta": meta,
            "provider_error": provider_error,
            "scopes": OIDC_SCOPES,
            "acr_levels": ACR_LEVELS,
            "amr_names": AMR_NAMES,
            "prompts": PROMPTS,
            "form": session.form,
            "result": session.result,
            "flash": flash,
            "csrf": session.csrf,
        },
    )
    if sid:
        response.set_cookie(
            COOKIE, sid, max_age=SESSION_TTL, path="/", secure=SECURE, httponly=True, samesite="lax"
        )
    return response


@app.post("/authorize")
async def authorize(
    request: Request,
    csrf: str = Form(""),
    scope: list[str] = Form(default=[]),
    acr_values: str = Form(""),
    prompt: str = Form(""),
    max_age: str = Form(""),
    login_hint: str = Form(""),
):
    session = require_session(request, csrf)
    # Allowlists, not escaping: nothing outside them reaches IDEN.
    scopes = [s for s in OIDC_SCOPES if s == "openid" or s in scope]
    login_hint = login_hint.strip()
    max_age = max_age.strip()
    session.form = {"scope": scopes, "acr_values": acr_values, "prompt": prompt,
                    "max_age": max_age, "login_hint": login_hint}

    if acr_values and acr_values not in ACR_LEVELS:
        return back_home(session, "error", "Unknown acr_values.")
    if prompt not in PROMPTS:
        return back_home(session, "error", "Unknown prompt.")
    if max_age and not (max_age.isdigit() and int(max_age) <= 31_536_000):
        return back_home(session, "error", "max_age must be a whole number of seconds.")
    if len(login_hint) > 254 or not login_hint.isprintable():
        return back_home(session, "error", "login_hint must be printable and at most 254 characters.")

    try:
        meta = await metadata()
    except ProviderError as exc:
        return back_home(session, "error", str(exc))

    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)

    params = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(scopes),
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    optional = {"acr_values": acr_values, "prompt": prompt, "max_age": max_age, "login_hint": login_hint}
    params.update({k: v for k, v in optional.items() if v})
    url = f"{meta['authorization_endpoint']}?{urlencode(params)}"

    # One browser may start several attempts; keep the newest few, briefly.
    now = time.monotonic()
    session.pending = {
        s: p for s, p in sorted(session.pending.items(), key=lambda i: i[1]["at"])[-(MAX_PENDING - 1):]
        if now - p["at"] < PENDING_TTL
    }
    session.pending[state] = {"verifier": verifier, "nonce": nonce, "params": params, "url": url, "at": now}
    return RedirectResponse(url, status_code=303)


@app.get("/callback")
async def callback(request: Request):
    query = request.query_params
    session = load_session(request)
    pending = session.pending.pop(query.get("state", ""), None) if session else None
    if session is None or pending is None or time.monotonic() - pending["at"] > PENDING_TTL:
        # Not a response to a request this browser made — possibly an injected
        # code (login CSRF). Nothing is exchanged.
        if session is None:
            sid, session = new_session()
            response = back_home(session, "error", "Unknown or expired state. Start again.")
            response.set_cookie(COOKIE, sid, max_age=SESSION_TTL, path="/", secure=SECURE,
                                httponly=True, samesite="lax")
            return response
        return back_home(session, "error", "Unknown or expired state. Nothing was exchanged; start again.")

    result = {
        "request": pending["params"],
        "authorize_url": pending["url"],
        "nonce": pending["nonce"],
        "at": int(time.time()),
    }
    session.result = result

    # RFC 9207: IDEN names itself on every response. A different (or missing)
    # issuer means the response came from somewhere we did not send the person.
    if query.get("iss") != ISSUER:
        result["error"] = {
            "error": "issuer_mismatch",
            "description": f"Callback iss was {query.get('iss')!r}, expected {ISSUER!r}.",
        }
        return back_home(session)

    if error := query.get("error"):
        result["error"] = {
            "error": error,
            "description": query.get("error_description", ""),
            "hint": ERROR_HINTS.get(error),
        }
        return back_home(session)

    try:
        tokens = await token_request(
            {
                "grant_type": "authorization_code",
                "code": query.get("code", ""),
                "redirect_uri": REDIRECT_URI,
                "code_verifier": pending["verifier"],
            }
        )
        id_token = await verify_id_token(tokens.get("id_token", ""), pending["nonce"])
        result["tokens"] = tokens
        result["id_token"] = id_token
        result["access_token"] = peek(tokens["access_token"])
        result["assurance"] = assurance(pending["params"].get("acr_values", ""), id_token["claims"])
        result["userinfo"] = await userinfo(tokens["access_token"], id_token["claims"]["sub"])
    except OAuthFailure as exc:
        result["error"] = {"error": exc.error, "description": exc.description}
    except jwt.PyJWTError as exc:
        result["error"] = {"error": "invalid_id_token", "description": str(exc)}
    except (ProviderError, httpx.HTTPError, KeyError) as exc:
        result["error"] = {"error": "provider_error", "description": str(exc)}
    # Redirect so the code leaves the address bar and a reload cannot replay it.
    return back_home(session)


@app.post("/refresh")
async def refresh(request: Request, csrf: str = Form("")):
    session = require_session(request, csrf)
    result = session.result or {}
    refresh_token = result.get("tokens", {}).get("refresh_token")
    if not refresh_token:
        return back_home(session, "error", "No refresh token. Request offline_access.")
    try:
        tokens = await token_request({"grant_type": "refresh_token", "refresh_token": refresh_token})
        if "id_token" in tokens:
            # OIDC Core Section 12.2: same person, and the nonce (if any) unchanged.
            id_token = await verify_id_token(tokens["id_token"], result["nonce"], nonce_required=False)
            if id_token["claims"]["sub"] != result["id_token"]["claims"]["sub"]:
                raise jwt.InvalidTokenError("Refreshed ID token names a different sub.")
            result["id_token"] = id_token
            result["assurance"] = assurance(result["request"].get("acr_values", ""), id_token["claims"])
        result["tokens"] = tokens
        result["access_token"] = peek(tokens["access_token"])
        result["userinfo"] = await userinfo(tokens["access_token"], result["id_token"]["claims"]["sub"])
    except OAuthFailure as exc:
        return back_home(session, "error", f"Refresh refused: {exc.error} — {exc.description}")
    except (jwt.PyJWTError, ProviderError, httpx.HTTPError) as exc:
        return back_home(session, "error", f"Refresh failed: {exc}")
    return back_home(session, "ok", "Refreshed. The refresh token was rotated — the old one is spent.")


@app.post("/userinfo")
async def call_userinfo(request: Request, csrf: str = Form("")):
    session = require_session(request, csrf)
    result = session.result or {}
    if "tokens" not in result:
        return back_home(session, "error", "Sign in first.")
    try:
        result["userinfo"] = await userinfo(result["tokens"]["access_token"], result["id_token"]["claims"]["sub"])
    except (ProviderError, httpx.HTTPError) as exc:
        return back_home(session, "error", f"Userinfo failed: {exc}")
    return back_home(session, "ok", f"Userinfo answered {result['userinfo']['status']}.")


@app.post("/revoke")
async def revoke(request: Request, csrf: str = Form(""), which: str = Form("")):
    session = require_session(request, csrf)
    tokens = (session.result or {}).get("tokens", {})
    if which not in ("access_token", "refresh_token") or not tokens.get(which):
        return back_home(session, "error", "Nothing to revoke.")
    try:
        meta = await metadata()
        data = {"token": tokens[which], "token_type_hint": which}
        auth = client_auth(data)
        response = await http.post(internal(meta["revocation_endpoint"]), data=data, auth=auth)
        response.raise_for_status()
    except (ProviderError, httpx.HTTPError) as exc:
        return back_home(session, "error", f"Revocation failed: {exc}")
    follow_up = "Call userinfo" if which == "access_token" else "Refresh"
    return back_home(session, "ok", f"Revoked the {which.replace('_', ' ')}. {follow_up} to watch IDEN refuse it.")


@app.post("/logout")
async def logout(request: Request, csrf: str = Form("")):
    """Forget the tokens here, then end the IDEN session too.

    A GET redirect rather than a POST form: IDEN's session cookie is
    SameSite=Lax, which a browser only sends cross-site on a top-level GET.
    """
    session = require_session(request, csrf)
    result, session.result, session.pending = session.result or {}, None, {}
    id_token = result.get("tokens", {}).get("id_token")
    try:
        meta = await metadata()
    except ProviderError as exc:
        return back_home(session, "error", f"Signed out here, but not of IDEN: {exc}")
    params = {"client_id": CLIENT_ID, "post_logout_redirect_uri": POST_LOGOUT_REDIRECT_URI}
    if id_token:
        params["id_token_hint"] = id_token
    session.flash = ("ok", "Signed out of the playground and of IDEN.")
    return RedirectResponse(f"{meta['end_session_endpoint']}?{urlencode(params)}", status_code=303)


@app.post("/clear")
async def clear(request: Request, csrf: str = Form("")):
    session = require_session(request, csrf)
    session.result = None
    return back_home(session)


@app.get("/health")
async def health():
    return {"status": "ok"}
