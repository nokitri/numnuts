import { expect, test } from "vitest";
import { analyze, tempo } from "./analyze.js";
import { sine } from "./test-utils.js";

test("basic facts of a sine", () => {
  const a = analyze(sine(1, 8000, 2)); // 220 Hz at 0.5 amplitude
  expect(a.seconds).toBe(1);
  expect(a.channels).toBe(2);
  expect(a.peakDb).toBeCloseTo(-6, 0);
  expect(a.rmsDb).toBeCloseTo(-9, 0);
  expect(a.pitchHz).toBeGreaterThan(200);
  expect(a.pitchHz).toBeLessThan(240);
  expect(a.bpm).toBe(null); // too short
});

test("tempo finds a 120 bpm click track", () => {
  const sr = 8000, d = new Float32Array(sr * 6);
  for (let beat = 0; beat < 12; beat++) for (let i = 0; i < 200; i++) d[beat * sr * 0.5 + i] = Math.sin(i) * (1 - i / 200);
  expect(tempo(d, sr)).toBeGreaterThanOrEqual(118);
  expect(tempo(d, sr)).toBeLessThanOrEqual(122);
});

test("silence is safe", () => {
  const a = analyze({ sampleRate: 8000, channels: [new Float32Array(8000 * 4)] });
  expect(a.peakDb).toBe(-Infinity);
  expect(a.bpm).toBe(null);
});
