// What the browser sees, what this server calls, and what `iss` must equal in
// every token.
export const ISSUER = trimSlash(process.env.IDEN_ISSUER || "http://localhost:8000");
export const CLIENT_ID = process.env.PLAYGROUND_CLIENT_ID || "playground";
// Empty means a public client: PKCE alone proves the code is ours.
export const CLIENT_SECRET = process.env.PLAYGROUND_CLIENT_SECRET || "";
export const APP_URL = trimSlash(process.env.PLAYGROUND_URL || "http://localhost:5100");

export const REDIRECT_URI = `${APP_URL}/callback`;
export const POST_LOGOUT_REDIRECT_URI = `${APP_URL}/`;
export const SECURE = APP_URL.startsWith("https://");

// An authorization request is answered within ten minutes, or not at all.
export const PENDING_TTL = 10 * 60;
export const MAX_PENDING = 5;

// The playground asks for OpenID Connect's own scopes and nothing else. IDEN
// enforces the same from its side when the client has no grantable scopes.
export const OIDC_SCOPES: Record<string, string> = {
  openid: "Required. Without it there is no ID token.",
  profile: "name, preferred_username, picture",
  email: "email, email_verified",
  offline_access: "A refresh token",
};

// Ordered weakest to strongest — IDEN treats them the same way.
export const ACR_LEVELS: Record<string, [label: string, detail: string]> = {
  "urn:iden:acr:sfa": ["Single factor", "Password"],
  "urn:iden:acr:mfa": ["Multi-factor", "Password + authenticator code or face"],
  "urn:iden:acr:mfa-face": ["Biometric", "Password + liveness-checked face"],
};

export const AMR_NAMES: Record<string, string> = {
  pwd: "Password",
  otp: "Authenticator code",
  face: "Face",
  mfa: "Multi-factor",
};

export const PROMPTS = ["", "login", "consent", "select_account", "none"];

// What each error returned to /callback means in IDEN, and what to try next.
export const ERROR_HINTS: Record<string, string> = {
  unmet_authentication_requirements:
    "This account has no sign-in method that reaches the requested level. " +
    "For urn:iden:acr:mfa-face, the provider needs IDEN_BIOMETRIC_ENABLED=true " +
    "and the person needs a face enrolled at a kiosk. For urn:iden:acr:mfa, " +
    "they need an authenticator app (or a face) set up in the dashboard.",
  login_required:
    "prompt=none was sent, and there is no IDEN session that satisfies the " +
    "request (or max_age / acr_values ask for more than it has). Sign in " +
    "once without prompt=none, then try again.",
  consent_required:
    "prompt=none was sent, but the person has not yet agreed to these " +
    "scopes for this application. Sign in once without prompt=none.",
  access_denied: "The person declined on the consent screen.",
  unauthorized_client:
    "The client is not allowed the authorization_code grant. Check its " +
    "allowed grants in the IDEN dashboard.",
};

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}
