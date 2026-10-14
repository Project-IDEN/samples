"use client";

import { useRef, useState } from "react";
import { drawSteps } from "@/lib/challenge";
import { grab, useCamera, wait } from "@/lib/camera";
import { call, frameForm, type EnrollResult, type VerifyResult } from "@/lib/engine";
import { ResultView } from "./result-view";
import type { Person } from "./people";

const PROMPTS: Record<string, string> = {
  center: "Look straight at the camera",
  turn_left: "Slowly turn your head to your left",
  turn_right: "Slowly turn your head to your right",
  look_up: "Tilt your head up",
  look_down: "Tilt your head down",
};
// Time to read a prompt and move, between frames, and between two movements:
// the kiosk's and the sign-in page's timings. A movement's frames are spread
// over a second while the person holds the pose; the engine counts the
// furthest of them.
const SETTLE_MS = { center: 900, action: 1200 };
const FRAME_GAP_MS = { center: 220, action: 500 };
const RECENTRE_MS = 900;

interface Shot {
  step: string;
  url: string;
}

/** Consecutive identical steps, so a prompt is shown once for its frames. */
function groups(steps: string[]) {
  return steps.reduce<{ step: string; count: number }[]>((out, step) => {
    const last = out.at(-1);
    if (last && last.step === step) last.count += 1;
    else out.push({ step, count: 1 });
    return out;
  }, []);
}

export function LiveCapture({
  people,
  onEnrolled,
}: {
  people: Person[];
  onEnrolled: (name: string, result: EnrollResult) => void;
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { video, status, devices } = useCamera(deviceId);
  const canvas = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<"enroll" | "verify">("enroll");
  const [name, setName] = useState("");
  const [against, setAgainst] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [result, setResult] = useState<EnrollResult | VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const person = people.find((p) => p.name === (against || people[0]?.name));
  const canStart =
    status === "ready" && !busy && (mode === "enroll" ? name.trim() !== "" : Boolean(person));

  async function capture(steps: string[]): Promise<Blob[]> {
    const source = video.current;
    const target = canvas.current;
    if (!source || !target) throw new Error("The camera is not ready.");
    const frames: Blob[] = [];
    const take = async (step: string) => {
      const blob = await grab(source, target);
      frames.push(blob);
      setShots((all) => [...all, { step, url: URL.createObjectURL(blob) }]);
    };

    let previous: string | null = null;
    for (const { step, count } of groups(steps)) {
      const kind = step === "center" ? "center" : "action";
      if (kind === "action" && previous && previous !== "center") {
        setPrompt("Face the camera again");
        await wait(RECENTRE_MS);
      }
      previous = step;
      setPrompt(PROMPTS[step]);
      await wait(SETTLE_MS[kind]);
      if (kind === "action") setPrompt(`${PROMPTS[step]} — hold it there`);
      for (let i = 0; i < count; i += 1) {
        await take(step);
        await wait(FRAME_GAP_MS[kind]);
      }
    }
    return frames;
  }

  async function run() {
    shots.forEach((shot) => URL.revokeObjectURL(shot.url));
    setShots([]);
    setResult(null);
    setError(null);
    setBusy(true);
    const steps = drawSteps();
    try {
      const frames = await capture(steps);
      setPrompt("Checking…");
      if (mode === "enroll") {
        const enrolled = await call<EnrollResult>("enroll", frameForm(frames, { steps }));
        setResult(enrolled);
        if (enrolled.live && enrolled.embeddings.length) onEnrolled(name.trim(), enrolled);
      } else if (person) {
        setResult(
          await call<VerifyResult>(
            "verify",
            frameForm(frames, { steps, templates: person.templates }),
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <div className="stage">
        <div className="viewport">
          <video ref={video} muted playsInline />
          <div className="oval" aria-hidden />
          {prompt ? <p className="prompt">{prompt}</p> : null}
          {status === "denied" ? (
            <p className="prompt">Camera permission was refused.</p>
          ) : status === "missing" ? (
            <p className="prompt">No camera found.</p>
          ) : null}
        </div>
        <canvas ref={canvas} hidden />
      </div>

      <div className="controls">
        <div className="segmented" role="tablist">
          {(["enroll", "verify"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? "on" : ""}
              onClick={() => setMode(m)}
              disabled={busy}
            >
              {m === "enroll" ? "Enrol" : "Verify"}
            </button>
          ))}
        </div>

        {mode === "enroll" ? (
          <label>
            Name to enrol as
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Julian"
              disabled={busy}
            />
          </label>
        ) : people.length ? (
          <label>
            Verify against
            <select
              value={person?.name ?? ""}
              onChange={(e) => setAgainst(e.target.value)}
              disabled={busy}
            >
              {people.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hint">Enrol someone first: their templates are kept in this browser.</p>
        )}

        {devices.length > 1 ? (
          <label>
            Camera
            <select
              value={deviceId ?? ""}
              onChange={(e) => setDeviceId(e.target.value || null)}
              disabled={busy}
            >
              <option value="">Default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button type="button" className="primary" onClick={run} disabled={!canStart}>
          {busy ? "Capturing…" : mode === "enroll" ? "Start enrolment" : "Start verification"}
        </button>
        <p className="hint">
          9 frames: 3 straight ahead, then 2 random head movements. Turn all the way and hold
          each position until the next instruction.
        </p>

        {error ? <p className="error">{error}</p> : null}
        {result ? <ResultView result={result} /> : null}
      </div>

      {shots.length ? (
        <ol className="shots">
          {shots.map((shot, i) => (
            <li key={shot.url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob */}
              <img src={shot.url} alt={`Frame ${i + 1}: ${shot.step}`} />
              <span>
                {i + 1}. {shot.step}
                {"sources" in (result ?? {}) &&
                (result as EnrollResult).sources.includes(i) ? " ★" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
