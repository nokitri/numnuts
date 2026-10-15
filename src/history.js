import { applyCode } from "./codes.js";

const MAX_STEPS = 50;

/** @param {{ bpm?: number|null }} [env] tempo info passed to codes */
export function createHistory(original, env = {}) {
  const steps = [{ code: null, buf: original }];
  return {
    get current() { return steps.at(-1).buf; },
    get chain() { return steps.slice(1).map((s) => s.code); },
    /** Keep a code; pass `buf` when it was already rendered (e.g. by the worker). */
    push(code, buf) { if (steps.length > MAX_STEPS) return false; steps.push({ code, buf: buf ?? applyCode(this.current, code, env) }); return true; },
    undo() { if (steps.length > 1) steps.pop(); },
    /** Keep only the first n applied codes (0 = back to the original). */
    truncate(n) { steps.length = Math.min(steps.length, Math.max(0, n) + 1); },
  };
}

export const replay = (original, codes, env = {}) => codes.reduce((b, c) => applyCode(b, c, env), original);
