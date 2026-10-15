import { expect, test } from "vitest";
import { DEFAULTS, load, sanitize, save, THEMES, themeColor } from "./settings.js";

test("sanitize falls back and drops unknown keys", () => {
  expect(sanitize()).toEqual(DEFAULTS);
  expect(sanitize({ mode: "bogus", theme: "nope", crt: false })).toEqual(DEFAULTS);
  expect(sanitize({ mode: "circle", theme: "green", sfx: false })).toEqual({ theme: "green" });
});

test("custom hex colours are accepted, junk isn't", () => {
  expect(sanitize({ theme: "#12AbEf" }).theme).toBe("#12AbEf");
  expect(themeColor("#12AbEf")).toBe("#12abef");
  expect(sanitize({ theme: "#123" }).theme).toBe(DEFAULTS.theme);
  expect(sanitize({ theme: "red;}" }).theme).toBe(DEFAULTS.theme);
});

test("themeColor", () => {
  expect(themeColor("green")).toBe("#33ff66");
  expect(themeColor("bogus")).toBe(THEMES[0].color);
});

test("load/save roundtrip and survive broken storage", () => {
  const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  save({ mode: "split", theme: "cyan", sfx: false, lang: "ja" }, st); // old saves may still carry mode, lang and sfx
  expect(load(st)).toEqual({ theme: "cyan" });
  m.set("numnuts.settings", "{nope");
  expect(load(st)).toEqual(DEFAULTS);
  const boom = { getItem() { throw new Error(); }, setItem() { throw new Error(); } };
  expect(load(boom)).toEqual(DEFAULTS);
  expect(() => save(DEFAULTS, boom)).not.toThrow();
});
