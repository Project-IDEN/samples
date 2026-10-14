import type { HeadTracker, Pose } from "./head-tracker";

/**
 * A capture that waits for the person. Straight-ahead frames are taken once
 * the face is in view and frontal; a movement's frames once the head has
 * turned far enough, while it is held there. Nothing is taken on a timer, so
 * a slow mover gets as long as they need — up to a window — and a quick one
 * is not kept waiting.
 *
 * The frames and steps sent are exactly the challenge's, so the provider and
 * the engine see a capture like any other, and the engine judges it alone.
 */

// Which pose axis each movement changes, and in which direction.
const MOVES: Record<string, { axis: keyof Pose; sign: number }> = {
  turn_left: { axis: "yaw", sign: 1 },
  turn_right: { axis: "yaw", sign: -1 },
  look_up: { axis: "pitch", sign: -1 },
  look_down: { axis: "pitch", sign: 1 },
};
// How far counts here. Past the engine's bar (turn_delta 0.15 and
// pitch_delta 0.08 in engine/models.toml), because its landmarks come from
// another model and land a little differently. NOT CALIBRATED on real faces:
// compare the tracker's readings with the movement the engine logs, and move
// these until a capture the tracker accepts is one the engine accepts.
const TRIGGER: Record<keyof Pose, number> = { yaw: 0.22, pitch: 0.12 };
// Facing the camera, near enough to call straight ahead.
const FRONTAL_YAW = 0.12;

const WINDOW_MS = 8000;
const RECENTRE_MS = 3000;
const CENTRE_GAP_MS = 220;
const HOLD_GAP_MS = 150;
const POLL_MS = 40;
// Readings in a row a condition must hold for: one frame of tracker jitter
// is not a movement.
const STEADY = 2;

export type Phase =
  | { name: "look"; step: string }
  | { name: "move"; step: string }
  | { name: "hold"; step: string }
  | { name: "recentre"; step: string };

export interface Guide {
  phase: (phase: Phase) => void;
  /** How far the current movement has gone, 0 to 1; null outside a movement. */
  progress: (value: number | null) => void;
  take: (step: string) => Promise<void>;
}

/** Raised when the person did not do what was asked within the window. */
export class CaptureTimeout extends Error {
  constructor(readonly step: string) {
    super(
      step === "center"
        ? "We couldn't see your face looking at the camera."
        : "We didn't see that movement. Try again, and go a little further.",
    );
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = performance.now() + ms;
  let streak = 0;
  while (performance.now() < deadline) {
    streak = check() ? streak + 1 : 0;
    if (streak >= STEADY) return true;
    await wait(POLL_MS);
  }
  return false;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How far `pose` has gone towards `step` from `baseline`, where 1 is enough. */
export function reach(step: string, pose: Pose | null, baseline: Pose): number {
  const move = MOVES[step];
  if (!pose || !move) return 0;
  return (move.sign * (pose[move.axis] - baseline[move.axis])) / TRIGGER[move.axis];
}

/** Consecutive identical steps, so each is asked for once. */
function groups(steps: string[]) {
  return steps.reduce<{ step: string; count: number }[]>((out, step) => {
    const last = out.at(-1);
    if (last && last.step === step) last.count += 1;
    else out.push({ step, count: 1 });
    return out;
  }, []);
}

export async function guidedCapture(steps: string[], tracker: HeadTracker, guide: Guide) {
  const latest = tracker.latest;
  let baseline: Pose = { yaw: 0, pitch: 0 };
  let previous: string | null = null;

  for (const { step, count } of groups(steps)) {
    if (!MOVES[step]) {
      guide.phase({ name: "look", step });
      const frontal = () => {
        const pose = latest();
        return pose !== null && Math.abs(pose.yaw) < FRONTAL_YAW;
      };
      // Each frame, not just the first: these set the baseline every movement
      // is measured from, and identity and anti-spoofing are judged on them.
      const poses: Pose[] = [];
      for (let i = 0; i < count; i += 1) {
        if (!(await until(frontal, WINDOW_MS))) throw new CaptureTimeout(step);
        const pose = latest();
        await guide.take(step);
        if (pose) poses.push(pose);
        await wait(CENTRE_GAP_MS);
      }
      if (poses.length) {
        baseline = {
          yaw: median(poses.map((p) => p.yaw)),
          pitch: median(poses.map((p) => p.pitch)),
        };
      }
      previous = step;
      continue;
    }

    if (previous && MOVES[previous]) {
      const last = previous;
      guide.phase({ name: "recentre", step });
      await until(() => {
        const pose = latest();
        return pose !== null && Math.abs(reach(last, pose, baseline)) < 0.3;
      }, RECENTRE_MS);
    }
    previous = step;

    guide.phase({ name: "move", step });
    const moved = await until(() => {
      const value = reach(step, latest(), baseline);
      guide.progress(Math.max(0, Math.min(1, value)));
      return value >= 1;
    }, WINDOW_MS);
    if (!moved) {
      guide.progress(null);
      throw new CaptureTimeout(step);
    }

    guide.phase({ name: "hold", step });
    for (let i = 0; i < count; i += 1) {
      await guide.take(step);
      await wait(HOLD_GAP_MS);
    }
    guide.progress(null);
  }
}
