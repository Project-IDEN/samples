/** The engine's wire format, as `engine/src/engine/schemas.py` defines it. */

export interface Info {
  model_version: string;
  device: string;
  providers: string[];
  calibrated: boolean;
  match_threshold: number;
}

export interface Checks {
  anti_spoofing: boolean;
  anti_spoofing_score: number;
  actions: boolean;
  actions_score: number;
  consistent: boolean;
  consistency_score: number;
}

export interface Capture {
  usable: boolean;
  reasons: string[];
  checks: Checks | null;
  live: boolean;
  model_version: string;
}

export interface EnrollResult extends Capture {
  embeddings: number[][];
  qualities: number[];
  sources: number[];
}

export interface VerifyResult extends Capture {
  matched: boolean;
  similarity: number;
}

export interface EmbedResult {
  model_version: string;
  embeddings: (number[] | null)[];
}

/** What went wrong, from a non-2xx answer: the engine's `detail`, or the status. */
async function failure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body?.detail ?? `The engine answered ${response.status}.`);
}

export async function call<T>(op: string, body?: FormData): Promise<T> {
  const response = await fetch(`/api/engine/${op}`, {
    method: body ? "POST" : "GET",
    body,
  });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export function frameForm(frames: Blob[], meta?: object): FormData {
  const form = new FormData();
  frames.forEach((frame, i) => form.append("frames", frame, `${i}.jpg`));
  if (meta) form.append("meta", JSON.stringify(meta));
  return form;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}
