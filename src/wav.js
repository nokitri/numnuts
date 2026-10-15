/** Encode a Buf as a 16-bit PCM WAV Blob-able ArrayBuffer. */
export function encodeWav({ sampleRate, channels }) {
  const nc = channels.length, n = channels[0].length, dataLen = n * nc * 2;
  const v = new DataView(new ArrayBuffer(44 + dataLen));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, channels[c][i])) * 0x7fff, true);
  return v.buffer;
}
