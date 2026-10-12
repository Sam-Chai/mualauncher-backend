export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { validateDatabase } = await import("./lib/prisma");
    await Promise.all(["web", "auth", "public"].map(purpose => validateDatabase(purpose as "web" | "auth" | "public")));
  }
}
