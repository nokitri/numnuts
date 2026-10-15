// Renders codes off the main thread so the page never freezes while effects compute.
import { replay } from "./history.js";

self.onmessage = ({ data: { id, buf, codes, bpm } }) => {
  try {
    const out = replay(buf, codes, { bpm });
    self.postMessage({ id, buf: out }, out.channels.map((c) => c.buffer));
  } catch (e) {
    self.postMessage({ id, error: String(e?.message ?? e) });
  }
};
