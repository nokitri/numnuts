import { expect, test } from "vitest";
import { entryCode, popDigit, pushDigit } from "./entry.js";

test("typing digits builds up to 3, a 4th starts over", () => {
  const e = ["4", "2", "7"].reduce(pushDigit, "");
  expect(e).toBe("427");
  expect(pushDigit(e, "9")).toBe("9");
  expect(pushDigit("1", "x")).toBe("1");
});

test("pop and code", () => {
  expect(popDigit("42")).toBe("4");
  expect(popDigit("")).toBe("");
  expect(entryCode("")).toBe(null);
  expect(entryCode("007")).toBe(7);
});
