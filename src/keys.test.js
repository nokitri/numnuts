import { expect, test } from "vitest";
import { keyAction } from "./keys.js";

const k = (key, o = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...o });

test("the shortcut set", () => {
  const map = { " ": "play", r: "dice", R: "dice", x: "clear", Enter: "apply", Backspace: "backspace", Escape: "escape", 7: "digit" };
  for (const [key, a] of Object.entries(map)) expect(keyAction(k(key), false)).toBe(a);
  for (const key of ["u", "d", "o", "h", "q", "l", "m", "?", "/", "v", "c", "f", "s", "ArrowUp", "ArrowDown"]) expect(keyAction(k(key), false)).toBe(null);
});

test("ignored while typing in a field or with modifiers", () => {
  expect(keyAction(k("7"), true)).toBe(null);
  expect(keyAction(k("r", { metaKey: true }), false)).toBe(null);
  expect(keyAction(k("z", { ctrlKey: true }), false)).toBe(null);
});
