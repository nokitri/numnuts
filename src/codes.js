import { rng } from "./prng.js";
import { EFFECTS, FAMILIES, byFamily, matchLoudness, rmsOf } from "./effects.js";

export const MAX_CODE = 999;

/**
 * Every code is its own random chaos: 3-5 effects, each from a different family, at high intensity.
 * Seeded by the code, so the same code always sounds the same (shared links and favourites replay).
 */
export function recipeFor(code) {
  const r = rng(Math.imul(code + 1, 2654435761)), fams = [...FAMILIES];
  return Array.from({ length: r.int(3, 5) }, () => {
    const name = r.pick(byFamily(fams.splice(r.int(0, fams.length - 1), 1)[0]));
    return { name, params: EFFECTS[name].at(0.5 + 0.5 * r(), r.int(0, 1e9)) };
  });
}

// Tempo sync: with a known bpm, delay/repeat times snap to beat divisions and LFO rates to beat multiples.
const SYNC_MS = new Set(["echo", "pingpong", "dub", "dotted"]);
const SYNC_HZ = new Set(["tremolo", "gate", "wobble"]);
const nearest = (xs, v) => xs.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
export function syncParams(name, params, bpm, buf) {
  if (!bpm) return params;
  const beatMs = 60000 / bpm, beatHz = bpm / 60;
  if (SYNC_MS.has(name)) return { ...params, ms: +(beatMs * nearest([1 / 16, 1 / 8, 3 / 16, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1], params.ms / beatMs)).toFixed(1) };
  if (SYNC_HZ.has(name)) return { ...params, hz: +(beatHz * nearest([0.5, 1, 2, 3, 4, 6, 8], params.hz / beatHz)).toFixed(2) };
  if (name === "beatrepeat" && buf) return { ...params, grid: Math.max(4, Math.round((buf.channels[0].length / buf.sampleRate) * beatHz * (params.grid / 4))) };
  return params;
}

/** @param {{ bpm?: number|null }} [env] */
export const describe = (code, env = {}) => recipeFor(code).map(({ name, params }) => EFFECTS[name].label(syncParams(name, params, env.bpm))).join(" → ");

/** Apply a code. Each step fully replaces the sound and is kept at the loudness of its input. */
export const applyCode = (buf, code, env = {}) => recipeFor(code).reduce((b, { name, params }) => matchLoudness(EFFECTS[name].run(b, syncParams(name, params, env.bpm, b)), rmsOf(b)), buf);

export const isValidCode = (c) => Number.isInteger(c) && c >= 0 && c <= MAX_CODE;
