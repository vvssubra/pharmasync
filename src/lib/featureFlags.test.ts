import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// import.meta.env is read at module load, so each case re-imports the module
// after stubbing the env.
async function loadFlags() {
  vi.resetModules();
  return await import("./featureFlags");
}

describe("featureFlags", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables AI and knowledge features by default", async () => {
    const flags = await loadFlags();
    expect(flags.AI_ENABLED).toBe(false);
    expect(flags.KNOWLEDGE_ENABLED).toBe(false);
  });

  it("enables AI_ENABLED only for the exact string 'true'", async () => {
    vi.stubEnv("VITE_AI_ENABLED", "true");
    expect((await loadFlags()).AI_ENABLED).toBe(true);

    vi.stubEnv("VITE_AI_ENABLED", "1");
    expect((await loadFlags()).AI_ENABLED).toBe(false);
  });

  it("enables KNOWLEDGE_ENABLED only for the exact string 'true'", async () => {
    vi.stubEnv("VITE_KNOWLEDGE_ENABLED", "true");
    expect((await loadFlags()).KNOWLEDGE_ENABLED).toBe(true);

    vi.stubEnv("VITE_KNOWLEDGE_ENABLED", "yes");
    expect((await loadFlags()).KNOWLEDGE_ENABLED).toBe(false);
  });

  it("falls back to the local dev sidecar URL when VITE_KNOWLEDGE_URL is unset", async () => {
    expect((await loadFlags()).KNOWLEDGE_URL).toBe("http://localhost:8787");
  });

  it("uses VITE_KNOWLEDGE_URL when set", async () => {
    vi.stubEnv("VITE_KNOWLEDGE_URL", "https://api.example.com/knowledge");
    expect((await loadFlags()).KNOWLEDGE_URL).toBe("https://api.example.com/knowledge");
  });
});
