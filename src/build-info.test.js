import { expect, test } from "vitest";
import { buildInfo } from "./build-info.js";

test("buildInfo", () => {
  expect(buildInfo({ version: "1.2.3", commit: "abc1234", date: "2026-01-01" })).toBe("v1.2.3 · abc1234 · 2026-01-01");
});
