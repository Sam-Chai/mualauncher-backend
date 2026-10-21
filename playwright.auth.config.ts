import { defineConfig } from "@playwright/test";
import base from "./playwright.openapi.config";

export default defineConfig(base, { testMatch: "login-security.spec.ts", outputDir: ".local/auth-browser-results" });
