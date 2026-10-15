import { expect, test } from "vitest";
import { rng } from "./prng.js";

test("same seed same sequence, values in [0,1)", () => {
  const a = rng(7), b = rng(7), xs = Array.from({ length: 100 }, a);
  expect(xs).toEqual(Array.from({ length: 100 }, b));
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(rng(8)()).not.toBe(rng(7)());
});

test("int is inclusive", () => {
  const r = rng(1), seen = new Set(Array.from({ length: 500 }, () => r.int(1, 3)));
  expect([...seen].sort()).toEqual([1, 2, 3]);
});
