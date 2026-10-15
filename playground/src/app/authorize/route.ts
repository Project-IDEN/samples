import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ACR_LEVELS, CLIENT_ID, MAX_PENDING, OIDC_SCOPES, PENDING_TTL, PROMPTS, REDIRECT_URI } from "@/lib/config";
import { metadata } from "@/lib/iden";
import { action, backHome, errorMessage, field, now, randomToken } from "@/lib/session";

export const POST = action(async (session, form) => {
  // Allowlists, not escaping: nothing outside them reaches IDEN.
  const chosen = form.getAll("scope");
  const scopes = Object.keys(OIDC_SCOPES).filter((s) => s === "openid" || chosen.includes(s));
  const acrValues = field(form, "acr_values");
  const prompt = field(form, "prompt");
  const maxAge = field(form, "max_age");
  const loginHint = field(form, "login_hint");
  session.form = { scope: scopes, acr_values: acrValues, prompt, max_age: maxAge, login_hint: loginHint };

  if (acrValues && !(acrValues in ACR_LEVELS)) return backHome(session, "error", "Unknown acr_values.");
  if (!PROMPTS.includes(prompt)) return backHome(session, "error", "Unknown prompt.");
  if (maxAge && !(/^\d+$/.test(maxAge) && Number(maxAge) <= 31_536_000)) {
    return backHome(session, "error", "max_age must be a whole number of seconds.");
  }
  if (loginHint.length > 254 || /\p{C}/u.test(loginHint)) {
    return backHome(session, "error", "login_hint must be printable and at most 254 characters.");
  }

  let meta;
  try {
    meta = await metadata();
  } catch (error) {
    return backHome(session, "error", errorMessage(error));
  }

  const verifier = randomToken(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomToken();
  const nonce = randomToken();

  const params: Record<string, string> = {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  };
  const optional = { acr_values: acrValues, prompt, max_age: maxAge, login_hint: loginHint };
  for (const [key, value] of Object.entries(optional)) if (value) params[key] = value;
  const url = `${meta.authorization_endpoint}?${new URLSearchParams(params)}`;

  // One browser may start several attempts; keep the newest few, briefly.
  const t = now();
  const recent = Object.entries(session.pending)
    .filter(([, p]) => t - p.at < PENDING_TTL)
    .sort(([, a], [, b]) => a.at - b.at)
    .slice(-(MAX_PENDING - 1));
  session.pending = Object.fromEntries(recent);
  session.pending[state] = { verifier, nonce, params, url, at: t };
  return NextResponse.redirect(url, 303);
});
