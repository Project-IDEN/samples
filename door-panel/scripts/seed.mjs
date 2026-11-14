// Set up everything the door panel needs in IDEN, through the admin API:
//
//   the "building" API ─ one scope per door, from src/lib/doors.ts
//   four roles         ─ each opens one door
//   four groups        ─ hold those roles
//   alice              ─ the one demo person, in Building staff only
//   the panel's client ─ confidential, consent skipped, back-channel logout on
//
// Safe to run again: whatever already exists is kept and brought into line.
// That includes Alice, who goes back to Building staff alone, so running it
// again resets her between demos.
//
//   pnpm seed
//
// It reads door-panel/.env, like the panel and docker compose: IDEN_ISSUER,
// DOOR_PANEL_URL, and ADMIN_TOKEN, an administrator's access token (it lasts
// ten minutes; see the README for copying one). DEMO_PASSWORD, if set, is
// Alice's password when she is created. A newly created client's secret is
// written back into .env.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = new URL("../.env", import.meta.url);
if (!existsSync(ENV_FILE)) fail("No .env yet: cp .env.example .env, then fill it in.");
// Variables already set win, so ADMIN_TOKEN=… pnpm seed works too.
process.loadEnvFile(ENV_FILE);
for (const name of ["IDEN_ISSUER", "DOOR_PANEL_URL", "ADMIN_TOKEN"]) {
  if (!process.env[name]) fail(`Set ${name} in .env.`);
}

// The panel's own settings and doors, so the two can never disagree. Imported
// only now: config.ts reads the environment as it loads.
const config = await import("../src/lib/config.ts");
const { DOORS } = await import("../src/lib/doors.ts");
const { ISSUER, CLIENT_ID, BUILDING_AUDIENCE: AUDIENCE } = config;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || undefined;

const ROLES = {
  "building-staff": ["Works in the building.", ["lobby"]],
  "lab-researcher": ["Works in the lab.", ["lab"]],
  "it-technician": ["Looks after the servers.", ["server-room"]],
  "security-officer": ["Guards the vault.", ["vault"]],
};

const GROUPS = {
  "Building staff": ["Everyone who works in the building.", ["building-staff"]],
  "Lab team": ["Researchers.", ["lab-researcher"]],
  "IT team": ["IT.", ["it-technician"]],
  "Security team": ["Security.", ["security-officer"]],
};

// The demo is one person whose job changes: the presenter adds and removes
// her groups in the dashboard, and she starts each demo in this one.
const ALICE = { username: "alice", displayName: "Alice", startsIn: "Building staff" };

// --- The admin API -----------------------------------------------------------

async function call(method, path, body) {
  const response = await fetch(`${ISSUER}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function all(path) {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const page = await call("GET", `${path}${path.includes("?") ? "&" : "?"}limit=200&offset=${offset}`);
    items.push(...page.items);
    if (items.length >= page.meta.total || page.items.length === 0) return items;
  }
}

async function ensure(kind, existing, create) {
  if (existing) {
    console.log(`  ✓ ${kind} (already there)`);
    return existing;
  }
  const made = await create();
  console.log(`  + ${kind}`);
  return made;
}

// --- Seed --------------------------------------------------------------------

console.log(`Seeding ${ISSUER}\n`);

console.log("API and door scopes");
const api = await ensure(
  `API ${AUDIENCE}`,
  (await all("/admin/apis")).find((a) => a.audience === AUDIENCE),
  () => call("POST", "/admin/apis", { name: "building", audience: AUDIENCE, description: "The building's door controller." }),
);
const scopes = await all(`/admin/apis/${api.id}/scopes`);
const scopeIds = {};
for (const door of DOORS) {
  const scope = await ensure(`scope ${door.scope}`, scopes.find((s) => s.value === door.scope), () =>
    call("POST", `/admin/apis/${api.id}/scopes`, { value: door.scope, description: door.description }),
  );
  scopeIds[door.id] = scope.id;
}

console.log("\nRoles");
const roles = await all("/admin/roles");
const roleIds = {};
for (const [name, [description, doors]] of Object.entries(ROLES)) {
  const wanted = doors.map((d) => scopeIds[d]);
  const found = roles.find((r) => r.name === name);
  const role = await ensure(`role ${name}`, found, () => call("POST", "/admin/roles", { name, description, scopeIds: wanted }));
  if (found) await call("PUT", `/admin/roles/${role.id}/scopes`, { scopeIds: wanted });
  roleIds[name] = role.id;
}

console.log("\nGroups");
const groups = await all("/admin/groups");
const groupIds = {};
for (const [name, [description, roleNames]] of Object.entries(GROUPS)) {
  const group = await ensure(`group ${name}`, groups.find((g) => g.name === name), () =>
    call("POST", "/admin/groups", { name, description }),
  );
  await call("PUT", `/admin/groups/${group.id}/roles`, { roleIds: roleNames.map((r) => roleIds[r]) });
  groupIds[name] = group.id;
}

console.log("\nAlice");
let alicePassword;
const alice = (await all(`/admin/users?search=${ALICE.username}`)).find((u) => u.username === ALICE.username);
if (alice) {
  // Back to the start: in Building staff, out of the other demo groups.
  // Groups that are not the demo's are left alone.
  await call("POST", `/admin/groups/${groupIds[ALICE.startsIn]}/members`, { userIds: [alice.id] });
  for (const group of alice.groups) {
    if (group.name !== ALICE.startsIn && group.name in GROUPS) {
      await call("DELETE", `/admin/groups/${group.id}/members/${alice.id}`);
    }
  }
  console.log(`  ✓ ${ALICE.username} (already there; reset to ${ALICE.startsIn} only, password unchanged)`);
} else {
  const made = await call("POST", "/admin/users", {
    emailLocalPart: ALICE.username,
    username: ALICE.username,
    displayName: ALICE.displayName,
    password: DEMO_PASSWORD,
    groupIds: [groupIds[ALICE.startsIn]],
  });
  alicePassword = [made.email, DEMO_PASSWORD ?? made.generatedPassword];
  console.log(`  + ${ALICE.username}, in ${ALICE.startsIn}`);
}

console.log("\nClient");
const clientFields = {
  name: "Door Panel",
  allowedGrants: ["authorization_code", "refresh_token"],
  redirectUris: [config.REDIRECT_URI],
  postLogoutRedirectUris: [config.POST_LOGOUT_REDIRECT_URI],
  backchannelLogoutUri: config.BACKCHANNEL_LOGOUT_URI,
  // First-party, and the silent re-check after access is granted has no page
  // on which to ask.
  skipConsent: true,
};
const found = (await all("/admin/clients")).find((c) => c.clientId === CLIENT_ID);
let secret;
if (found) {
  await call("PATCH", `/admin/clients/${found.id}`, clientFields);
  console.log(`  ✓ client ${CLIENT_ID} (already there; settings updated, secret unchanged)`);
} else {
  const made = await call("POST", "/admin/clients", { clientId: CLIENT_ID, clientType: "confidential", ...clientFields });
  secret = made.clientSecret;
  console.log(`  + client ${CLIENT_ID}`);
}
const client = found ?? (await all("/admin/clients")).find((c) => c.clientId === CLIENT_ID);
// The OIDC scopes need no grant; the doors do.
await call("PUT", `/admin/clients/${client.id}/scopes`, { grantableScopeIds: Object.values(scopeIds), grantedScopeIds: [] });

// --- What to do next ---------------------------------------------------------

console.log("\nDone.");
if (secret) {
  saveSecret(secret);
  console.log("\nThe client secret is in .env (DOOR_PANEL_CLIENT_SECRET). Restart the panel to use it.");
}
if (alicePassword) console.log(`\nAlice signs in as ${alicePassword[0]} with this password, shown only once:\n\n  ${alicePassword[1]}`);
console.log("\nThe vault opens only with a face: enrol the presenter's face on Alice at a kiosk.");

/** Set DOOR_PANEL_CLIENT_SECRET in .env, leaving every other line as it was. */
function saveSecret(value) {
  const lines = readFileSync(ENV_FILE, "utf8").split("\n");
  const at = lines.findIndex((l) => /^\s*DOOR_PANEL_CLIENT_SECRET\s*=/.test(l));
  if (at >= 0) lines[at] = `DOOR_PANEL_CLIENT_SECRET=${value}`;
  else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, `DOOR_PANEL_CLIENT_SECRET=${value}`);
  writeFileSync(ENV_FILE, lines.join("\n"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
