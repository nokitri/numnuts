import { isValidCode } from "./codes.js";
import { store } from "./store.js";

/** Favourite codes, newest first. Persisted in localStorage; old saved chains (arrays) are dropped. */
export const MAX_FAVS = 24;
const KEY = "numnuts.favs";

export const sanitize = (list) => (Array.isArray(list) ? [...new Set(list.filter(isValidCode))].slice(0, MAX_FAVS) : []);
export const addFav = (list, code) => (isValidCode(code) ? [code, ...list.filter((c) => c !== code)].slice(0, MAX_FAVS) : list);
export const removeFav = (list, i) => list.filter((_, k) => k !== i);

export const { load, save } = store(KEY, sanitize, "[]");
