import { createHistory } from "./history.js";
import { describe, isValidCode, MAX_CODE } from "./codes.js";
import { encodeWav } from "./wav.js";
import { createScope, drawOverview } from "./scope.js";
import { keyAction } from "./keys.js";
import * as settingsStore from "./settings.js";
import * as favStore from "./favs.js";
import { entryCode, popDigit, pushDigit } from "./entry.js";
import { buildInfo } from "./build-info.js";
import { analyze } from "./analyze.js";
import { EFFECT_NAMES, MAX_SECONDS } from "./effects.js";
import { SAMPLES } from "./samples.js";
import { createUiSounds } from "./ui-sounds.js";
import { t } from "./i18n.js";
/* global __BUILD__ */

const $ = (id) => document.getElementById(id);
const el = (tag, { dataset, ...props } = {}) => { const e = Object.assign(document.createElement(tag), props); Object.assign(e.dataset, dataset); return e; };
const ctx = new AudioContext();
// Mobile browsers keep audio locked until a real tap. Playback often starts later (after a render), outside
// that gesture, so unlock once on the first touch/click: resume and play one silent sample.
// iOS also mutes Web Audio when the ring/silent switch is on silent, unless the session is "playback".
if (navigator.audioSession) navigator.audioSession.type = "playback";
const unlockAudio = () => {
  ctx.resume();
  const s = ctx.createBufferSource();
  s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  s.connect(ctx.destination);
  s.start();
  if (ctx.state === "running") for (const t of ["pointerdown", "touchend", "keydown"]) document.removeEventListener(t, unlockAudio, true);
};
for (const t of ["pointerdown", "touchend", "keydown"]) document.addEventListener(t, unlockAudio, true);
let history = null, source = null, startedAt = 0, name = "sample", scope = null, env = {};
let settings = settingsStore.load(), favs = favStore.load();
let entry = "";
let pending = null; // { code, buf }: a code being auditioned, not kept yet
let region = null; // [a, b] loop region as fractions of the audible buffer
const color = () => settingsStore.themeColor(settings.theme);
const sfx = createUiSounds(ctx);
const pad3 = (c) => String(c).padStart(3, "0");
const tr = t;

// Audio graph: source -> destination, and source -> splitter -> [analyserL, analyserR] for the scope.
const splitter = ctx.createChannelSplitter(2);
const analysers = [0, 1].map((ch) => { const a = ctx.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.6; a.minDecibels = -95; a.maxDecibels = -5; splitter.connect(a, ch); return a; });

// Effects render in a worker; only the newest request per purpose matters.
const worker = new Worker(new URL("./dsp-worker.js", import.meta.url), { type: "module" });
let reqId = 0;
const waiting = new Map();
// A crashed worker never answers: fail every waiting render so the action queue doesn't hang.
worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || "worker crashed")); waiting.clear(); };
worker.onmessage = ({ data }) => { const w = waiting.get(data.id); waiting.delete(data.id); if (!w) return; data.error ? w.reject(new Error(data.error)) : w.resolve(data.buf); };
const renderCodes = (buf, codes) => new Promise((resolve, reject) => { const id = ++reqId; waiting.set(id, { resolve, reject }); worker.postMessage({ id, buf, codes, bpm: env.bpm }); });

const status = (msg) => ($("status").textContent = msg);
const hashCodes = () => location.hash.slice(1).split(".").filter(Boolean).map(Number).filter(isValidCode);
/** What you hear: the auditioned code if there is one, else the kept result. */
const audible = () => pending?.buf ?? history.current;
/** The code S saves: the one being auditioned, else the last one kept. */
const favCode = () => pending?.code ?? history?.chain.at(-1) ?? null;
const duration = () => audible().channels[0].length / audible().sampleRate;

/** Fill in every UI string from i18n.js. */
function applyLabels() {
  for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = tr(n.dataset.i18n);
  for (const n of document.querySelectorAll("[data-i18n-title]")) n.title = tr(n.dataset.i18nTitle);
  $("playLabel").textContent = tr(source ? "stop" : "play");
}

function setSettings(patch) {
  settings = settingsStore.sanitize({ ...settings, ...patch });
  settingsStore.save(settings);
  document.documentElement.style.setProperty("--fg", color());
  $("color").textContent = settings.theme.startsWith("#") ? tr("custom") : settings.theme;
  $("custom").value = color();
  for (const b of $("swatches").children) b.setAttribute("aria-pressed", b.dataset.theme === settings.theme);
  if (history) overview(playhead());
}

// ── playback ──
const loopBounds = () => (region ? [region[0] * duration(), region[1] * duration()] : [0, duration()]);
function playhead() {
  if (!source) return null;
  const [a, b] = loopBounds(), t = ctx.currentTime - startedAt;
  return (a + (t % (b - a))) / duration();
}
const clock = (t) => { const cs = Math.round(t * 100); return `${Math.floor(cs / 6000)}:${((cs % 6000) / 100).toFixed(2).padStart(5, "0")}`; };
const showTime = (p) => ($("time").textContent = `${clock((p ?? 0) * duration())} / ${clock(duration())}`);
const overview = (p) => drawOverview($("wave"), audible(), p, color(), region);
function tick() { if (!source) return; const p = playhead(); overview(p); showTime(p); requestAnimationFrame(tick); }

function stop() {
  const s = source; source = null;
  s?.stop();
  $("playLabel").textContent = tr("play");
  if (history) { overview(null); showTime(0); }
}

function play(from = null) {
  stop();
  const { sampleRate, channels } = audible();
  const ab = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((c, i) => ab.copyToChannel(c, i));
  const s = ctx.createBufferSource();
  s.buffer = ab;
  s.connect(ctx.destination);
  s.connect(splitter);
  s.loop = true; // keep the sound going while you try codes
  const [a, b] = loopBounds();
  if (region) { s.loopStart = a; s.loopEnd = b; }
  ctx.resume();
  const at = from == null ? a : Math.min(Math.max(from * ab.duration, a), b - 0.001);
  startedAt = ctx.currentTime - (at - a);
  s.start(0, at);
  source = s;
  $("playLabel").textContent = tr("stop");
  tick();
}

// ── chain / HUD ──
/** Change the history (undo, clear, jump to a chip or favourite…), then redraw and play the result. */
function commit(mutate) {
  discard();
  mutate(history);
  render();
  play();
}

let chainKey = null; // the chip row only rebuilds when the chain (or tempo, which changes labels) changes
function render() {
  const codes = history.chain;
  $("undo").disabled = $("clear").disabled = codes.length === 0;
  const key = `${codes.join(".")}|${env.bpm}`;
  if (key !== chainKey) {
    chainKey = key;
    const chip = (label, n, title) => { const li = el("li"); li.append(el("button", { textContent: label, title, onclick: () => { sfx.undo(); commit((h) => h.truncate(n)); } })); return li; };
    $("chain").replaceChildren(...(codes.length ? [chip("orig", 0, tr("orig")), ...codes.map((c, i) => chip(pad3(c), i + 1, describe(c, env)))] : []));
    window.history.replaceState(null, "", codes.length ? `#${codes.join(".")}` : location.pathname + location.search);
  }
  $("crop").hidden = !region;
  $("favBtn").classList.toggle("on", favs.includes(favCode()));
  status(`${name} · ${duration().toFixed(2)}s`);
  overview(playhead());
  showTime(playhead());
}

function showEntry() {
  const d = $("digits"), c = entryCode(entry);
  d.className = entry ? "on" : "";
  d.replaceChildren(...(entry ? [el("span", { className: "ghost", textContent: "0".repeat(3 - entry.length) }), entry] : []));
  const hint = pending ? [el("span", { className: "hint", textContent: tr(pending.buf ? "hintKeep" : "rendering") })] : [];
  $("preview").replaceChildren(...(c == null ? [] : [describe(c, env), ...hint]));
}

// Flash the kept code big, then fade out.
function fire(code) {
  const d = $("digits");
  d.textContent = pad3(code);
  d.className = "";
  void d.offsetWidth; // restart animation
  d.className = "fire";
}

/** Audition a code: hear it as soon as the worker finishes, keep it with Enter. */
async function audition(code) {
  if (!history || !isValidCode(code)) return;
  const wasPlaying = !!source || !pending, from = history.current;
  entry = pad3(code);
  const mine = (pending = { code, buf: null });
  region = null;
  showEntry();
  try {
    const buf = await renderCodes(from, [code]);
    if (pending !== mine || history.current !== from) return; // superseded while rendering
    mine.buf = buf;
  } catch (e) { if (pending === mine) { pending = null; showEntry(); } return status(tr("renderFailed", { msg: e.message })); }
  showEntry();
  render();
  if (wasPlaying) play();
}

function discard() {
  if (!pending) return;
  pending = null;
  if (history) { render(); if (source) play(); }
}

let keeping = false;
async function keep(code) {
  if (!history || !isValidCode(code)) { sfx.error(); return status(tr("codeRange", { max: MAX_CODE })); }
  if (keeping) return;
  keeping = true;
  let buf;
  const from = history.current;
  try { buf = pending?.code === code && pending.buf ? pending.buf : await renderCodes(from, [code]); }
  catch (e) { return status(tr("renderFailed", { msg: e.message })); }
  finally { keeping = false; }
  if (history.current !== from) return; // history moved (undo/jump) while rendering
  pending = null;
  if (!history.push(code, buf)) { render(); if (source) play(); return status(tr("tooMany")); }
  entry = "";
  $("preview").replaceChildren();
  sfx.keep();
  fire(code);
  render();
  play();
}

// ── loading ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "Analyzing" readout: reveals the waveform left to right while real measurements type out. */
async function scan(buf, label, a) {
  const cv = $("scanWave"), log = $("scanLog"), steps = [
    tr("scanFile", { name: label }),
    `${a.sampleRate} Hz · ${a.channels === 1 ? tr("mono") : a.channels === 2 ? tr("stereo") : a.channels + " ch"} · ${a.seconds.toFixed(2)} s`,
    `peak ${a.peakDb.toFixed(1)} dB · rms ${a.rmsDb.toFixed(1)} dB`,
    tr("brightness", { hz: Math.round(a.pitchHz) }) + (a.bpm ? ` · ${tr("tempo", { bpm: a.bpm })}` : ""),
    tr("mapping", { codes: MAX_CODE + 1, fx: EFFECT_NAMES.length }),
    tr("ready"),
  ];
  log.replaceChildren();
  $("scan").hidden = false;
  const frames = 28;
  for (let f = 1; f <= frames; f++) {
    const p = f / frames;
    drawOverview(cv, buf, p, color());
    const g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(cv.width * p + 3, 0, cv.width, cv.height); // hide what isn't "scanned" yet
    $("scanBar").textContent = `[${"#".repeat(Math.round(p * 30)).padEnd(30, ".")}] ${Math.round(p * 100)}%`;
    if (f % Math.ceil(frames / steps.length) === 0 || f === frames) { const next = steps[log.children.length]; if (next) log.append(el("li", { textContent: next })); }
    await sleep(45);
  }
  await sleep(350);
  $("scan").hidden = true;
}

async function start(original, label, codes = hashCodes()) {
  stop();
  const a = analyze(original);
  await scan(original, label, a);
  name = label.replace(/\.[a-z0-9]{1,5}$/i, ""); // strip a file extension only, not "my.song crop"
  env = { bpm: a.bpm };
  history = createHistory(original, env);
  pending = null; region = null; entry = "";
  // Replay a shared chain step by step in the worker, keeping each step for undo.
  for (const c of codes) history.push(c, await renderCodes(history.current, [c]));
  $("editor").hidden = false;
  $("drop").hidden = true;
  scope ??= createScope($("scope"), analysers, color);
  showEntry();
  renderFavs(); // tooltips describe codes at this sample's tempo
  render();
}

/** Loading failed: drop the overlay and fall back to whatever was loaded before. */
function loadFailed(e) {
  $("scan").hidden = true;
  $("editor").hidden = !history;
  status(tr("cantLoad", { msg: e.message }));
}

async function load(file) {
  try {
    status(tr("decoding"));
    // Older mobile Safari lacks file.arrayBuffer() and promise-based decodeAudioData, so use the portable forms.
    const bytes = await (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
    const ab = await new Promise((resolve, reject) => {
      // Newer browsers also return a promise that rejects alongside the callback; swallow it to avoid a duplicate unhandled error.
      ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error("unsupported audio format")))?.catch?.(() => {});
    });
    const max = ab.sampleRate * MAX_SECONDS; // effects never output more than this, so trim up front and say so
    await start({ sampleRate: ab.sampleRate, channels: Array.from({ length: ab.numberOfChannels }, (_, i) => ab.getChannelData(i).slice(0, max)) }, file.name);
    if (ab.length > max) status(tr("trimmed", { s: MAX_SECONDS }));
  } catch (e) {
    loadFailed(e);
  }
}

// ── favourites ──
function renderFavs() {
  const list = $("favList");
  list.replaceChildren(...favs.map((code, i) => {
    const li = el("li"), go = el("button", { textContent: pad3(code), title: describe(code, env) }), x = el("button", { textContent: "×", title: tr("remove"), className: "x" });
    go.onclick = () => { sfx.click(); $("favs").hidden = true; void audition(code); }; // hear it; Enter keeps it
    x.onclick = () => { sfx.undo(); favs = favStore.removeFav(favs, i); favStore.save(favs); renderFavs(); if (history) render(); };
    li.append(go, x);
    return li;
  }));
  if (!favs.length) list.append(el("li", { className: "empty", textContent: tr("favEmpty") }));
}

// ── actions ──
// Auditions are not awaited: a newer one supersedes an older one, so typing never queues behind a render.
const actions = {
  apply: () => { const c = entryCode(entry); if (c != null) keep(c); else if (history) sfx.error(); },
  dice: () => { if (!history) return; sfx.click(); void audition(Math.floor(Math.random() * (MAX_CODE + 1))); },
  digit: (k) => {
    if (!history) return;
    if (pending) { discard(); entry = ""; }
    sfx.tick(Number(k));
    entry = pushDigit(entry, k);
    if (entry.length === 3) { void audition(Number(entry)); return; }
    showEntry();
    render();
  },
  backspace: () => { if (entry) { sfx.discard(); entry = popDigit(entry); discard(); showEntry(); } else actions.undo(); },
  escape: () => {
    if (POPS.some((p) => !$(p).hidden)) { for (const p of POPS) $(p).hidden = true; return; }
    if (entry || pending) sfx.discard();
    entry = ""; discard(); showEntry();
    if (region) { region = null; if (history) { render(); if (source) play(); } }
    document.activeElement.blur();
  },
  undo: () => { if (!history) return; if (!history.chain.length) return sfx.error(); sfx.undo(); commit((h) => h.undo()); },
  play: () => { if (!history) return; sfx.click(); source ? stop() : play(); },
  download: () => {
    if (!history) return;
    sfx.click();
    const a = el("a", { href: URL.createObjectURL(new Blob([encodeWav(history.current)], { type: "audio/wav" })), download: `${name}${history.chain.length ? "_" + history.chain.join("-") : ""}.wav` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  fav: () => {
    const code = favCode();
    if (code == null) { sfx.error(); return status(tr("applyFirst")); }
    sfx.keep();
    favs = favStore.addFav(favs, code); favStore.save(favs); renderFavs(); render();
    status(tr("saved", { code: pad3(code) }));
  },
  crop: () => {
    if (!history || !region) return;
    sfx.click();
    const b = audible(), n = b.channels[0].length, [a, z] = region.map((f) => Math.round(f * n));
    start({ sampleRate: b.sampleRate, channels: b.channels.map((c) => c.slice(a, z)) }, `${name.replace(/ \(built-in\)$/, "")} crop`, []).catch(loadFailed);
  },
  fullscreen: () => {
    sfx.click();
    if (document.fullscreenElement) return document.exitFullscreen();
    document.documentElement.requestFullscreen?.().catch(() => status(tr("noFullscreen")));
  },
  clear: () => { if (!history) return; sfx.undo(); commit((h) => h.truncate(0)); },
};

// Actions that render run one at a time, in order, so a keep can't race the next audition.
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn).catch((e) => status(tr("error", { msg: e.message }))));

// ── wiring ──
$("file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; f && load(f); };
const drop = $("drop");
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = () => drop.classList.remove("over"); // load happens in document.ondrop (event bubbles)
drop.onclick = (e) => { if (!e.target.closest("button, input")) { sfx.click(); $("file").click(); } }; // buttons and the file input itself (its click bubbles here) do their own thing
document.ondragover = (e) => e.preventDefault();
document.ondrop = (e) => { e.preventDefault(); e.dataTransfer.files[0] && load(e.dataTransfer.files[0]); };
$("samples").onclick = (e) => { const s = e.target.dataset?.sample; if (s) { sfx.click(); start(SAMPLES[s](), `${s} (built-in)`).catch(loadFailed); } };

// Touch: tapping the screen focuses a hidden numeric field; its typed digits feed the entry.
$("tap").oninput = (e) => { for (const d of e.target.value.replace(/\D/g, "")) actions.digit(d); e.target.value = ""; };
for (const id of ["apply", "dice", "undo", "clear", "play", "download", "crop"]) $(id).onclick = () => run(actions[id]);
// Popovers: colour palette and favourites.
$("swatches").replaceChildren(...settingsStore.THEMES.map(({ name: n, color: c }) => { const b = el("button", { title: n, dataset: { theme: n }, onclick: () => { sfx.click(); setSettings({ theme: n }); } }); b.style.setProperty("--c", c); return b; }));
const POPS = ["palette", "favs"];
const popover = (btn, panel) => {
  $(btn).onclick = (e) => {
    e.stopPropagation();
    sfx.click();
    const open = $(panel).hidden;
    for (const p of POPS) $(p).hidden = true;
    $(panel).hidden = !open;
    // Used by the phone layout, where popovers are pinned to the viewport just below their button.
    document.documentElement.style.setProperty("--pop-top", `${Math.round($(btn).getBoundingClientRect().bottom + 6)}px`);
  };
  $(panel).onclick = (e) => e.stopPropagation();
};
popover("color", "palette");
popover("favBtn", "favs");
$("saveFav").onclick = actions.fav;
document.addEventListener("click", () => { for (const p of POPS) $(p).hidden = true; });
$("custom").oninput = (e) => setSettings({ theme: e.target.value });
$("full").onclick = actions.fullscreen;
$("load").onclick = () => { sfx.click(); $("file").click(); };

// Waveform strip: click plays from there; drag selects a loop region.
{
  const wave = $("wave");
  let down = null;
  const frac = (e) => { const r = wave.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  wave.onpointerdown = (e) => { if (!history) return; down = frac(e); wave.setPointerCapture(e.pointerId); };
  wave.onpointermove = (e) => { if (down == null) return; const f = frac(e); if (Math.abs(f - down) > 0.01) { region = [Math.min(down, f), Math.max(down, f)]; overview(playhead()); } };
  wave.onpointercancel = () => { down = null; };
  wave.onpointerup = (e) => {
    if (down == null) return;
    const f = frac(e), dragged = Math.abs(f - down) > 0.01;
    down = null;
    if (!dragged) { region = null; play(f); } else play(region[0]);
    $("crop").hidden = !region;
  };
}


document.addEventListener("keydown", (e) => {
  const t = e.target, typing = t.matches?.("input[type=text], select");
  const a = keyAction(e, typing);
  if (!a) return;
  e.preventDefault();
  ctx.resume(); // browsers start audio suspended until a gesture
  run(() => actions[a](e.key));
});

applyLabels();
setSettings({});
renderFavs();
status(hashCodes().length ? tr("replay", { chain: hashCodes().join(" › ") }) : tr("ready"));
$("build").textContent = buildInfo(__BUILD__);
