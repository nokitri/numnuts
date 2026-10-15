import { expect, test } from "vitest";
import { SAMPLES } from "./samples.js";
import { analyze } from "./analyze.js";

test.each(Object.keys(SAMPLES))("%s: 4s stereo, finite, audible, not clipping", (name) => {
  const b = SAMPLES[name](), a = analyze(b);
  expect(b.channels).toHaveLength(2);
  expect(a.seconds).toBeCloseTo(4, 1);
  expect(b.channels.every((c) => c.every(Number.isFinite))).toBe(true);
  expect(a.peakDb).toBeLessThanOrEqual(0);
  expect(a.rmsDb).toBeGreaterThan(-30);
});

