// Thin client for the local Ollama embeddings API. No cloud calls — localhost only.

export function createOllamaClient({ ollamaUrl, embedModel }) {
  async function embed(text) {
    const resp = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, prompt: text }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Ollama embeddings request failed (${resp.status}): ${detail.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (!Array.isArray(data.embedding)) {
      throw new Error("Ollama response missing 'embedding' array");
    }
    return data.embedding;
  }

  async function isUp() {
    try {
      const resp = await fetch(`${ollamaUrl}/api/tags`, { method: "GET" });
      return resp.ok;
    } catch {
      return false;
    }
  }

  return { embed, isUp };
}
