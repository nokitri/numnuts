import { expect, test, vi } from "vitest";
import { createUiSounds } from "./ui-sounds.js";

// Minimal fake AudioContext that records started oscillators.
function fakeCtx() {
  const started = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const node = () => ({ connect: (n) => n, gain: param() });
  return {
    started, currentTime: 0, destination: {},
    createGain: node,
    createOscillator: () => ({ type: "", frequency: param(), connect: (n) => n, start: () => started.push(1), stop: vi.fn() }),
  };
}

test("every sound plays", () => {
  const ctx = fakeCtx();
  const s = createUiSounds(ctx);
  s.tick(3); s.keep(); s.discard(); s.undo(); s.error(); s.click();
  expect(ctx.started.length).toBe(7); // keep is two notes
});
