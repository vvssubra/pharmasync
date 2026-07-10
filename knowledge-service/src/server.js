// Local knowledge sidecar entrypoint. LAN-only HTTP server exposing:
//   GET  /health         — service + Ollama status, note count
//   POST /suggest-dose   — { query, patient_group? } -> verbatim note matches
// No cloud dependencies — Ollama and the Obsidian vault are both local.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { createOllamaClient } from "./ollama.js";
import { createVaultIndex } from "./vaultIndex.js";

function corsHeaders(origin, allowedOrigins) {
  const allowed = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "content-type, x-knowledge-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function isAuthorized(req) {
  if (!config.knowledgeKey) return true; // no key configured — auth disabled (LAN-trust mode)
  return req.headers["x-knowledge-key"] === config.knowledgeKey;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export function createApp({ vaultIndex, ollama }) {
  return async function handler(req, res) {
    const origin = req.headers.origin ?? null;
    const headers = corsHeaders(origin, config.allowedOrigins);

    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      const ollamaUp = await ollama.isUp();
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, note_count: vaultIndex.noteCount(), ollama: ollamaUp ? "up" : "down" }));
      return;
    }

    if (req.method === "POST" && req.url === "/suggest-dose") {
      if (!isAuthorized(req)) {
        res.writeHead(401, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        res.writeHead(400, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        res.writeHead(400, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "'query' is required" }));
        return;
      }
      const patientGroup = typeof body.patient_group === "string" ? body.patient_group : undefined;
      try {
        const matches = await vaultIndex.query(query, {
          patientGroup,
          maxMatches: config.maxMatches,
          threshold: config.matchThreshold,
        });
        res.writeHead(200, { ...headers, "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            matches,
            message: matches.length ? undefined : "No matching guideline found",
          }),
        );
      } catch (err) {
        res.writeHead(503, { ...headers, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Knowledge service unavailable", detail: err.message }));
      }
      return;
    }

    res.writeHead(404, { ...headers, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

async function main() {
  const ollama = createOllamaClient({ ollamaUrl: config.ollamaUrl, embedModel: config.embedModel });
  const vaultIndex = createVaultIndex({
    vaultPath: config.vaultPath,
    cachePath: config.cachePath,
    ollama,
  });

  console.log(`[knowledge-service] indexing vault: ${config.vaultPath}`);
  await vaultIndex.buildIndex();
  console.log(`[knowledge-service] indexed ${vaultIndex.noteCount()} note(s)`);
  vaultIndex.watch(() => console.log(`[knowledge-service] index updated, ${vaultIndex.noteCount()} note(s)`));

  const app = createApp({ vaultIndex, ollama });
  const server = createServer(app);
  server.listen(config.port, () => {
    console.log(`[knowledge-service] listening on http://localhost:${config.port}`);
  });
}

// Only auto-start when run directly (not when imported by tests). Compare
// resolved file:// URLs rather than string-concatenating argv[1] — on
// Windows argv[1] is a plain drive path (e.g. "src\\server.js" or
// "C:\\...\\server.js"), not a URL, so naive concatenation never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[knowledge-service] fatal:", err);
    process.exit(1);
  });
}
