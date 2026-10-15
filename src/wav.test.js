import { expect, test } from "vitest";
import { encodeWav } from "./wav.js";
import { sine } from "./test-utils.js";

test("valid 16-bit stereo header and size", () => {
  const b = sine(0.1, 8000, 2), v = new DataView(encodeWav(b));
  const tag = (o) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
  expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
  expect(v.getUint16(22, true)).toBe(2);
  expect(v.getUint32(24, true)).toBe(8000);
  expect(v.byteLength).toBe(44 + 800 * 2 * 2);
});
