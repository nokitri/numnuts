/** Footer line, e.g. "v0.3.0 · a1b2c3d · 2026-10-12". */
export const buildInfo = ({ version, commit, date }) => [`v${version}`, commit, date].join(" · ");
