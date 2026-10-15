/** Map a keydown to an action name, or null. `typing` = focus is in a text field or select. */
export function keyAction({ key, ctrlKey, metaKey, altKey }, typing) {
  if (ctrlKey || metaKey || altKey || typing) return null;
  if (/^[0-9]$/.test(key)) return "digit";
  return { Enter: "apply", Escape: "escape", Backspace: "backspace", " ": "play", r: "dice", x: "clear" }[key.length === 1 ? key.toLowerCase() : key] ?? null;
}

