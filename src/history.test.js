import { expect, test } from "vitest";
import { createHistory, replay } from "./history.js";
import { sine } from "./test-utils.js";

test("push, chain, undo, replay", () => {
  const orig = sine(), h = createHistory(orig);
  h.push(42); h.push(117);
  expect(h.chain).toEqual([42, 117]);
  expect(replay(orig, [42, 117]).channels[0]).toEqual(h.current.channels[0]);
  h.undo();
  expect(h.chain).toEqual([42]);
  h.undo(); h.undo();
  expect(h.current).toBe(orig);
});

test("truncate jumps back, 0 clears to original", () => {
  const orig = sine(), h = createHistory(orig);
  [1, 2, 3].forEach((c) => h.push(c));
  h.truncate(2);
  expect(h.chain).toEqual([1, 2]);
  h.truncate(5);
  expect(h.chain).toEqual([1, 2]);
  h.truncate(0);
  expect(h.chain).toEqual([]);
  expect(h.current).toBe(orig);
});

test("push accepts a precomputed buffer", () => {
  const h = createHistory(sine());
  const p = replay(h.current, [42]);
  h.push(42, p);
  expect(h.current).toBe(p);
  expect(h.chain).toEqual([42]);
});

// main.js drops a finished render when history.current is no longer the buffer it started from.
test("every history move gives current a new identity", () => {
  const h = createHistory(sine());
  const a = h.current; h.push(1);
  const b = h.current; expect(b).not.toBe(a);
  h.push(2); h.undo(); expect(h.current).toBe(b);
  h.push(3); h.truncate(0); expect(h.current).toBe(a);
  h.push(1); expect(h.current).not.toBe(b); // re-keeping the same code still renders a new buffer
});
