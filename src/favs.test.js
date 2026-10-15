import { expect, test } from "vitest";
import { addFav, load, MAX_FAVS, removeFav, sanitize, save } from "./favs.js";

test("add dedupes, puts newest first and caps the list", () => {
  let l = addFav([], 12);
  l = addFav(l, 3);
  l = addFav(l, 12);
  expect(l).toEqual([12, 3]);
  for (let i = 0; i < 40; i++) l = addFav(l, i);
  expect(l).toHaveLength(MAX_FAVS);
  expect(l[0]).toBe(39);
});

test("invalid codes and old saved chains are ignored", () => {
  expect(addFav([], 1000)).toEqual([]);
  expect(addFav([], null)).toEqual([]);
  expect(sanitize([[1, 2], 1, "x", 2.5, 3, 3])).toEqual([1, 3]);
});

test("remove and storage roundtrip", () => {
  expect(removeFav([1, 2, 3], 1)).toEqual([1, 3]);
  const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  save([4, 5], st);
  expect(load(st)).toEqual([4, 5]);
  m.set("numnuts.favs", "{bad");
  expect(load(st)).toEqual([]);
});
