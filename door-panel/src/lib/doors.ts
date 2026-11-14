// The building. Each door is one scope on the building API in IDEN; who holds
// which scope is decided in IDEN, by roles and groups, never here.

export type Door = {
  id: string;
  name: string;
  scope: string;
  /** Read on IDEN's consent screen and in the dashboard. */
  description: string;
  /** Also needs a face check within FACE_MAX_AGE seconds. */
  face?: boolean;
};

export const DOORS: Door[] = [
  { id: "lobby", name: "Lobby", scope: "building:lobby:open", description: "Open the lobby door." },
  { id: "lab", name: "Lab", scope: "building:lab:open", description: "Open the lab." },
  { id: "server-room", name: "Server room", scope: "building:server-room:open", description: "Open the server room." },
  { id: "vault", name: "Vault", scope: "building:vault:open", description: "Open the vault.", face: true },
];

export const doorById = (id: string) => DOORS.find((d) => d.id === id);

/** Every sign-in asks for every door. IDEN trims the token to what this person holds. */
export const REQUESTED_SCOPES = ["openid", "profile", "offline_access", ...DOORS.map((d) => d.scope)];
