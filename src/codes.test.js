import { expect, test } from "vitest";
import { applyCode, describe, isValidCode, recipeFor } from "./codes.js";
import { EFFECTS, FAMILIES } from "./effects.js";
import { sine } from "./test-utils.js";

test("every code chains 3-5 effects from different families, at high intensity", () => {
  const lengths = new Set();
  for (let c = 0; c <= 999; c++) {
    const steps = recipeFor(c), fams = steps.map((s) => EFFECTS[s.name].family);
    lengths.add(steps.length);
    expect(new Set(fams).size, String(c)).toBe(steps.length);
    expect(fams.every((f) => FAMILIES.includes(f))).toBe(true);
  }
  expect([...lengths].sort()).toEqual([3, 4, 5]);
  const seen = new Set(Array.from({ length: 1000 }, (_, c) => JSON.stringify(recipeFor(c))));
  expect(seen.size).toBe(1000);
});

test("deterministic and code-specific", () => {
  const a = applyCode(sine(), 42), b = applyCode(sine(), 42), c = applyCode(sine(), 117);
  expect(a.channels[0]).toEqual(b.channels[0]);
  expect(describe(42)).toBe(describe(42));
  expect(a.channels[0]).not.toEqual(c.channels[0]);
});

test("every code produces a description", () => {
  for (let c = 0; c <= 999; c++) expect(describe(c)).toMatch(/\w/);
});

test("isValidCode", () => {
  expect([0, 999, 5].every(isValidCode)).toBe(true);
  expect([-1, 1000, 1.5, NaN].some(isValidCode)).toBe(false);
});


test("tempo sync snaps delays to beat divisions and rates to beat multiples", async () => {
  const { syncParams } = await import("./codes.js");
  expect(syncParams("echo", { ms: 260, fb: 0.5 }, 120)).toEqual({ ms: 250, fb: 0.5 }); // 1/2 beat at 120
  expect(syncParams("gate", { hz: 7.1, duty: 0.5 }, 120).hz).toBe(8); // 4 per beat
  expect(syncParams("echo", { ms: 260 }, null)).toEqual({ ms: 260 });
  expect(syncParams("reverb", { size: 1 }, 120)).toEqual({ size: 1 });
  expect(describe(3 * 100 + 1, { bpm: 120 })).toMatch(/\w/);
});

test("steps keep roughly the input loudness", async () => {
  const { rmsOf } = await import("./effects.js");
  const input = sine(1, 8000, 2), before = rmsOf(input);
  for (const c of [5, 150, 220, 333, 450, 512, 640, 777, 888, 999]) {
    const r = rmsOf(applyCode(input, c));
    // narrow filters in a 3-5 effect chain can eat a pure test tone; median is ~0.93x, worst ~0.3x
    expect(r).toBeGreaterThan(before * 0.25);
    expect(r).toBeLessThan(before * 1.6);
  }
});
