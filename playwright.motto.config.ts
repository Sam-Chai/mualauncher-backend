import { defineConfig } from "@playwright/test";
import base from "./playwright.openapi.config";

export default defineConfig(base, { testMatch: "server-motto.spec.ts", outputDir: ".local/motto-browser-results" });
