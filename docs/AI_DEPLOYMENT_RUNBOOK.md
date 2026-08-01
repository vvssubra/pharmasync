# AI Assistant — Deployment Runbook

Self-hosted Ollama backing the PharmaSync AI assistant. Zero recurring API cost,
patient data never leaves the VPS.

**Status as of 2026-07-28: deployed and verified working in production.**
Everything below is a record of the live configuration plus how to verify or
rebuild it. The only step never executed by automation is the logged-in UI test
(§6), which needs a human session.

---

## Live configuration

| Item | Value |
|---|---|
| VPS | 4 vCPU, 16 GB RAM (~12 GB available), AVX2 present, 176 GB free |
| Ollama container | Coolify service `service-yplu808w67k2nn7b6jlwsfik`, container `ollama` |
| Model | `qwen2.5:7b-instruct-q4_K_M` (4.7 GB on disk, 7.6B params) |
| **Container memory limit** | **8 GB — see the OOM note below, this is not optional** |
| CPU limit / threads | `cpus: '3.0'`, `OLLAMA_NUM_THREAD: '3'` |
| Network | `l8dsa2iokodt3yafiwcmfkvi`, shared with `supabase-edge-functions` |
| Port 11434 | **Not** published to host — reachable only inside the Docker network |
| Edge runtime | `supabase/edge-runtime:v1.71.2`, healthy |
| Functions volume | `/data/coolify/services/l8dsa2iokodt3yafiwcmfkvi/volumes/functions` → `/home/deno/functions` |
| Frontend | Coolify app `pharmasync`, `https://pharmasyncpkdjb.my` |
| Kong (public) | `https://supabasekong-l8dsa2iokodt3yafiwcmfkvi.187.127.209.179.sslip.io` |

### ⚠️ The 8 GB memory limit

The Ollama container was first deployed with `memory: 3g` (a value carried over
from a plan written for a **3B** model). The 7B q4 model needs ~5 GB resident,
so llama-server was OOM-killed on first load:

```
{"error":"llama-server process has terminated: signal: killed"}
```

Raised to `memory: 8g` in the Coolify compose. **If the model ever stops
responding with `signal: killed`, this limit is the first thing to check** —
`docker inspect ollama --format '{{.HostConfig.Memory}}'` should return
`8589934592`.

---

## 1. Edge-function env vars

Coolify → project `supabase` → service `supabase-l8dsa2iokodt3yafiwcmfkvi` →
**Environment Variables** (Developer view appends in bulk):

```
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M
OLLAMA_NUM_CTX=4096
OLLAMA_TIMEOUT_MS=60000
APP_ORIGIN=https://pharmasyncpkdjb.my
```

**`OLLAMA_MODEL` is not optional.** `supabase/functions/_shared/llm.ts:43`
defaults to `qwen2.5:1.5b-instruct-q4_K_M`, which is *not* the model that was
pulled — leaving it unset fails every AI call with model-not-found.

`APP_ORIGIN` must exactly match the browser origin or CORS blocks the widget.

Saving env vars is not enough — Coolify shows *"The latest configuration has not
been applied"* and the container only picks them up after **Restart** (recreates
containers; ~30–60s stack downtime).

Verify they actually landed:
```bash
docker exec supabase-edge-functions-l8dsa2iokodt3yafiwcmfkvi env | grep -E 'OLLAMA|APP_ORIGIN'
```

`ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` are no
longer used and should be absent.

---

## 2. Rate-limiter migration — applied

`supabase/migrations/20260728000000_ai_rate_limits.sql` creates `ai_rate_limits`,
the `ai_rate_limit_hit()` RPC, and adds `ai_audit_logs.duration_ms`.

Applied via (repo is public, so no copy-paste of SQL into a browser terminal):
```bash
curl -sSL https://raw.githubusercontent.com/vvssubra/pharmasync/main/supabase/migrations/20260728000000_ai_rate_limits.sql \
  | docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Verify (all four must be non-zero except the last, which **must be 0**):
```bash
docker exec -i supabase-db-l8dsa2iokodt3yafiwcmfkvi psql -U postgres -d postgres -c \
"select to_regclass('public.ai_rate_limits') as tbl,
 (select count(*) from pg_proc where proname='ai_rate_limit_hit') as fn,
 (select count(*) from information_schema.columns where table_name='ai_audit_logs' and column_name='duration_ms') as dur,
 (select count(*) from pg_policies where tablename='ai_audit_logs') as audit_policies;"
```

**`audit_policies` must be 0.** `ai_audit_logs` has no `clinic_id` column, so an
admin-read policy gated only on `is_admin()` would let any one clinic's admin
read every clinic's audit trail. A draft of this migration added exactly that;
it was removed before merge. The table stays service-role-only.

---

## 3. Edge functions on the VPS

The self-hosted edge runtime serves from a mounted directory; it does **not**
pull from GitHub. Deploy by copying the repo's functions into the volume,
leaving the runtime's own `main/` router and `hello/` sample intact:

```bash
FN=/data/coolify/services/l8dsa2iokodt3yafiwcmfkvi/volumes/functions
rm -rf /tmp/ps && mkdir -p /tmp/ps \
  && curl -sSL https://github.com/vvssubra/pharmasync/archive/refs/heads/main.tar.gz \
     | tar xz -C /tmp/ps --strip-components=1 \
  && cp -r /tmp/ps/supabase/functions/_shared \
           /tmp/ps/supabase/functions/ai-query \
           /tmp/ps/supabase/functions/antibiotic-suggest \
           /tmp/ps/supabase/functions/pathway-check \
           /tmp/ps/supabase/functions/admin-user-mgmt \
           /tmp/ps/supabase/functions/push-notify $FN/
docker restart supabase-edge-functions-l8dsa2iokodt3yafiwcmfkvi
```

This list must name **every** function under `supabase/functions/` — anything
omitted keeps running its old code with no error anywhere. `push-notify` was
missing from this command for two days after it shipped, so rejection
notifications silently never fired. Check the repo directory against this list
whenever a function is added.

**Re-run this after every merge to `main` that touches `supabase/functions/`** —
nothing does it automatically. The frontend *does* auto-build on push (Coolify
webhook), which makes the asymmetry easy to miss: a role or logic change that
spans both sides will go live on the client while the server still runs the old
code, producing silent 403s until this is run.

Verify what actually landed, rather than assuming:
```bash
docker exec supabase-edge-functions-l8dsa2iokodt3yafiwcmfkvi \
  grep -h "ALLOWED_ROLES = \[" /home/deno/functions/antibiotic-suggest/index.ts
```

---

## 4. Frontend flags

Coolify app `pharmasync` → **Environment Variables**:

```
VITE_AI_ENABLED=true
VITE_PATHWAY_CHECK_ENABLED=true
VITE_AI_STREAMING=true
VITE_AI_TIMEOUT_MS=90000
```

Each must have **"Available at Buildtime" checked** — Vite inlines `VITE_*` at
build time, so a runtime-only var leaves the chat widget hidden. Then
**Redeploy** (not Restart — the bundle must be rebuilt).

---

## 5. Verification without a login

These need no user session and are the fastest way to confirm a deploy.

**Kong routes the function, and auth gates it:**
```bash
docker run --rm --network l8dsa2iokodt3yafiwcmfkvi curlimages/curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -X OPTIONS -H 'Origin: https://pharmasyncpkdjb.my' http://supabase-kong:8000/functions/v1/ai-query
# expect 204

docker run --rm --network l8dsa2iokodt3yafiwcmfkvi curlimages/curl -s -w '\nHTTP %{http_code}\n' \
  -X POST -H 'Content-Type: application/json' -d '{"question":"test"}' \
  http://supabase-kong:8000/functions/v1/ai-query
# expect 401 {"error":"Missing or invalid Authorization header"}
```

**The model answers, and copies numbers rather than inventing them:**
```bash
time docker run --rm --network l8dsa2iokodt3yafiwcmfkvi curlimages/curl -s http://ollama:11434/api/chat -d '{"model":"qwen2.5:7b-instruct-q4_K_M","stream":false,"messages":[{"role":"system","content":"Answer in English, at most 3 sentences. Every number must be copied from FACTS. FACTS: Novomix 30 FlexPen|100|84|16|84|12.0|Oct 2026|warning"},{"role":"user","content":"which drugs are near their quota limit?"}],"options":{"num_predict":200,"temperature":0,"num_ctx":4096}}'
```

Note: `supabase-edge-functions` and `supabase-kong` ship minimal images with **no
`curl`, `wget`, or `deno` binary**, so `docker exec` can't test from inside them —
use a disposable `curlimages/curl` container on the same network, as above.

---

## 6. Verification needing a login

1. Sign in at `https://pharmasyncpkdjb.my`, look for the robot button bottom-right.
2. Click an FAQ suggestion chip → answers in <1s, no model call (`source: "faq"`).
3. Ask "which drugs are near their quota limit?" → numbers must match `/fms` exactly.
4. Antibiotic form → tick Centor criteria to score 3 → banner turns `supported` in <1s (rule-based).
5. Suggest Antibiotic on an adult, non-allergic CAP case → verbatim NAG regimen, instant.
6. 21 chat messages within an hour → 21st returns 429 with `retry_after_seconds`.
7. Streaming not buffered by Kong — tokens should appear progressively, not in one blob.
   If they arrive as one blob, set `VITE_AI_STREAMING=false` and redeploy; the
   6-second progress message covers it.

---

## Measured performance (7B q4, 4 vCPU, CPU-only)

Real numbers from this VPS, not estimates:

| Path | LLM? | Measured |
|---|---|---|
| Cold start (first call after restart) | — | **~37s** model load, once only |
| FAQ direct hit | no | <100 ms |
| Pathway check | no | <100 ms |
| Antibiotic suggest (adult, no allergy) | no | <100 ms |
| Quota question, warm | yes | **18.9s** (0.3s load + 11.1s prompt + 7.6s generation) |

`OLLAMA_KEEP_ALIVE=-1` pins the model in RAM so the 37s cold start is paid once
per container restart, not per query. The rule-based paths are the common ones by
design — the model only phrases answers, it never decides a number or a drug.

### Do not "fix" slowness by switching to the 3B

`qwen2.5:3b-instruct-q4_K_M` is pulled and available, and an earlier draft of
this runbook recommended it. **Benchmarked side by side on this VPS, it is not
worth it:**

| | 7B | 3B |
|---|---|---|
| Prompt eval | 11.1s (15 tok/s) | 2.3s (66 tok/s) |
| Generation | 7.6s (4.8 tok/s) | 11.0s (4.5 tok/s) |
| **Total (warm)** | **18.9s** | **14.0s** |

Only ~26% faster, because generation is memory-bandwidth bound, not compute
bound — the smaller model barely helps the part that dominates.

And it costs accuracy. Same FACTS block, same question:

- **7B:** "Novomix 30 FlexPen is near its quota limit, with only 16 units remaining as of day 209 in 2026." ✅
- **3B:** "…and Levemir FlexPen has 28 out of 50 used. **Both have a warning status.**" ❌ — Levemir's status in FACTS is `healthy`.

Every *number* the 3B used was correct, so the numeric guard rail passed it. The
guard rail validates digits, not assertions — it cannot catch "both have a
warning status". In a pharmacy context that is the wrong trade for 5 seconds.

If latency becomes a real complaint, better levers: raise `OLLAMA_NUM_THREAD`
(currently 3 of 4 cores — 4 risks starving Postgres), trim the FACTS row cap
below 15, or lower `num_predict`. All keep the 7B's reliability.

---

## Rollback

Set `VITE_AI_ENABLED=false` on the `pharmasync` app and **Redeploy**. The widget
disappears and no AI path executes. Pathway check is rule-based and free, so it
can stay on independently via `VITE_PATHWAY_CHECK_ENABLED`.
