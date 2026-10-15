/** Code-entry buffer: up to 3 digits, as a string. */
const MAX_DIGITS = 3;
export const pushDigit = (entry, d) => (/^[0-9]$/.test(d) ? (entry.length >= MAX_DIGITS ? d : entry + d) : entry);
export const popDigit = (entry) => entry.slice(0, -1);
export const entryCode = (entry) => (entry === "" ? null : Number(entry));
