import { readFile } from "node:fs/promises";

/**
 * The browser never talks to the engine: it has no CORS, and its token must
 * not reach a page. Every call goes through here, which adds the token.
 */

const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:8002";
const READS = new Set(["info"]);
const WRITES = new Set(["enroll", "verify", "embed"]);

async function token(): Promise<string | undefined> {
  if (process.env.ENGINE_TOKEN) return process.env.ENGINE_TOKEN;
  const file = process.env.ENGINE_TOKEN_FILE;
  return file ? (await readFile(file, "utf8")).trim() : undefined;
}

async function forward(op: string, init: RequestInit): Promise<Response> {
  const secret = await token();
  try {
    const response = await fetch(`${ENGINE_URL}/${op}`, {
      ...init,
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      cache: "no-store",
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { detail: `The engine is not answering at ${ENGINE_URL}.` },
      { status: 502 },
    );
  }
}

export async function GET(_request: Request, ctx: RouteContext<"/api/engine/[op]">) {
  const { op } = await ctx.params;
  if (!READS.has(op)) return Response.json({ detail: "Unknown call." }, { status: 404 });
  return forward(op, { method: "GET" });
}

export async function POST(request: Request, ctx: RouteContext<"/api/engine/[op]">) {
  const { op } = await ctx.params;
  if (!WRITES.has(op)) return Response.json({ detail: "Unknown call." }, { status: 404 });
  return forward(op, { method: "POST", body: await request.formData() });
}
