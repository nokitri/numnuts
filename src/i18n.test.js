import { expect, test } from "vitest";
import { t } from "./i18n.js";

test("t fills placeholders and falls back to the key", () => {
  expect(t("codeRange", { max: 999 })).toBe("code must be 0-999");
  expect(t("saved", {})).toBe("saved ★ {code}");
  expect(t("nope")).toBe("nope");
});
