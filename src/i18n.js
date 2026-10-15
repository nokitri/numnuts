/** UI strings. `{x}` placeholders are filled by t(). */
const STRINGS = {
  drop: "drop an audio sample or click to choose", formats: "wav · mp3 · m4a · ogg · flac · voice memos", tryBuiltin: "or try a built-in:",
  keep: "keep", random: "random", undo: "undo", clear: "clear", crop: "crop loop", play: "play", stop: "stop", load: "load",
  saveCode: "★ save current code",
  analyzing: "analyzing sample", ready: "ready", custom: "custom", remove: "remove", orig: "back to the original",
  tFav: "favourites", tFull: "fullscreen", tColor: "colour",
  tCrop: "make the looped region the new sample", tWave: "click to play from here, drag to loop a region",
  hintKeep: "⏎ keep · esc discard", rendering: "rendering…",
  renderFailed: "render failed: {msg}", codeRange: "code must be 0-{max}", tooMany: "too many steps, undo some", cantLoad: "couldn't load: {msg}", trimmed: "trimmed to the first {s} s", decoding: "decoding…",
  favEmpty: "nothing yet: save a code with the button above", applyFirst: "try a code first, then save it", saved: "saved ★ {code}",
  noFullscreen: "fullscreen not available", error: "error: {msg}", replay: "load a sample to replay {chain}",
  scanFile: "file {name}", mono: "mono", stereo: "stereo", brightness: "brightness ~{hz} Hz", tempo: "tempo ~{bpm} bpm (effects will sync)", mapping: "mapping {codes} codes × {fx} effects",
};

/** Look up `key`, filling `{name}` placeholders; falls back to the key itself. */
export function t(key, vars = {}) {
  const s = STRINGS[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
