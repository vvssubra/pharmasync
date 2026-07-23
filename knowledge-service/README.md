# PharmaSync Knowledge Service

Local, offline sidecar that turns an Obsidian vault of dosing notes into a
searchable knowledge base for the antibiotic form's "Suggest Dose" button.

It does two things:
1. Watches your Obsidian vault and embeds each note with a local Ollama model.
2. Serves `POST /suggest-dose` — given a diagnosis, returns the best-matching
   note(s) **verbatim** (the exact dose text you wrote in Obsidian — nothing
   is generated or paraphrased by AI).

No cloud calls, no API keys, no internet required after the one-time Ollama
model pull. Runs alongside the existing self-hosted Supabase Docker stack.

## 1. Install Ollama and pull the embedding model

Download Ollama for Windows from https://ollama.com, install it (runs as a
background service on `http://localhost:11434`), then:

```
ollama pull nomic-embed-text
```

This is a ~275MB embedding-only model — it does not generate text, so it's
light enough to run alongside Docker on an 8GB machine.

## 2. Write dosing notes in Obsidian

Each note is a markdown file with frontmatter. Example:

```markdown
---
drug: Amoxicillin
indication: Acute Otitis Media
patient_group: Paediatric   # Adult | Paediatric | Any
source: NAG 2024
tags: [antibiotic, dosing]
---
Amoxicillin 80-90 mg/kg/day PO divided BD x 5-7 days.
Penicillin-allergic: Azithromycin 10 mg/kg OD on day 1, then 5 mg/kg OD on days 2-5.
```

The body text is shown **exactly as written** when this note is the best
match — so keep it precise; it's the source of truth for the dose.

See `vault-sample/` for working examples (also used by automated tests).

### Authoring the vault from PDF guidelines

Most dosing guidance starts life as a PDF (e.g. NAG 2024 pathway documents).
To turn a PDF into a note:

1. Open the PDF and copy the relevant dosing paragraph for one
   `drug × indication × patient_group` combination.
2. In Obsidian, create a new note (or use the *Importer* community plugin to
   convert the whole PDF to markdown first, then split it into per-drug notes
   — one topic per note keeps matches precise).
3. Add the frontmatter block shown above, then paste the dose text **verbatim**
   as the body — do not paraphrase or summarise; the body is shown exactly as
   written when it's the best match.
4. Save. The running sidecar picks up the new/changed file within seconds
   (chokidar watch) and embeds it automatically — no restart needed.
5. Repeat per drug/indication/patient_group. It's fine to have several notes
   for the same indication (e.g. penicillin-allergic alternative) — cosine
   ranking picks the closest one to the query.

## 3. Configure and run the sidecar

```
cd knowledge-service
npm install
cp .env.example .env
# edit .env: set VAULT_PATH to your real Obsidian vault folder (or a
# dosing-notes subfolder of it)
npm start
```

You should see:
```
[knowledge-service] indexing vault: ...
[knowledge-service] indexed N note(s)
[knowledge-service] listening on http://localhost:8787
```

Editing/adding/deleting a note in Obsidian is picked up automatically
(watched via chokidar) and re-embedded within seconds. A `cache.json` file
is written next to the service so unchanged notes are not re-embedded on
restart.

## 4. Verify it works

```
curl http://localhost:8787/health
curl -X POST http://localhost:8787/suggest-dose \
  -H "Content-Type: application/json" \
  -d '{"query":"ear infection in a child","patient_group":"Paediatric"}'
```

## 5. Run alongside the Docker stack

Start this the same way you start the office deployment — e.g. add it to
your existing startup script/shortcut, or run it as a Windows service (NSSM,
pm2-windows-service, or Task Scheduler "on logon") so it survives reboots
alongside Docker Desktop.

## Configuration reference (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `VAULT_PATH` | `./vault-sample` | Folder to watch for `.md` notes |
| `OLLAMA_URL` | `http://localhost:11434` | Local Ollama server |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model name |
| `PORT` | `8787` | Sidecar HTTP port |
| `KNOWLEDGE_KEY` | (blank) | Optional shared-secret header (`x-knowledge-key`) |
| `ALLOWED_ORIGIN` | `http://localhost:8080` | CORS allow-list (comma-separated) |
| `MATCH_THRESHOLD` | `0.5` | Minimum cosine similarity to count as a match |
| `MAX_MATCHES` | `3` | Max results per query |

## Tests

```
npm test
```

Uses Node's built-in test runner with a fake deterministic embedding client
— no real Ollama instance needed to run the test suite.

## Scope

This sidecar only powers the antibiotic-form dosing lookup. It does not
replace or modify the existing (currently disabled) Anthropic-based
`ai-query` / `pathway-check` Supabase edge functions.

## Frontend wiring

The `/request/antibiotik` form calls this sidecar directly (see
`src/lib/knowledgeClient.ts`, `src/hooks/useDoseSuggestion.ts`,
`src/lib/doseQuery.ts`). As the doctor ticks the clinical-pathway checklist
(Pneumonia, AOM, Pharyngitis, Rhinosinusitis, SSTI, UTI) past its clinical
threshold, the form derives a dose query and, once a match clears
`MATCH_THRESHOLD`, shows the verbatim note in a suggestion card above the
dosing field and auto-fills the field if it's still empty. Set
`VITE_KNOWLEDGE_ENABLED="true"` and `VITE_KNOWLEDGE_URL` in the app's `.env`
to turn this on — it's independent of `VITE_AI_ENABLED` (the cloud track),
so it works fully offline in the self-hosted office install.
