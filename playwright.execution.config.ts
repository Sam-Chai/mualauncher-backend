import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/browser", testMatch: "execution-settings.spec.ts", workers: 1, timeout: 90000,
  outputDir: ".local/execution-browser-results", reporter: "line", use: { baseURL: process.env.SMOKE_ORIGIN ?? "http://localhost:3001",
    channel: process.env.SMOKE_BROWSER ?? "msedge", headless: true, viewport: { width: 1440, height: 1100 }, screenshot: "only-on-failure" } });
