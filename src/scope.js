const PERSIST = 0.75; // trail: 0 = none, 1 = forever

/** Split-channel scope fed by two AnalyserNodes: left on top, right on the bottom. getColor() -> css colour. */
export function createScope(canvas, analysers, getColor) {
  const g = canvas.getContext("2d");
  const [aL, aR] = analysers;
  const tL = new Float32Array(aL.fftSize), tR = new Float32Array(aR.fftSize);

  function frame() {
    const color = getColor(), { width: w, height: h } = canvas;
    g.fillStyle = `rgba(0,0,0,${1 - PERSIST})`; g.fillRect(0, 0, w, h);
    g.strokeStyle = g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 10;
    g.lineWidth = 2;
    aL.getFloatTimeDomainData(tL); aR.getFloatTimeDomainData(tR);
    [[tL, h * 0.27], [tR, h * 0.73]].forEach(([d, mid]) => {
      g.beginPath();
      for (let i = 0; i < d.length; i++) { const x = (i / d.length) * w, y = mid - d[i] * h * 0.22; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    });
    g.globalAlpha = 0.3; g.fillRect(0, h / 2, w, 1); g.globalAlpha = 1;
    g.shadowBlur = 0;
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf) };
}

// The min/max waveform scan touches every sample, so cache it per (buffer, colour) and only redraw the overlays each frame.
const overviewCache = new WeakMap();
function overviewImage(buf, color, w, h) {
  const hit = overviewCache.get(buf);
  if (hit && hit.color === color && hit.img.width === w && hit.img.height === h) return hit.img;
  const img = Object.assign(document.createElement("canvas"), { width: w, height: h });
  paintOverview(img.getContext("2d"), buf, color, w, h);
  overviewCache.set(buf, { color, img });
  return img;
}

/** Min/max overview of the whole buffer, an optional loop region [a, b] (0..1) and a playhead (0..1 or null). */
export function drawOverview(canvas, buf, playhead, color, region = null) {
  const g = canvas.getContext("2d"), { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  g.drawImage(overviewImage(buf, color, w, h), 0, 0);
  g.fillStyle = color;
  if (region) {
    const [a, b] = region;
    g.globalAlpha = 0.18; g.fillRect(a * w, 0, (b - a) * w, h);
    g.globalAlpha = 1; g.fillRect(a * w, 0, 2, h); g.fillRect(b * w - 2, 0, 2, h);
  }
  if (playhead != null) g.fillRect(Math.floor(playhead * w), 0, 3, h);
}

function paintOverview(g, { channels }, color, w, h) {
  const d = channels[0], step = d.length / w, mid = h / 2;
  g.fillStyle = color;
  g.globalAlpha = 0.7;
  for (let x = 0; x < w; x++) {
    let lo = 0, hi = 0;
    for (let i = Math.floor(x * step), e = Math.floor((x + 1) * step); i < e; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
  }
  g.globalAlpha = 1;
}
