// Set up everything the door panel needs in IDEN, through the admin API:
//
//   the "building" API ─ one scope per door
//   four roles         ─ each opens one door
//   four groups        ─ hold those roles
//   four demo people   ─ in those groups
//   the panel's client ─ confidential, consent skipped, back-channel logout on
//
// Safe to run again: whatever already exists is kept and brought into line.
//
//   IDEN_ISSUER=… DOOR_PANEL_URL=… ADMIN_TOKEN=… node scripts/seed.mjs
//
// ADMIN_TOKEN is an administrator's access token. DEMO_PASSWORD, if set, is
// given to every new demo person (12 characters or more); otherwise IDEN
// generates one each and this prints them once.

const ISSUER = trim(env("IDEN_ISSUER"));
const APP_URL = trim(env("DOOR_PANEL_URL"));
const ADMIN_TOKEN = env("ADMIN_TOKEN");
const AUDIENCE = trim(process.env.BUILDING_AUDIENCE || "https://building.example/doors");
const CLIENT_ID = process.env.DOOR_PANEL_CLIENT_ID || "door-panel";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || undefined;

// Keep in step with src/lib/doors.ts.
const DOORS = {
  lobby: ["building:lobby:open", "Open the lobby door."],
  lab: ["building:lab:open", "Open the lab."],
  "server-room": ["building:server-room:open", "Open the server room."],
  vault: ["building:vault:open", "Open the vault."],
};

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

const PEOPLE = {
  alice: ["Alice", ["Building staff", "Lab team"]],
  bob: ["Bob", ["Building staff", "IT team"]],
  carol: ["Carol", ["Building staff", "Security team"]],
  dave: ["Dave", ["Building staff"]],
};

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
for (const [door, [value, description]] of Object.entries(DOORS)) {
  const scope = await ensure(`scope ${value}`, scopes.find((s) => s.value === value), () =>
    call("POST", `/admin/apis/${api.id}/scopes`, { value, description }),
  );
  scopeIds[door] = scope.id;
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

console.log("\nPeople");
const passwords = [];
for (const [username, [displayName, groupNames]] of Object.entries(PEOPLE)) {
  const found = (await all(`/admin/users?search=${encodeURIComponent(username)}`)).find((u) => u.username === username);
  if (found) {
    for (const g of groupNames) await call("POST", `/admin/groups/${groupIds[g]}/members`, { userIds: [found.id] });
    console.log(`  ✓ ${username} (already there; password unchanged)`);
    continue;
  }
  const made = await call("POST", "/admin/users", {
    emailLocalPart: username,
    username,
    displayName,
    password: DEMO_PASSWORD,
    groupIds: groupNames.map((g) => groupIds[g]),
  });
  passwords.push([username, made.email, DEMO_PASSWORD ?? made.generatedPassword]);
  console.log(`  + ${username}`);
}

console.log("\nClient");
const clientFields = {
  name: "Door Panel",
  allowedGrants: ["authorization_code", "refresh_token"],
  redirectUris: [`${APP_URL}/callback`],
  postLogoutRedirectUris: [`${APP_URL}/`],
  backchannelLogoutUri: `${APP_URL}/backchannel-logout`,
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
if (secret) console.log(`\nPut this in .env — it is shown only once:\n\n  DOOR_PANEL_CLIENT_SECRET=${secret}`);
if (passwords.length) {
  console.log("\nDemo people (passwords shown only once):\n");
  for (const [username, email, password] of passwords) console.log(`  ${username.padEnd(6)} ${email.padEnd(32)} ${password}`);
}
console.log("\nCarol opens the vault only with a face: enrol hers at a kiosk.");

function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}. See the comment at the top of scripts/seed.mjs.`);
    process.exit(1);
  }
  return value;
}

function trim(url) {
  return url.replace(/\/+$/, "");
}
