import { action, backHome } from "@/lib/session";

export const POST = action(async (session) => {
  session.result = null;
  return backHome(session);
});
