import { defineConfig } from "@playwright/test";
import base from "./playwright.openapi.config";
export default defineConfig(base, { testMatch: "v2-distribution.spec.ts", outputDir: ".local/v2-browser-results" });
