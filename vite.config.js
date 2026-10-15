import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

const sha = () => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "dev"; } };

// Relative base so the build works at any path, e.g. GitHub Pages /numnuts/.
export default defineConfig({
  base: "./",
  define: { __BUILD__: JSON.stringify({ version: pkg.version, commit: sha(), date: new Date().toISOString().slice(0, 10) }) },
  test: { environment: "jsdom" },
});
