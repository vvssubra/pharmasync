# Self-Hosted Supabase + Frontend Deployment — Design Spec

**Date:** 2026-06-30
**Project:** pharmacy-bin-keeper
**Goal:** Move from Supabase Singapore cloud to a self-hosted instance on an office Windows PC, accessible by all office staff over the LAN.

---

## Architecture Overview

```
Office PC (Windows, static LAN IP e.g. 192.168.1.100)
├── Docker Desktop (WSL2 backend)
│   └── docker-compose.yml  [restart: unless-stopped on all services]
│       ├── supabase stack
│       │   ├── Kong API gateway  → port 8000 (LAN-accessible)
│       │   ├── Studio dashboard  → port 3000 (LAN-accessible, admin use)
│       │   ├── GoTrue (auth)     → internal
│       │   ├── PostgREST         → internal
│       │   ├── Realtime          → internal
│       │   └── Postgres          → internal (port 5432 NOT exposed to LAN)
│       └── nginx  → port 80 (LAN-accessible)
│           └── serves /dist (built React app, volume-mounted)
│
├── Windows Task Scheduler
│   └── daily-backup.ps1 (runs 02:00 daily)
│       └── pg_dump → .sql.gz → OneDrive / Google Drive folder
│
└── Windows Firewall
    ├── Inbound allow TCP 80   (LAN subnet)
    ├── Inbound allow TCP 8000 (LAN subnet)
    └── Inbound allow TCP 3000 (LAN subnet, optional — Studio)
```

**Staff access flow:**
1. Staff open browser on their own device → `http://192.168.1.100`
2. nginx serves the built React app (`dist/`)
3. React app (running in staff browser) calls `http://192.168.1.100:8000` (Supabase API)
4. Kong routes to PostgREST / GoTrue / etc.

**Critical:** `VITE_SUPABASE_URL` must be the LAN IP (`http://192.168.1.100:8000`), NOT `localhost`. The env var is baked into the frontend build at `npm run build` time. If set to localhost, staff devices can't reach the API.

---

## Phase 1 — Docker Desktop

- Check if WSL2 feature is enabled (command: `wsl --status`)
- If not: enable via `dism` or Windows Features dialog, reboot
- Download Docker Desktop for Windows (WSL2 backend)
- Install, enable WSL2 integration, verify: `docker --version` and `docker compose version`

---

## Phase 2 — Supabase Self-Host

**Source:** Official Supabase self-host repo (`github.com/supabase/supabase` → `/docker`)

Steps:
1. Clone / download the `docker/` folder from the Supabase repo
2. Copy `.env.example` → `.env`
3. Regenerate ALL secrets (do not use defaults — they are public knowledge):
   - `POSTGRES_PASSWORD` — random 32-char string
   - `JWT_SECRET` — random 40-char string
   - `ANON_KEY` — JWT signed with JWT_SECRET, role=anon
   - `SERVICE_ROLE_KEY` — JWT signed with JWT_SECRET, role=service_role
   - `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — Studio login
4. Set `API_EXTERNAL_URL=http://<LAN-IP>:8000` and `SUPABASE_PUBLIC_URL=http://<LAN-IP>:8000`
5. Disable email confirmation: in `.env` set `GOTRUE_MAILER_AUTOCONFIRM=true`
6. `docker compose up -d`
7. Verify: Studio loads at `http://localhost:3000`

JWT generation: use the `jwt.io` debugger or the helper script in Supabase docs with the HS256 algorithm and the generated JWT_SECRET.

---

## Phase 3 — Network

**Static IP:** Two options (either works):
- **Preferred:** DHCP reservation on router (bind PC's MAC address to fixed IP) — survives OS reinstalls
- **Alternative:** Set static IP in Windows Network Adapter settings (`ncpa.cpl`)

**Windows Firewall rules** (PowerShell, run as Administrator):
```powershell
New-NetFirewallRule -DisplayName "Pharmacy App (HTTP)"     -Direction Inbound -Protocol TCP -LocalPort 80   -Action Allow
New-NetFirewallRule -DisplayName "Supabase API"            -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
New-NetFirewallRule -DisplayName "Supabase Studio"         -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

**Verify from another device:** `http://<LAN-IP>:3000` loads Studio.

---

## Phase 4 — Data Migration

**Prerequisites:** Supabase CLI installed on the Singapore project's machine (or this machine with project linked).

```powershell
# Dump schema (DDL + RLS policies) from Singapore
supabase db dump --project-ref xkylwjlcablefymuzoie -f schema.sql

# Dump data only
supabase db dump --project-ref xkylwjlcablefymuzoie --data-only -f data.sql
```

**Load into local Postgres** (Supabase self-host exposes Postgres internally; use `docker exec`):
```powershell
# Copy dump files into the container then restore
docker cp schema.sql supabase-db:/tmp/schema.sql
docker cp data.sql   supabase-db:/tmp/data.sql
docker exec -it supabase-db psql -U postgres -d postgres -f /tmp/schema.sql
docker exec -it supabase-db psql -U postgres -d postgres -f /tmp/data.sql
```

**Auth users:** Do NOT migrate (hashed password migration is complex and fragile).
Instead: create each staff member fresh in Studio → Authentication → Users → "Invite user" (with auto-confirm on, no email sent — just set password directly).

**Roles:** After creating each user in Studio, insert their role into `user_roles` table via Studio SQL editor:
```sql
INSERT INTO user_roles (user_id, role) VALUES ('<user-uuid>', 'pharmacist');
```

---

## Phase 5 — Frontend Build + Serve

**Prerequisites check (run on office PC):**
```powershell
git --version    # if error: install from git-scm.com
node --version   # if error: install Node 18 LTS from nodejs.org
```

**Steps:**
```powershell
git clone https://github.com/<owner>/pharmacy-bin-keeper.git
cd pharmacy-bin-keeper

# Create .env with local Supabase details
@"
VITE_SUPABASE_URL=http://<LAN-IP>:8000
VITE_SUPABASE_PUBLISHABLE_KEY=<new-anon-key>
"@ | Out-File -Encoding utf8 .env

npm install
npm run build   # outputs to dist/
```

**nginx in docker-compose** — add this service to the Supabase `docker-compose.yml`:
```yaml
  pharmacy-web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      # Windows path example: C:/Users/<YourUsername>/pharmacy-bin-keeper/dist
      # Docker Desktop on Windows accepts forward-slash Windows paths directly
      - C:/Users/<YourUsername>/pharmacy-bin-keeper/dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

**nginx.conf** (save alongside docker-compose.yml):
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

After adding the service: `docker compose up -d pharmacy-web`

**Verify:** From staff device browser: `http://<LAN-IP>` → login screen appears.

---

## Phase 6 — Backup

**Script:** Save as `C:\PharmacyBackup\daily-backup.ps1`

```powershell
$date    = Get-Date -Format "yyyy-MM-dd"
$folder  = "$env:USERPROFILE\OneDrive\PharmacyBackup"   # change to Google Drive path if needed
$sqlFile = "$folder\pharmacy-$date.sql"
$zipFile = "$folder\pharmacy-$date.zip"
if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder }

# Dump to .sql then zip (PowerShell 5 native — no gzip dependency)
docker exec supabase-db pg_dump -U postgres postgres | Out-File $sqlFile -Encoding utf8
Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
Remove-Item $sqlFile

# Keep only last 30 days
Get-ChildItem $folder -Filter "pharmacy-*.zip" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item
```

**Schedule via Task Scheduler:**
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -File C:\PharmacyBackup\daily-backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "2:00AM"
Register-ScheduledTask -TaskName "PharmacyDBBackup" -Action $action -Trigger $trigger -RunLevel Highest
```

**Test restore (do this once after setup):**
```powershell
# Expand zip and restore to verify dump is valid
Expand-Archive "$folder\pharmacy-<date>.zip" -DestinationPath "$folder\test-restore"
docker exec -i supabase-db psql -U postgres -d postgres_test < "$folder\test-restore\pharmacy-<date>.sql"
Remove-Item "$folder\test-restore" -Recurse
```

---

## Auto-Start on Boot

All Docker services have `restart: unless-stopped`. Docker Desktop set to launch on Windows login.

**Net result:** PC powers on → Docker Desktop auto-starts → all containers come up → staff can reach the app within ~60 seconds of the PC booting. No manual intervention needed.

---

## Key Variables Cheatsheet (fill in during setup)

| Variable | Where set | Value |
|----------|-----------|-------|
| LAN IP of PC | Router / Windows | e.g. `192.168.1.100` |
| `POSTGRES_PASSWORD` | Supabase `.env` | generated |
| `JWT_SECRET` | Supabase `.env` | generated |
| `ANON_KEY` | Supabase `.env` + frontend `.env` | generated JWT |
| `SERVICE_ROLE_KEY` | Supabase `.env` | generated JWT |
| `DASHBOARD_PASSWORD` | Supabase `.env` | chosen |
| `VITE_SUPABASE_URL` | frontend `.env` | `http://<LAN-IP>:8000` |
| OneDrive backup folder | `daily-backup.ps1` | `$env:USERPROFILE\OneDrive\PharmacyBackup` |

---

## Out of Scope

- HTTPS / SSL (LAN HTTP is acceptable for internal office use)
- Email / SMTP (auth email confirmation disabled; password resets handled manually)
- External access from outside office network
- Automatic frontend rebuild on git push (manual `git pull && npm run build` + restart nginx)
