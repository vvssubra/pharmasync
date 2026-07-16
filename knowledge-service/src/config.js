// Loads config from .env (if present) + process.env, with sane local defaults.
import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  // Node >=20.6 native .env loader — no dependency needed.
  process.loadEnvFile(envPath);
}

function required(name, fallback) {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

export const config = {
  vaultPath: required("VAULT_PATH", path.resolve(process.cwd(), "vault-sample")),
  ollamaUrl: required("OLLAMA_URL", "http://localhost:11434"),
  embedModel: required("EMBED_MODEL", "nomic-embed-text"),
  port: parseInt(required("PORT", "8787"), 10),
  knowledgeKey: process.env.KNOWLEDGE_KEY || "",
  allowedOrigins: required("ALLOWED_ORIGIN", "http://localhost:8080")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Overridable so the Docker deployment can point it at a persistent volume
  // (a cwd cache inside a container dies with it → full re-embed every boot).
  cachePath: process.env.CACHE_PATH
    ? path.resolve(process.env.CACHE_PATH)
    : path.resolve(process.cwd(), "cache.json"),
  matchThreshold: parseFloat(process.env.MATCH_THRESHOLD || "0.5"),
  maxMatches: parseInt(process.env.MAX_MATCHES || "3", 10),
};
