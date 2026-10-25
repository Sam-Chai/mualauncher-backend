import { defineConfig } from "@playwright/test";
import base from "./playwright.openapi.config";
export default defineConfig(base, { testMatch: "mod-pagination.spec.ts", outputDir: ".local/pagination-browser-results" });
