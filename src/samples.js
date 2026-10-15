/** Built-in starter samples, synthesized so there are no files to ship. 120 bpm, 2 bars, stereo. */
const SR = 44100, BPM = 120, BEAT = (60 / BPM) * SR, LEN = Math.round(BEAT * 8);
const TAU = Math.PI * 2;

function stereo(fill) {
  const L = new Float32Array(LEN), R = new Float32Array(LEN);
  fill(L, R);
  let peak = 0;
  for (const c of [L, R]) for (const v of c) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 0.9 / peak : 0;
  for (const c of [L, R]) for (let i = 0; i < LEN; i++) c[i] *= g;
  return { sampleRate: SR, channels: [L, R] };
}

function synth() {
  const notes = [57, 60, 64, 67, 69, 67, 64, 60]; // A minor pentatonic arp (MIDI)
  return stereo((L, R) => {
    let lp = 0;
    for (let i = 0; i < LEN; i++) {
      const step = Math.floor(i / (BEAT / 4)), t = (i % (BEAT / 4)) / SR, f = 440 * 2 ** ((notes[step % 8] - 69 + (step >= 16 ? 5 : 0)) / 12);
      const saw = ((f * i) / SR) % 1 * 2 - 1, env = Math.exp(-t * 8);
      lp += (0.05 + 0.4 * env) * (saw - lp); // envelope-swept lowpass
      L[i] = lp * env * 0.6;
      R[i] = lp * env * 0.6 * (step % 2 ? 0.7 : 1);
    }
  });
}

function pad() {
  const chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]];
  return stereo((L, R) => {
    for (let i = 0; i < LEN; i++) {
      const bar = Math.floor(i / (BEAT * 2)), t = i / SR, swell = Math.min(1, (i % (BEAT * 2)) / (SR * 0.3));
      let l = 0, rr = 0;
      for (const n of chords[bar % 4]) {
        const f = 440 * 2 ** ((n - 69) / 12);
        l += Math.sin(TAU * f * 0.997 * t) + 0.3 * Math.sin(TAU * f * 2 * t);
        rr += Math.sin(TAU * f * 1.003 * t) + 0.3 * Math.sin(TAU * f * 2 * t);
      }
      L[i] = l * 0.12 * swell; R[i] = rr * 0.12 * swell;
    }
  });
}

export const SAMPLES = { synth, pad };
