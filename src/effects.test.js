import { describe as d, expect, test } from "vitest";
import { EFFECTS, EFFECT_NAMES, MAX_SECONDS, normalize } from "./effects.js";
import { rng } from "./prng.js";
import { sine } from "./test-utils.js";

d.each(EFFECT_NAMES)("%s", (name) => {
  test("finite output within cap, channels preserved", () => {
    for (let seed = 0; seed < 5; seed++) {
      const b = sine(), out = EFFECTS[name].run(b, EFFECTS[name].at(rng(seed)(), seed));
      expect(out.channels).toHaveLength(2);
      expect(out.channels[0].length).toBeGreaterThan(0);
      expect(out.channels[0].length).toBeLessThanOrEqual(b.sampleRate * MAX_SECONDS);
      expect(out.channels.every((c) => c.every(Number.isFinite))).toBe(true);
    }
  });
});

test("normalize peaks at 0.95 and handles silence/NaN", () => {
  const b = { sampleRate: 8000, channels: [Float32Array.of(0.1, -0.2, NaN)] };
  expect(Math.max(...normalize(b).channels[0].map(Math.abs))).toBeCloseTo(0.95);
  expect([...normalize({ sampleRate: 8000, channels: [new Float32Array(3)] }).channels[0]]).toEqual([0, 0, 0]);
});

test("reverse reverses", () => {
  const b = { sampleRate: 1, channels: [Float32Array.of(1, 2, 3)] };
  expect([...EFFECTS.reverse.run(b, {}).channels[0]]).toEqual([3, 2, 1]);
});

test("every effect belongs to a known family and each family has several", async () => {
  const { FAMILIES, byFamily } = await import("./effects.js");
  for (const n of EFFECT_NAMES) expect(FAMILIES).toContain(EFFECTS[n].family);
  for (const f of FAMILIES) expect(byFamily(f)).toHaveLength(10);
});

test("mono input works for stereo-aware effects", () => {
  for (const name of ["autopan", "pingpong", "chorus", "flanger"]) {
    const out = EFFECTS[name].run(sine(0.3, 8000, 1), EFFECTS[name].at(0.5, 1));
    expect(out.channels[0].every(Number.isFinite)).toBe(true);
  }
});


test("matchLoudness hits the target and never exceeds 1", async () => {
  const { matchLoudness, rmsOf } = await import("./effects.js");
  const quiet = { sampleRate: 8000, channels: [Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 5) * 0.01)] };
  const out = matchLoudness(quiet, 0.2);
  expect(rmsOf(out)).toBeCloseTo(0.2, 1);
  expect(Math.max(...out.channels[0].map(Math.abs))).toBeLessThanOrEqual(1);
  expect([...matchLoudness({ sampleRate: 1, channels: [new Float32Array(3)] }, 0.2).channels[0]]).toEqual([0, 0, 0]);
});
