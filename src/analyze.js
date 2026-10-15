/** Quick facts about a Buf for the load-time "analyzing" readout. Pure. */
export function analyze({ sampleRate, channels }) {
  const d = channels[0], n = d.length;
  let peak = 0, sq = 0, zc = 0;
  for (const c of channels) for (const v of c) { const a = Math.abs(v); if (a > peak) peak = a; sq += v * v; }
  for (let i = 1; i < n; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) zc++;
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -Infinity);
  return {
    seconds: n / sampleRate,
    sampleRate,
    channels: channels.length,
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sq / (n * channels.length))),
    pitchHz: zc / 2 / (n / sampleRate), // rough brightness/pitch from zero crossings
    bpm: tempo(d, sampleRate),
  };
}

/** Tempo from autocorrelation of a 100 Hz onset envelope; null if too short or flat. */
export function tempo(d, sampleRate) {
  const hop = Math.floor(sampleRate / 100), frames = Math.floor(d.length / hop);
  if (frames < 300) return null; // need ~3 s
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let e = 0; for (let i = f * hop; i < (f + 1) * hop; i++) e += d[i] * d[i]; env[f] = e; }
  const onset = env.map((e, f) => Math.max(0, e - (env[f - 1] ?? 0)));
  let best = 0, bestLag = 0;
  for (let lag = Math.round(6000 / 180); lag <= Math.round(6000 / 60); lag++) { // 60-180 bpm
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return best > 0 ? Math.round(6000 / bestLag) : null;
}
