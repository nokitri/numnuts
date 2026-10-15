/**
 * Tiny synthesized UI sounds. They go straight to the speakers (not through the
 * visualizer analysers) and are kept quiet so they sit under the music.
 * @param {AudioContext} ctx
 */
export function createUiSounds(ctx) {
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);

  // One enveloped oscillator note: freq can glide to `to`.
  function blip(freq, { to = freq, dur = 0.06, type = "square", delay = 0, vol = 1 } = {}) {
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  return {
    /** Digit typed: pitch rises with the digit so codes have a little melody. */
    tick: (digit = 5) => blip(660 + digit * 55, { dur: 0.035 }),
    keep: () => { blip(660, { dur: 0.07 }); blip(990, { dur: 0.12, delay: 0.07 }); },
    discard: () => blip(520, { to: 260, dur: 0.1, type: "triangle" }),
    undo: () => blip(440, { to: 330, dur: 0.07, type: "triangle" }),
    error: () => blip(110, { dur: 0.16, type: "sawtooth", vol: 0.8 }),
    click: () => blip(1200, { dur: 0.025, type: "sine" }),
  };
}
