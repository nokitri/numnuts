import { store } from "./store.js";

/** Phosphor colours. The UI and the visualizer both use the active one. */
export const THEMES = [
  { name: "amber", color: "#ffb000" },
  { name: "green", color: "#33ff66" },
  { name: "cyan", color: "#3ce6ff" },
  { name: "pink", color: "#ff4fd8" },
  { name: "red", color: "#ff3b30" },
  { name: "white", color: "#e8f0ff" },
];
const THEME_NAMES = THEMES.map((t) => t.name);
const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULTS = Object.freeze({ theme: "pink" });

/** Coerce untrusted (e.g. localStorage) input into valid settings. */
export function sanitize(s = {}) {
  return {
    theme: THEME_NAMES.includes(s.theme) || HEX.test(s.theme) ? s.theme : DEFAULTS.theme,
  };
}

/** Theme is a preset name or a custom "#rrggbb". */
export const themeColor = (t) => (HEX.test(t) ? t.toLowerCase() : THEMES.find((x) => x.name === t)?.color ?? THEMES[0].color);

export const { load, save } = store("numnuts.settings", sanitize, "{}");
