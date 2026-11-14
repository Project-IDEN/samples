// What the browser sees, what this server calls, and what `iss` must equal in
// every token.
export const ISSUER = trimSlash(process.env.IDEN_ISSUER || "http://localhost:8000");
export const CLIENT_ID = process.env.DOOR_PANEL_CLIENT_ID || "door-panel";
// Confidential: the panel exchanges codes and refreshes tokens on its server.
export const CLIENT_SECRET = process.env.DOOR_PANEL_CLIENT_SECRET || "";
export const APP_URL = trimSlash(process.env.DOOR_PANEL_URL || "http://localhost:5200");

export const REDIRECT_URI = `${APP_URL}/callback`;
export const POST_LOGOUT_REDIRECT_URI = `${APP_URL}/`;
// IDEN's server POSTs a logout token here when an IDEN session ends.
export const BACKCHANNEL_LOGOUT_URI = `${APP_URL}/backchannel-logout`;
export const SECURE = APP_URL.startsWith("https://");

// The building's door controller: the API registered in IDEN, and where the
// panel's server reaches it. It runs inside this app, but the panel only ever
// talks to it over HTTP with a Bearer token, as it would to a separate service.
export const BUILDING_AUDIENCE = trimSlash(process.env.BUILDING_AUDIENCE || "https://building.example/doors");
export const DOOR_API_URL = trimSlash(process.env.DOOR_API_URL || "http://127.0.0.1:5200/api/doors");

// Sign the panel out after this long untouched, so the next person at a shared
// screen is not signed in as the last one. 0 turns it off.
export const IDLE_SECONDS = Number(process.env.DOOR_PANEL_IDLE_SECONDS ?? 60) || 0;

// Each tap asks IDEN for a fresh access token if the current one is older than
// this, so a role taken away in the dashboard closes the door on the next tap.
export const BADGE_RECHECK_SECONDS = 10;

// The vault asks for a face, and a recent one.
export const FACE_ACR = "urn:iden:acr:mfa-face";
export const FACE_MAX_AGE = 300;

// An authorization request is answered within ten minutes, or not at all.
export const PENDING_TTL = 10 * 60;
export const MAX_PENDING = 5;

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}
