# PharmaSync on a Hostinger VPS — fresh bring-up

Target: Hostinger **KVM 8** (8 vCPU / 32 GB RAM / NVMe), Ubuntu 24.04 LTS.
KVM 4 (16 GB) works as a floor but Hermes responses will be slower.
No GPU needed — `hermes3:8b` (quantized) runs CPU-only. Expect **15–60 s per
AI call**; fine for form-level suggestions, sluggish for rapid-fire chat.

What runs where after this guide:

| URL | Serves |
|---|---|
| `https://app.<domain>` | React frontend (Caddy, static `dist/`) |
| `https://api.<domain>` | Supabase API (Kong) + `/knowledge/*` dose lookup |
| `https://studio.<domain>` | Supabase Studio (double auth) |

Internal-only (never exposed): Postgres, Ollama/Hermes, Redis, knowledge-service.

---

## 1. VPS prep

```bash
apt update && apt upgrade -y
apt install -y ufw fail2ban git curl
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

# Docker Engine + compose plugin (compose >= 2.24 required — `!reset` tag)
curl -fsSL https://get.docker.com | sh
docker compose version
```

## 2. DNS first (Caddy needs it live before first start)

Create three **A records** pointing at the VPS IP: `app`, `api`, `studio`.
Verify: `dig +short app.<domain>` returns the VPS IP.

## 3. Clone both repos

```bash
git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase-repo
mkdir -p /opt/supabase && cp -r /tmp/supabase-repo/docker /opt/supabase/docker && rm -rf /tmp/supabase-repo

git clone <this-repo-url> /opt/pharmasync
mkdir -p /opt/pharmasync-vault   # Obsidian dosing notes land here (step 9)
```

## 4. Secrets + env

```bash
cd /opt/supabase/docker && cp .env.example .env
```

Fill `/opt/supabase/docker/.env` per **`infra/.env.self-host.example`** —
both the official Supabase vars and the PharmaSync additions (`DOMAIN`,
`SRH_TOKEN`, `KNOWLEDGE_KEY`, `CRON_SECRET`, `STUDIO_BASICAUTH_HASH`).
Generate fresh secrets; **never reuse the office PC's**.

## 5. Start the stack

```bash
docker compose \
  -f /opt/supabase/docker/docker-compose.yml \
  -f /opt/pharmasync/infra/docker-compose.pharmasync.yml \
  --env-file /opt/supabase/docker/.env \
  up -d
```

Both `-f` files in ONE command, always — separate invocations create separate
networks and the functions container can't resolve `ollama`/`srh` by name.
Tip: `alias pcompose='docker compose -f /opt/supabase/docker/docker-compose.yml -f /opt/pharmasync/infra/docker-compose.pharmasync.yml --env-file /opt/supabase/docker/.env'`

## 6. Pull the models (one-time, ~5 GB + ~275 MB)

```bash
pcompose exec ollama ollama pull hermes3:8b
pcompose exec ollama ollama pull nomic-embed-text
```

## 7. Database: migrations, cron secret, NAG document

```bash
# Apply this repo's migrations in order
for f in /opt/pharmasync/supabase/migrations/*.sql; do
  echo "== $f"
  docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$f"
done

# Wire the ingest-guidelines cron secret (same value as CRON_SECRET in .env)
docker exec -it supabase-db psql -U supabase_admin -d postgres \
  -c "ALTER DATABASE postgres SET app.settings.cron_secret = '<CRON_SECRET>';"
```

Upload `nag-2024.txt` to the `nag-documents` bucket via Studio → Storage
(create the bucket as **private** if it doesn't exist).

## 8. Build + deploy the frontend

```bash
cd /opt/pharmasync
cp infra/.env.self-host.example .env   # keep ONLY the VITE_* block, fill it in
npm ci && npm run build                # → dist/, served by Caddy immediately
```

Rebuild after every `git pull` (VITE_ vars are baked in at build time).

## 9. Seed the Obsidian vault

Copy the dosing-notes folder from the office machine:

```bash
rsync -av --delete <office>:/path/to/obsidian-vault/ /opt/pharmasync-vault/
```

knowledge-service picks up changes automatically (polling watcher). Re-run
this rsync (or schedule it) whenever the vault changes.

## 10. Smoke tests

```bash
# Kong through Caddy (any 2xx/4xx is fine; 5xx/timeout is not)
curl -si https://api.<domain>/rest/v1/ -H "apikey: <ANON_KEY>" | head -1

# Rate-limit shim speaks the Upstash pipeline protocol
pcompose exec functions curl -s http://srh:80/pipeline \
  -H "Authorization: Bearer <SRH_TOKEN>" -d '[["ping"]]'
# → [{"result":"PONG"}]

# Knowledge sidecar is up and embedded the vault
pcompose exec functions curl -s http://knowledge-service:8787/health
# → {"ok":true,"note_count":<n>,"ollama":"up"}

# Ollama reachable from the functions container
pcompose exec functions curl -s http://ollama:11434/api/tags | head -c 200

# Guideline ingestion end-to-end (after adding a row in guideline_sources)
curl -s -X POST https://api.<domain>/functions/v1/ingest-guidelines \
  -H "x-cron-secret: <CRON_SECRET>"
# → {"processed":n,"ok":n,"failed":0}
```

## 11. First users + app-level checks

Create users in Studio (Authentication → Add user, auto-confirm on), insert
`profiles` + `user_roles` rows (see office-PC plan Task 7 for the SQL).
Then in the browser:

- **MO**: Antibiotic form → type a diagnosis → pathway banner returns a
  verdict citing NAG; "Suggest Antibiotic (AI)" returns a regimen; matching
  vault notes appear as verbatim cards with a "Use" button.
- **Pharmacist/Admin**: chat widget → "Which drugs run out soonest?" →
  answer with concrete day counts (cross-check `drug_stock_forecast` in
  Studio SQL editor).
- Model-quality gate: run the six `knowledge-service/vault-sample` conditions
  through the form and eyeball every suggestion **before go-live**.

## 12. Backups

```bash
chmod +x /opt/pharmasync/infra/backup.sh
crontab -e   # add:
# 0 2 * * * /opt/pharmasync/infra/backup.sh >> /var/log/pharmasync-backup.log 2>&1
```

Configure an off-box copy (rclone/rsync — see comments in backup.sh), then do
one restore drill into a scratch container before trusting it.

## Migrating data from the office PC

See **`infra/MIGRATION.md`** — do it after step 7 and before step 11.

## Ongoing maintenance

```bash
# App update
cd /opt/pharmasync && git pull && npm ci && npm run build   # Caddy serves new dist/ immediately
pcompose restart functions                                  # if edge functions changed

# Logs
pcompose logs -f functions   # or: ollama, knowledge-service, caddy, db
```
