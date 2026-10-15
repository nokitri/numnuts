/** A localStorage-backed value: load() sanitizes whatever is stored (or the fallback); both survive private mode/quota errors. */
export function store(key, sanitize, fallback) {
  return {
    load(storage = globalThis.localStorage) { try { return sanitize(JSON.parse(storage.getItem(key) ?? fallback)); } catch { return sanitize(JSON.parse(fallback)); } },
    save(value, storage = globalThis.localStorage) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ } },
  };
}
