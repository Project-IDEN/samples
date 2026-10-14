/**
 * A challenge drawn the way the provider draws one
 * (`provider/src/provider/biometric/challenges.py`): three straight-ahead
 * frames, then two random head movements of three frames each.
 */

const ACTIONS = ["turn_left", "turn_right", "look_up", "look_down"];

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function drawSteps(): string[] {
  const actions = shuffled(ACTIONS).slice(0, 2);
  return [...Array(3).fill("center"), ...actions.flatMap((action) => Array(3).fill(action))];
}
