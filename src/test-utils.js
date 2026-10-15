export const sine = (seconds = 0.5, sampleRate = 8000, ch = 2) => ({
  sampleRate,
  channels: Array.from({ length: ch }, () => Float32Array.from({ length: seconds * sampleRate }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5)),
});
