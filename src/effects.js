import { rng } from "./prng.js";

/** @typedef {{ sampleRate: number, channels: Float32Array[] }} Buf */

export const MAX_SECONDS = 30;

const len = (b) => b.channels[0].length;
const cap = (b) => b.sampleRate * MAX_SECONDS;
const ms = (b, v) => Math.max(1, Math.floor((v / 1000) * b.sampleRate));
const TAU = Math.PI * 2;
// Build a new Buf of n frames, filling each channel via fn(src, out, ch).
const make = (b, n, fn) => ({
  sampleRate: b.sampleRate,
  channels: b.channels.map((src, ch) => {
    const out = new Float32Array(Math.max(1, Math.min(n, cap(b))));
    fn(src, out, ch);
    return out;
  }),
});
const map = (b, f) => make(b, len(b), (s, o, ch) => { for (let i = 0; i < o.length; i++) o[i] = f(s[i], i, ch); });
// Linear-interpolated read, 0 outside the buffer.
const at = (a, x) => { const j = Math.floor(x), f = x - j; return (a[j] ?? 0) * (1 - f) + (a[j + 1] ?? 0) * f; };
const lfo = (b, hz, i, phase = 0) => 0.5 + 0.5 * Math.sin((TAU * hz * i) / b.sampleRate + phase);

export const rmsOf = (b) => { let t = 0, n = 0; for (const c of b.channels) for (const v of c) if (Number.isFinite(v)) { t += v * v; n++; } return n ? Math.sqrt(t / n) : 0; };

/**
 * Scale to the target RMS (loudness), then soft-limit anything over 0.9 so peaks don't clip.
 * Keeps every step about as loud as its input, so A/B comparisons are fair.
 */
export function matchLoudness(b, target) {
  const r = rmsOf(b);
  if (r < 1e-6 || !(target > 1e-6)) return normalize(b);
  const g = Math.min(target, 0.35) / r;
  return map(b, (v) => { if (!Number.isFinite(v)) return 0; const x = v * g, a = Math.abs(x); return a <= 0.9 ? x : Math.sign(x) * (0.9 + 0.099 * Math.tanh((a - 0.9) / 0.099)); });
}

export function normalize(b) {
  let peak = 0;
  for (const c of b.channels) for (const v of c) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  const g = peak > 1e-6 ? 0.95 / peak : 0;
  return map(b, (v) => (Number.isFinite(v) ? v * g : 0));
}

// Split into n slices; returns [start, end) pairs.
const slices = (n, count) => Array.from({ length: count }, (_, i) => [Math.floor((i * n) / count), Math.floor(((i + 1) * n) / count)]);
const shuffled = (arr, r) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const concat = (b, parts) => {
  const n = parts.reduce((s, [a, e]) => s + e - a, 0);
  return make(b, n, (s, o) => { let k = 0; for (const [a, e] of parts) for (let i = a; i < e && k < o.length; i++) o[k++] = s[i]; });
};
const reverse = (b) => make(b, len(b), (s, o) => { for (let i = 0; i < o.length; i++) o[i] = s[s.length - 1 - i]; });

// Modulated delay line: y = dry*x + wet*x[i-d] + fb*y[i-d], d in samples from dFn(i, ch).
const modDelay = (b, dFn, { dry = 1, wet = 0.7, fb = 0, tail = 0 } = {}) =>
  make(b, len(b) + tail, (s, o, ch) => { for (let i = 0; i < o.length; i++) { const d = dFn(i, ch); o[i] = dry * (s[i] ?? 0) + wet * at(s, i - d) + fb * at(o, i - d); } });

// RBJ biquad with a per-sample-block cutoff from fFn(i). type: low | high | band | peak.
function biquad(b, type, fFn, q, gainDb = 0) {
  const A = 10 ** (gainDb / 40);
  return make(b, len(b), (s, o) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < o.length; i++) {
      if (i % 32 === 0) {
        const f = Math.min(b.sampleRate * 0.45, Math.max(20, fFn(i))), w = (TAU * f) / b.sampleRate, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
        let a0;
        if (type === "low") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else if (type === "high") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else if (type === "band") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
        else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; } // peak
        b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
      }
      const y = b0 * s[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = s[i]; y2 = y1; y1 = Number.isFinite(y) ? y : 0; o[i] = y1;
    }
  });
}

// Schroeder reverb: 4 parallel combs into 2 series allpasses.
function reverb(b, size, damp, mix) {
  const tail = Math.min(cap(b) - len(b), Math.floor(b.sampleRate * (0.5 + size * 2.5)));
  const combs = [29.7, 37.1, 41.1, 43.7].map((m) => ms(b, m * (0.6 + size))), aps = [5, 1.7].map((m) => ms(b, m));
  const fb = 0.7 + size * 0.25;
  return make(b, len(b) + Math.max(0, tail), (s, o) => {
    const wet = new Float32Array(o.length);
    for (const d of combs) { let lp = 0; const y = new Float32Array(o.length); for (let i = 0; i < o.length; i++) { const prev = i >= d ? y[i - d] : 0; lp = prev * (1 - damp) + lp * damp; y[i] = (s[i] ?? 0) + lp * fb; wet[i] += y[i] * 0.25; } }
    for (const d of aps) { const x = wet.slice(); for (let i = 0; i < o.length; i++) wet[i] = -0.5 * x[i] + (i >= d ? x[i - d] + 0.5 * wet[i - d] : 0); }
    for (let i = 0; i < o.length; i++) o[i] = (s[i] ?? 0) * (1 - mix) + wet[i] * mix;
  });
}

// Speed-varying playback: rateFn(t in 0..1) -> playback rate.
function varispeed(b, rateFn, n = len(b)) {
  return make(b, n, (s, o) => { let x = 0; for (let i = 0; i < o.length; i++) { o[i] = at(s, x); x += Math.max(0, rateFn(i / o.length)); } });
}

// Overlap-add time stretch: changes length by `ratio` while keeping pitch (some grain smear is part of the charm).
function stretchOLA(b, ratio, grainMs = 70) {
  const g = ms(b, grainMs), hopOut = g >> 2, hopIn = hopOut / ratio;
  return make(b, Math.floor(len(b) * ratio), (s, o) => {
    const norm = new Float32Array(o.length);
    for (let k = 0; k * hopOut < o.length; k++) {
      const src = Math.floor(k * hopIn), dst = k * hopOut;
      for (let i = 0; i < g && dst + i < o.length; i++) { const w = Math.sin((Math.PI * i) / g) ** 2; o[dst + i] += (s[src + i] ?? 0) * w; norm[dst + i] += w; }
    }
    for (let i = 0; i < o.length; i++) if (norm[i] > 1e-3) o[i] /= norm[i];
  });
}
// Envelope follower (0..1-ish) used by auto-wah.
function envelope(c, sr, attackMs = 5, releaseMs = 120) {
  const a = Math.exp(-1 / ((attackMs / 1000) * sr)), r = Math.exp(-1 / ((releaseMs / 1000) * sr)), out = new Float32Array(c.length);
  let e = 0;
  for (let i = 0; i < c.length; i++) { const x = Math.abs(c[i]); e = x > e ? a * e + (1 - a) * x : r * e + (1 - r) * x; out[i] = e; }
  return out;
}

// Intensity helpers: t is 0..1 (subtle .. extreme).
const L = (t, a, b) => a + (b - a) * t;
const I = (t, a, b) => Math.round(L(t, a, b));
const X = (t, a, b) => a * (b / a) ** t;
const P = (t, list) => list[Math.min(list.length - 1, Math.floor(t * list.length))];

/**
 * Each effect: family, at(t, seed) gives its params for intensity t (0 subtle .. 1 extreme), label(p), run(buf, p) is pure.
 * Each family has exactly 10 effects; a code chains effects from different families (see codes.js).
 */
export const EFFECTS = {
  // ── time ──
  reverse: { at: (t) => ({ rate: +L(t, 1, 0.55).toFixed(2) }), family: "time", label: (p) => (p.rate < 1 ? `reverse ×${p.rate}` : "reverse"), run: (b, p) => (p.rate < 1 ? varispeed(reverse(b), () => p.rate, Math.floor(len(b) / p.rate)) : reverse(b)) },
  mirror: { at: (t) => ({ frac: +L(t, 0.15, 1).toFixed(2) }), family: "time", label: (p) => `palindrome ${Math.round(p.frac * 100)}%`, run: (b, p) => { const n = len(b), m = Math.max(1, Math.floor(n * p.frac)); return make(b, n + m, (s, o) => { for (let i = 0; i < o.length; i++) o[i] = i < n ? s[i] : s[n - 1 - (i - n)]; }); } },
  shuffle: { at: (t, seed) => ({ n: I(t, 3, 40), seed }), family: "time", label: (p) => `shuffle ${p.n} slices`, run: (b, p) => concat(b, shuffled(slices(len(b), p.n), rng(p.seed))) },
  slicereverse: { at: (t) => ({ n: I(t, 2, 40) }), family: "time", label: (p) => `reverse ${p.n} slices`, run: (b, p) => concat(b, slices(len(b), p.n).flatMap(([a, e]) => Array.from({ length: e - a }, (_, k) => [e - 1 - k, e - k]))) },
  zigzag: { at: (t) => ({ n: I(t, 2, 40) }), family: "time", label: (p) => `zigzag ${p.n}`, run: (b, p) => concat(b, slices(len(b), p.n).flatMap(([a, e], k) => (k % 2 ? Array.from({ length: e - a }, (_, j) => [e - 1 - j, e - j]) : [[a, e]]))) },
  stretch: { at: (t) => ({ ms: I(t, 15, 90), times: I(t, 2, 5) }), family: "time", label: (p) => `stretch ×${p.times}`, run: (b, p) => concat(b, slices(len(b), Math.ceil(len(b) / ms(b, p.ms))).flatMap((sl) => Array(p.times).fill(sl))) },
  skip: { at: (t) => ({ ms: I(t, 40, 250), keep: +L(t, 0.85, 0.3).toFixed(2) }), family: "time", label: (p) => `skip ${p.ms}ms`, run: (b, p) => concat(b, slices(len(b), Math.ceil(len(b) / ms(b, p.ms))).map(([a, e]) => [a, a + Math.max(1, Math.floor((e - a) * p.keep))])) },
  triplets: { at: (t) => ({ n: I(t, 2, 16) }), family: "time", label: (p) => `triplets ×${p.n}`, run: (b, p) => concat(b, slices(len(b), p.n).flatMap(([a, e]) => { const t = Math.max(1, Math.floor((e - a) / 3)); return [[a, a + t], [a, a + t], [a, a + t]]; })) },
  halftime: { at: (t) => ({ ratio: +L(t, 1.25, 3).toFixed(2) }), family: "time", label: (p) => `slow ×${p.ratio}`, run: (b, p) => stretchOLA(b, p.ratio) },
  doubletime: { at: (t) => ({ ratio: +L(t, 0.85, 0.33).toFixed(2) }), family: "time", label: (p) => `fast ×${+(1 / p.ratio).toFixed(2)}`, run: (b, p) => stretchOLA(b, p.ratio, 50) },

  // ── pitch ──
  pitchshift: { at: (t) => ({ semis: I(t, 1, 12), win: 50 }),
    family: "pitch", label: (p) => `pitch ${p.semis > 0 ? "+" : ""}${p.semis}st`,
    // Two crossfaded read heads sweeping a short window: pitch changes, length doesn't.
    run: (b, p) => { const ratio = 2 ** (p.semis / 12), w = ms(b, p.win); return make(b, len(b), (s, o) => { for (let i = 0; i < o.length; i++) { const ph = (((1 - ratio) * i) % w + w) % w, ph2 = (ph + w / 2) % w, g = Math.sin((Math.PI * ph) / w); o[i] = at(s, i - ph) * g * g + at(s, i - ph2) * (1 - g * g); } }); },
  },
  pitchdown: { at: (t) => ({ semis: -I(t, 1, 24) }), family: "pitch", label: (p) => `pitch ${p.semis}st`, run: (b, p) => EFFECTS.pitchshift.run(b, { semis: p.semis, win: 80 }) },
  speed: { at: (t) => ({ rate: P(t, [0.25, 0.33, 0.5, 0.67, 0.8, 1.25, 1.5, 2, 3, 4]) }), family: "pitch", label: (p) => `speed ×${p.rate}`, run: (b, p) => varispeed(b, () => p.rate, Math.floor(len(b) / p.rate)) },
  harmony: { at: (t) => ({ semis: P(t, [3, 4, 5, 7, 9, 12, -5, -7, -12, 19]) }), family: "pitch", label: (p) => `harmony ${p.semis > 0 ? "+" : ""}${p.semis}st`, run: (b, p) => { const s = EFFECTS.pitchshift.run(b, { semis: p.semis, win: 50 }); return map(b, (v, i, ch) => v * 0.7 + s.channels[ch][i] * 0.6); } },
  chord: { at: (t) => ({ kind: P(t, ["minor", "major", "sus2", "sus4", "m7", "maj7", "7th", "add9", "power", "stack"]) }),
    family: "pitch", label: (p) => `${p.kind} chord`,
    run: (b, p) => { const iv = { minor: [3, 7], major: [4, 7], sus2: [2, 7], sus4: [5, 7], m7: [3, 7, 10], maj7: [4, 7, 11], "7th": [4, 7, 10], add9: [4, 7, 14], power: [7, 12], stack: [7, 12, 19] }[p.kind], voices = iv.map((st) => EFFECTS.pitchshift.run(b, { semis: st, win: 50 })); return map(b, (v, i, ch) => v + voices.reduce((t, x) => t + x.channels[ch][i], 0) * 0.55); },
  },
  detune: { at: (t) => ({ cents: I(t, 5, 50) }), family: "pitch", label: (p) => `detune ±${p.cents}c`, run: (b, p) => { const u = EFFECTS.pitchshift.run(b, { semis: p.cents / 100, win: 40 }), d = EFFECTS.pitchshift.run(b, { semis: -p.cents / 100, win: 40 }); return map(b, (v, i, ch) => v * 0.5 + u.channels[ch][i] * 0.5 + d.channels[ch][i] * 0.5); } },
  unison: { at: (t) => ({ cents: I(t, 4, 30) }), family: "pitch", label: (p) => `unison ±${p.cents}c`, run: (b, p) => { const vs = [-1, -0.5, 0.5, 1].map((k) => EFFECTS.pitchshift.run(b, { semis: (k * p.cents) / 100, win: 40 })); return make(b, len(b), (s, o, ch) => { for (let i = 0; i < o.length; i++) o[i] = s[i] * 0.6 + vs.reduce((t, x, k) => t + x.channels[(ch + k) % b.channels.length][i], 0) * 0.3; }); } },
  vibrato: { at: (t) => ({ hz: +L(t, 3, 11).toFixed(1), depth: +L(t, 0.4, 6).toFixed(1) }), family: "pitch", label: (p) => `vibrato ${p.hz}Hz`, run: (b, p) => modDelay(b, (i) => ms(b, 1) + lfo(b, p.hz, i) * ms(b, p.depth), { dry: 0, wet: 1 }) },
  warble: { at: (t) => ({ hz: +L(t, 0.3, 1.8).toFixed(2), amt: +L(t, 0.01, 0.12).toFixed(3) }), family: "pitch", label: (p) => `warble ${p.hz}Hz`, run: (b, p) => varispeed(b, (t) => 1 + p.amt * Math.sin(TAU * p.hz * t * (len(b) / b.sampleRate))) },
  glide: { at: (t) => ({ up: t >= 0.5, amt: +L(Math.abs(t - 0.5) * 2, 0.3, 1.6).toFixed(2) }), family: "pitch", label: (p) => `glide ${p.up ? "up" : "down"}`, run: (b, p) => varispeed(b, (t) => (p.up ? 1 + t * p.amt : Math.max(0.2, 1 - t * p.amt * 0.5))) },

  // ── mod ──
  chorus: { at: (t) => ({ hz: +L(t, 0.3, 3).toFixed(2), voices: I(t, 2, 4) }), family: "mod", label: (p) => `chorus ×${p.voices}`, run: (b, p) => modDelay(b, (i, ch) => ms(b, 15) + lfo(b, p.hz, i, ch * 1.3 + (i % p.voices) * 2.1) * ms(b, 12), { wet: 0.6 }) },
  ensemble: { at: (t) => ({ hz: +L(t, 0.15, 0.9).toFixed(2) }), family: "mod", label: () => "ensemble", run: (b, p) => modDelay(b, (i, ch) => ms(b, 12) + (lfo(b, p.hz, i, ch * 2.1) + lfo(b, p.hz * 1.7, i, 1 + ch)) * ms(b, 4), { dry: 0.8, wet: 0.7 }) },
  flanger: { at: (t) => ({ hz: +L(t, 0.1, 2).toFixed(2), depth: +L(t, 1, 8).toFixed(1), fb: +L(t, 0.3, 0.88).toFixed(2) }), family: "mod", label: (p) => `flanger ${p.hz}Hz`, run: (b, p) => modDelay(b, (i, ch) => ms(b, 0.5) + lfo(b, p.hz, i, ch * 0.5) * ms(b, p.depth), { wet: 0.7, fb: p.fb }) },
  phaser: { at: (t) => ({ hz: +L(t, 0.1, 2).toFixed(2), stages: P(t, [4, 6, 8]), fb: +L(t, 0, 0.75).toFixed(2) }),
    family: "mod", label: (p) => `phaser ${p.stages}-stage`,
    run: (b, p) => make(b, len(b), (s, o, ch) => {
      const z = new Float32Array(p.stages); let last = 0;
      for (let i = 0; i < o.length; i++) {
        const a = 0.2 + 0.75 * lfo(b, p.hz, i, ch), coef = (1 - a) / (1 + a);
        let x = s[i] + last * p.fb;
        for (let k = 0; k < p.stages; k++) { const y = -coef * x + z[k]; z[k] = x + coef * y; x = y; }
        last = x; o[i] = (s[i] + x) / 2;
      }
    }),
  },
  tremolo: { at: (t) => ({ hz: +L(t, 2, 16).toFixed(1), depth: +L(t, 0.4, 1).toFixed(2) }), family: "mod", label: (p) => `tremolo ${p.hz}Hz`, run: (b, p) => map(b, (v, i) => v * (1 - p.depth * lfo(b, p.hz, i))) },
  autopan: { at: (t) => ({ hz: +X(t, 0.2, 8).toFixed(2) }), family: "mod", label: (p) => `autopan ${p.hz}Hz`, run: (b, p) => map(b, (v, i, ch) => v * lfo(b, p.hz, i, ch * Math.PI)) },
  rotary: { at: (t) => ({ hz: +L(t, 0.8, 7).toFixed(1) }), family: "mod", label: (p) => `rotary ${p.hz}Hz`, run: (b, p) => { const v = modDelay(b, (i, ch) => ms(b, 1) + lfo(b, p.hz, i, ch * 1.6) * ms(b, 1.5), { dry: 0, wet: 1 }); return map(v, (x, i, ch) => x * (0.55 + 0.45 * lfo(b, p.hz, i, ch * Math.PI))); } },
  pump: { at: (t) => ({ hz: P(t, [1, 1, 2, 2, 2, 4, 4, 4, 8, 8]), depth: +L(t, 0.4, 1).toFixed(2) }), family: "mod", label: (p) => `pump ${p.hz}Hz`, run: (b, p) => map(b, (v, i) => { const ph = ((i * p.hz) / b.sampleRate) % 1; return v * (1 - p.depth * Math.exp(-ph * 8)); }) },
  wobble: { at: (t) => ({ hz: P(t, [0.5, 1, 1, 2, 2, 3, 4, 4, 6, 8]), q: +L(t, 3, 12).toFixed(1) }), family: "mod", label: (p) => `wobble ${p.hz}Hz`, run: (b, p) => biquad(b, "low", (i) => 150 * 2 ** (5 * lfo(b, p.hz, i)), p.q) },
  ringmod: { at: (t) => ({ hz: I(t, 30, 1500) }), family: "mod", label: (p) => `ring mod ${p.hz}Hz`, run: (b, p) => map(b, (v, i) => v * Math.sin((TAU * p.hz * i) / b.sampleRate)) },

  // ── space ──
  slapback: { at: (t) => ({ ms: I(t, 50, 160) }), family: "space", label: (p) => `slapback ${p.ms}ms`, run: (b, p) => { const d = ms(b, p.ms); return modDelay(b, () => d, { wet: 0.6, tail: d }); } },
  echo: { at: (t) => ({ ms: I(t, 60, 650), fb: +L(t, 0.3, 0.8).toFixed(2) }), family: "space", label: (p) => `echo ${p.ms}ms`, run: (b, p) => { const d = ms(b, p.ms); return modDelay(b, () => d, { wet: 0, fb: p.fb, tail: d * 4 }); } },
  pingpong: { at: (t) => ({ ms: I(t, 90, 500), fb: +L(t, 0.4, 0.8).toFixed(2) }),
    family: "space", label: (p) => `ping-pong ${p.ms}ms`,
    run: (b, p) => { const d = ms(b, p.ms); return make(b, len(b) + d * 6, (s, o, ch) => { for (let i = 0; i < o.length; i++) { let v = s[i] ?? 0; for (let k = 1; k <= 6; k++) if ((k + ch) % 2 === 0 || b.channels.length === 1) v += (s[i - k * d] ?? 0) * p.fb ** k; o[i] = v; } }); },
  },
  dotted: { at: (t) => ({ ms: I(t, 250, 450), fb: +L(t, 0.3, 0.65).toFixed(2) }),
    family: "space", label: (p) => `dotted delay ${p.ms}ms`,
    // Darkening echo, mixed under the dry signal; tempo sync snaps it to 3/8 or 3/4 of a beat.
    run: (b, p) => { const d = ms(b, p.ms); return make(b, len(b) + d * 5, (s, o) => { const y = new Float32Array(o.length); let lp = 0; for (let i = 0; i < o.length; i++) { const fb = i >= d ? y[i - d] : 0; lp += 0.35 * (fb - lp); y[i] = (s[i - d] ?? 0) + lp * p.fb; o[i] = (s[i] ?? 0) + y[i] * 0.55; } }); },
  },
  dub: { at: (t) => ({ ms: I(t, 150, 650), fb: +L(t, 0.5, 0.9).toFixed(2) }),
    family: "space", label: (p) => `dub echo ${p.ms}ms`,
    // Echo whose repeats get darker: one-pole lowpass inside the feedback loop.
    run: (b, p) => { const d = ms(b, p.ms); return make(b, len(b) + d * 6, (s, o) => { let lp = 0; for (let i = 0; i < o.length; i++) { const fbk = i >= d ? o[i - d] : 0; lp += 0.25 * (fbk - lp); o[i] = (s[i] ?? 0) + lp * p.fb; } }); },
  },
  plate: { at: (t) => ({ mix: +L(t, 0.2, 0.6).toFixed(2) }), family: "space", label: () => "plate", run: (b, p) => reverb(biquad(b, "high", () => 150, 0.7), 0.55, 0.05, p.mix) },
  reverb: { at: (t) => ({ size: +L(t, 0.15, 1).toFixed(2), damp: 0.35, mix: +L(t, 0.25, 0.8).toFixed(2) }), family: "space", label: (p) => `reverb ${Math.round(p.size * 100)}%`, run: (b, p) => reverb(b, p.size, p.damp, p.mix) },
  hall: { at: (t) => ({ mix: +L(t, 0.4, 0.9).toFixed(2) }), family: "space", label: () => "big hall", run: (b, p) => reverb(b, 1, 0.2, p.mix) },
  reversereverb: { at: (t) => ({ size: +L(t, 0.3, 1).toFixed(2) }), family: "space", label: () => "reverse reverb", run: (b, p) => reverse(reverb(reverse(b), p.size, 0.3, 0.75)) },
  shimmer: { at: (t) => ({ mix: +L(t, 0.25, 0.9).toFixed(2) }), family: "space", label: (p) => `shimmer ${Math.round(p.mix * 100)}%`, run: (b, p) => { const up = reverb(EFFECTS.pitchshift.run(b, { semis: 12, win: 50 }), 1, 0.2, 1); return make(b, len(up), (s, o, ch) => { for (let i = 0; i < o.length; i++) o[i] = (s[i] ?? 0) + up.channels[ch][i] * p.mix; }); } },

  // ── filter ──
  lowpass: { at: (t) => ({ hz: I(t, 3500, 200), q: +L(t, 0.7, 6).toFixed(1) }), family: "filter", label: (p) => `low-pass ${p.hz}Hz`, run: (b, p) => biquad(b, "low", () => p.hz, p.q) },
  highpass: { at: (t) => ({ hz: I(t, 200, 4000), q: +L(t, 0.7, 3).toFixed(1) }), family: "filter", label: (p) => `high-pass ${p.hz}Hz`, run: (b, p) => biquad(b, "high", () => p.hz, p.q) },
  bandpass: { at: (t) => ({ hz: I(t, 300, 3000), q: +L(t, 1, 10).toFixed(1) }), family: "filter", label: (p) => `band-pass ${p.hz}Hz`, run: (b, p) => biquad(b, "band", () => p.hz, p.q) },
  telephone: { at: (t) => ({ lo: I(t, 200, 900), hi: I(t, 5000, 1800) }), family: "filter", label: (p) => `telephone ${p.lo}-${p.hi}Hz`, run: (b, p) => biquad(biquad(b, "high", () => p.lo, 0.9), "low", () => p.hi, 0.9) },
  warm: { at: (t) => ({ drive: +L(t, 1.1, 3).toFixed(2) }), family: "filter", label: (p) => `warmth ×${p.drive}`, run: (b, p) => biquad(biquad(map(b, (v) => Math.tanh(v * p.drive) / Math.tanh(p.drive)), "peak", () => 200, 0.8, 4), "low", () => 7000, 0.7) },
  vowel: { at: (t) => ({ vowel: P(t, ["u", "o", "a", "e", "i"]), q: +L(t, 5, 12).toFixed(1) }), family: "filter", label: (p) => `vowel "${p.vowel}"`, run: (b, p) => { const [f1, f2] = { a: [800, 1150], e: [400, 1600], i: [270, 2300], o: [450, 800], u: [325, 700] }[p.vowel]; const x = biquad(b, "band", () => f1, p.q), y = biquad(b, "band", () => f2, p.q * 1.2); return map(x, (v, i, ch) => v + y.channels[ch][i] * 0.7); } },
  wah: { at: (t) => ({ hz: +L(t, 0.5, 6).toFixed(1), q: +L(t, 3, 10).toFixed(1) }), family: "filter", label: (p) => `wah ${p.hz}Hz`, run: (b, p) => biquad(b, "band", (i) => 350 * 2 ** (3 * lfo(b, p.hz, i)), p.q) },
  autowah: { at: (t) => ({ q: +L(t, 3, 9).toFixed(1), range: I(t, 1200, 3800) }), family: "filter", label: () => "auto-wah", run: (b, p) => { const e = envelope(b.channels[0], b.sampleRate); return biquad(b, "band", (i) => 250 + Math.min(1, e[i] * 3) * p.range, p.q); } },
  acid: { at: (t) => ({ hz: P(t, [1, 2, 2, 4, 4, 4, 8, 8, 8, 16]), q: +L(t, 5, 16).toFixed(1) }), family: "filter", label: (p) => `acid ${p.hz}Hz`, run: (b, p) => biquad(b, "low", (i) => 200 + 3000 * Math.exp(-(((i * p.hz) / b.sampleRate) % 1) * 5), p.q) },
  sweep: { at: (t) => ({ up: t >= 0.5, q: +L(Math.abs(t - 0.5) * 2, 2, 12).toFixed(1) }), family: "filter", label: (p) => `filter sweep ${p.up ? "up" : "down"}`, run: (b, p) => biquad(b, "low", (i) => { const t = i / len(b); return 100 * 2 ** (7.5 * (p.up ? t : 1 - t)); }, p.q) },

  // ── dirt ──
  tape: { at: (t) => ({ drive: +L(t, 1.3, 5).toFixed(1) }), family: "dirt", label: (p) => `tape sat ×${p.drive}`, run: (b, p) => biquad(map(b, (v) => Math.tanh(v * p.drive)), "low", () => 9000, 0.7) },
  overdrive: { at: (t) => ({ drive: I(t, 2, 12) }), family: "dirt", label: (p) => `overdrive ×${p.drive}`, run: (b, p) => biquad(map(b, (v) => { const x = v * p.drive; return x > 0 ? x / (1 + x) : x / (1 - 0.6 * x); }), "low", () => 5000, 0.7) },
  distort: { at: (t) => ({ drive: I(t, 2, 25) }), family: "dirt", label: (p) => `distort ×${p.drive}`, run: (b, p) => map(b, (v) => Math.tanh(v * p.drive)) },
  fuzz: { at: (t) => ({ k: I(t, 3, 20) }), family: "dirt", label: (p) => `fuzz ×${p.k}`, run: (b, p) => map(b, (v) => (v > 0 ? 1 - Math.exp(-v * p.k) : -0.6 * (1 - Math.exp(v * p.k * 0.7)))) },
  fold: { at: (t) => ({ k: +L(t, 1.3, 6).toFixed(1) }), family: "dirt", label: (p) => `wavefold ×${p.k}`, run: (b, p) => map(b, (v) => Math.sin(v * p.k)) },
  crunch: { at: (t) => ({ bits: I(t, 7, 3), drive: I(t, 3, 20) }), family: "dirt", label: (p) => `crunch ${p.bits}-bit`, run: (b, p) => { const q = 2 ** (p.bits - 1); return map(b, (v) => Math.round(Math.tanh(v * p.drive) * q) / q); } },
  bitcrush: { at: (t) => ({ bits: +L(t, 8, 2.5).toFixed(1) }), family: "dirt", label: (p) => `bitcrush ${p.bits}-bit`, run: (b, p) => { const q = 2 ** (p.bits - 1); return map(b, (v) => Math.round(v * q) / q); } },
  decimate: { at: (t) => ({ hold: I(t, 2, 40) }), family: "dirt", label: (p) => `decimate ÷${p.hold}`, run: (b, p) => make(b, len(b), (s, o) => { for (let i = 0; i < o.length; i++) o[i] = s[i - (i % p.hold)]; }) },
  lofi: { at: (t, seed) => ({ seed, hold: I(t, 2, 6), hz: I(t, 6000, 2000) }), family: "dirt", label: (p) => `lo-fi ${p.hz}Hz`, run: (b, p) => EFFECTS.vinyl.run(EFFECTS.warble.run(biquad(EFFECTS.decimate.run(b, { hold: p.hold }), "low", () => p.hz, 0.8), { hz: 0.4, amt: 0.015 }), { seed: p.seed, crackle: 0.0008 }) },
  vinyl: { at: (t, seed) => ({ seed, crackle: +L(t, 0.0003, 0.004).toFixed(4) }),
    family: "dirt", label: () => "vinyl",
    run: (b, p) => { const r = rng(p.seed), n = len(b), noise = Float32Array.from({ length: n }, () => (r() < p.crackle ? (r() - 0.5) * 1.5 : (r() - 0.5) * 0.02)); return biquad(map(b, (v, i) => v * 0.8 + noise[i]), "low", () => 6000, 0.7); },
  },

  // ── glitch ──
  gate: { at: (t) => ({ hz: +X(t, 2, 30).toFixed(1), duty: +L(t, 0.7, 0.25).toFixed(2) }), family: "glitch", label: (p) => `gate ${p.hz}Hz`, run: (b, p) => map(b, (v, i) => (((i * p.hz) / b.sampleRate) % 1 < p.duty ? v : 0)) },
  repeater: { at: (t) => ({ n: I(t, 4, 32), times: I(t, 2, 6) }), family: "glitch", label: (p) => `repeater ${p.n}×${p.times}`, run: (b, p) => concat(b, slices(len(b), p.n).flatMap(([a, e]) => { const w = Math.max(1, Math.floor((e - a) / p.times)); return Array(p.times).fill([a, a + w]); })) },
  revgrains: { at: (t) => ({ ms: I(t, 160, 25) }), family: "glitch", label: (p) => `reverse grains ${p.ms}ms`, run: (b, p) => { const w = ms(b, p.ms); return make(b, len(b), (s, o) => { for (let i = 0; i < o.length; i++) { const a = i - (i % w), k = i % w; o[i] = (s[a + w - 1 - k] ?? 0) * Math.sin((Math.PI * k) / w); } }); } },
  slowslices: { at: (t) => ({ n: I(t, 3, 20) }), family: "glitch", label: (p) => `slow slices ×${p.n}`, run: (b, p) => { const sl = slices(len(b), p.n), parts = sl.map(([a, e]) => varispeed(concat(b, [[a, e]]), () => 0.5, e - a)); return make(b, len(b), (s, o, ch) => { let k = 0; for (const x of parts) { o.set(x.channels[ch].subarray(0, Math.min(len(x), o.length - k)), k); k += len(x); } }); } },
  granular: { at: (t, seed) => ({ grainMs: I(t, 120, 10), density: +L(t, 0.8, 3).toFixed(2), seed }),
    family: "glitch", label: (p) => `granular ${p.grainMs}ms`,
    run: (b, p) => { const n = len(b), g = Math.max(2, ms(b, p.grainMs)), count = Math.ceil((n / g) * p.density), r = rng(p.seed), grains = Array.from({ length: count }, () => [Math.floor(r() * n), Math.floor(r() * Math.max(1, n - g))]); return make(b, n, (s, o) => { for (const [dst, src] of grains) for (let i = 0; i < g && dst + i < o.length; i++) o[dst + i] += (s[src + i] ?? 0) * Math.sin((Math.PI * i) / g); }); },
  },
  cutup: { at: (t, seed) => ({ n: I(t, 6, 40), seed }), family: "glitch", label: (p) => `cut-up ${p.n}`, run: (b, p) => { const sl = slices(len(b), p.n), r = rng(p.seed); return concat(b, Array.from({ length: p.n }, () => r.pick(sl))); } },
  beatrepeat: { at: (t, seed) => ({ grid: P(t, [4, 8, 8, 16, 16, 16, 32, 32, 32, 64]), chance: +L(t, 0.15, 0.6).toFixed(2), seed }), family: "glitch", label: (p) => `beat repeat 1/${p.grid}`, run: (b, p) => { const r = rng(p.seed), sl = slices(len(b), p.grid); let last = sl[0]; return concat(b, sl.map((x) => (r() < p.chance ? last : (last = x)))); } },
  scratch: { at: (t) => ({ hz: +L(t, 1, 6).toFixed(1), depth: +L(t, 0.4, 2).toFixed(2) }), family: "glitch", label: (p) => `scratch ${p.hz}Hz`, run: (b, p) => make(b, len(b), (s, o) => { let x = 0; for (let i = 0; i < o.length; i++) { o[i] = at(s, Math.max(0, x)); x += 1 + p.depth * Math.sin((TAU * p.hz * i) / b.sampleRate) * 1.5; } }) },
  glitchpitch: { at: (t, seed) => ({ n: I(t, 4, 24), seed }), family: "glitch", label: (p) => `glitch pitch ×${p.n}`, run: (b, p) => { const r = rng(p.seed), rates = Array.from({ length: p.n }, () => (r() < 0.5 ? 1 : r.pick([0.5, 2, 1.5, 0.75, 3]))); return varispeed(b, (t) => rates[Math.min(p.n - 1, Math.floor(t * p.n))]); } },
  dropout: { at: (t, seed) => ({ ms: I(t, 200, 30), chance: +L(t, 0.1, 0.5).toFixed(2), seed }), family: "glitch", label: (p) => `dropout ${Math.round(p.chance * 100)}%`, run: (b, p) => { const w = ms(b, p.ms), r = rng(p.seed), holes = Array.from({ length: Math.ceil(len(b) / w) }, () => r() < p.chance); return map(b, (v, i) => (holes[Math.floor(i / w)] ? 0 : v)); } },
};
export const EFFECT_NAMES = Object.keys(EFFECTS);
export const FAMILIES = ["time", "pitch", "mod", "space", "filter", "dirt", "glitch"];
export const byFamily = (f) => EFFECT_NAMES.filter((n) => EFFECTS[n].family === f);
