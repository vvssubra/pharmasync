# Self-Hosted Supabase + Frontend Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy pharmacy-bin-keeper on this Windows office PC so all office staff can reach the app at `http://<this-PC's-LAN-IP>` from their own devices.

**Architecture:** Docker Desktop runs the official Supabase self-host stack (Postgres + PostgREST + GoTrue + Kong + Studio) plus an nginx container that serves the pre-built React frontend. All containers restart automatically on boot. A daily PowerShell backup dumps Postgres to the OneDrive/Google Drive folder.

**Tech Stack:** Docker Desktop (WSL2), Supabase self-host docker-compose, nginx:alpine, Node 18+, Git, PowerShell 5.1, Windows Task Scheduler, Supabase CLI (for data migration only).

## Global Constraints

- OS: Windows 10/11 with WSL2 support
- All Docker services must have `restart: unless-stopped`
- `VITE_SUPABASE_URL` = `http://<LAN-IP>:8000` — NEVER `localhost` (staff browsers on other devices make these API calls)
- Auth email confirmation must be OFF (`ENABLE_EMAIL_AUTOCONFIRM=true` in Supabase .env)
- Do NOT use default Supabase secrets — they are public knowledge and must be regenerated
- GitHub repo `pharmacy-bin-keeper` is public — no credentials needed to clone
- Source Supabase project for migration: `xkylwjlcablefymuzoie` (Singapore)
- Frontend env vars: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
- Backup destination: OneDrive or Google Drive synced folder (user will confirm exact path)

---

## Files Created by This Plan

| File | Purpose |
|------|---------|
| `C:\supabase-self-host\` | Supabase docker-compose working directory |
| `C:\supabase-self-host\.env` | All Supabase secrets + config |
| `C:\supabase-self-host\nginx.conf` | nginx static file server config |
| `C:\supabase-self-host\docker-compose.yml` | Modified to add nginx pharmacy-web service |
| `C:\Users\<user>\pharmacy-bin-keeper\.env` | Frontend env pointing to LAN IP |
| `C:\PharmacyBackup\daily-backup.ps1` | Daily pg_dump → zip → OneDrive |

---

## Task 1: Discover LAN IP and Verify Windows Environment

**Goal:** Know the PC's LAN IP (needed in every subsequent task) and confirm WSL2 capability.

**Files:** None created.

- [ ] **Step 1: Find the LAN IP**

Run in PowerShell:
```powershell
ipconfig | Select-String "IPv4"
```

Expected output — look for the line under your Wi-Fi or Ethernet adapter (NOT the `172.x.x.x` Docker range):
```
   IPv4 Address. . . . . . . . . . . : 192.168.1.100
```

Write this IP down. Every occurrence of `<LAN-IP>` in this plan = that number.

- [ ] **Step 2: Check WSL2 status**

```powershell
wsl --status
```

If output shows `Default Version: 2` → WSL2 already enabled. Skip to Step 4.

If command not found OR shows Version 1 → go to Step 3.

- [ ] **Step 3: Enable WSL2 (only if Step 2 showed it missing)**

Run PowerShell as Administrator:
```powershell
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
```

Then reboot. After reboot, run:
```powershell
wsl --set-default-version 2
```

- [ ] **Step 4: Check for Git**

```powershell
git --version
```

If error `'git' is not recognized` → download Git for Windows from `https://git-scm.com/download/win` and install with all defaults. Reopen PowerShell after install.

- [ ] **Step 5: Check for Node.js**

```powershell
node --version
```

If error → download Node.js 18 LTS from `https://nodejs.org/en/download` (Windows Installer). Install with all defaults. Reopen PowerShell after install.

Expected after install: `v18.x.x` or higher.

- [ ] **Step 6: Confirm Docker is NOT yet installed**

```powershell
docker --version
```

If this succeeds → Docker already installed. Skip Task 2 entirely, go to Task 3.

---

## Task 2: Install Docker Desktop

**Goal:** Docker Desktop running with WSL2 backend.

**Files:** None created.

- [ ] **Step 1: Download Docker Desktop**

In browser, go to `https://www.docker.com/products/docker-desktop/` and download the Windows installer.

- [ ] **Step 2: Install**

Run the installer. When prompted:
- ✅ Use WSL2 instead of Hyper-V
- ✅ Add shortcut to desktop

Reboot when installer asks.

- [ ] **Step 3: First launch**

Open Docker Desktop. Accept the service agreement. Wait for the whale icon in the taskbar to stop animating (takes 1–2 minutes). Status should show "Docker Desktop is running".

- [ ] **Step 4: Set Docker to start on login**

In Docker Desktop: Settings → General → ✅ "Start Docker Desktop when you sign in to your computer"

- [ ] **Step 5: Verify**

```powershell
docker --version
docker compose version
docker run hello-world
```

Expected:
```
Docker version 27.x.x
Docker Compose version v2.x.x
Hello from Docker!
```

If `hello-world` fails with WSL error → open Docker Desktop → Settings → Resources → WSL Integration → enable for your distro → Apply & Restart.

---

## Task 3: Set Up Supabase Self-Host

**Goal:** Supabase stack running locally with regenerated secrets and email confirmation off.

**Files created:** `C:\supabase-self-host\.env`, `C:\supabase-self-host\docker-compose.yml` (and all other files from the official repo)

- [ ] **Step 1: Clone official Supabase self-host repo**

```powershell
cd C:\
git clone --depth 1 https://github.com/supabase/supabase supabase-repo
Copy-Item -Recurse supabase-repo\docker C:\supabase-self-host
Remove-Item -Recurse supabase-repo
cd C:\supabase-self-host
```

- [ ] **Step 2: Copy the example env file**

```powershell
Copy-Item .env.example .env
```

- [ ] **Step 3: Generate POSTGRES_PASSWORD**

```powershell
$pg_pass = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
Write-Host "POSTGRES_PASSWORD: $pg_pass"
```

Copy the output. You will paste it into `.env` in Step 5.

- [ ] **Step 4: Generate JWT_SECRET, ANON_KEY, and SERVICE_ROLE_KEY**

Save this script as `C:\supabase-self-host\gen-jwt.js`:

```javascript
const crypto = require('crypto');

const JWT_SECRET = process.argv[2];
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Usage: node gen-jwt.js <jwt-secret-min-32-chars>');
  process.exit(1);
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const sig = crypto.createHmac('sha256', JWT_SECRET)
    .update(unsigned).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${unsigned}.${sig}`;
}

const now = Math.floor(Date.now() / 1000);
const exp = now + (10 * 365 * 24 * 60 * 60); // 10 years

const anonKey = makeJwt({ role: 'anon', iss: 'supabase', iat: now, exp });
const serviceKey = makeJwt({ role: 'service_role', iss: 'supabase', iat: now, exp });

console.log('\nCopy these into .env:\n');
console.log(`ANON_KEY=${anonKey}`);
console.log(`SERVICE_ROLE_KEY=${serviceKey}`);
```

Generate a JWT_SECRET, then run the script:

```powershell
$jwt_secret = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(30))
Write-Host "JWT_SECRET: $jwt_secret"
node gen-jwt.js $jwt_secret
```

Write down all three values: `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`.

- [ ] **Step 5: Choose a Studio dashboard password**

Pick a strong password for the Studio web UI (e.g. `PharmOffice2026!`). Write it down.

- [ ] **Step 6: Edit .env with all values**

Open `C:\supabase-self-host\.env` in Notepad. Find and replace these lines (exact variable names):

```
POSTGRES_PASSWORD=<paste POSTGRES_PASSWORD from Step 3>

JWT_SECRET=<paste JWT_SECRET from Step 4>
ANON_KEY=<paste ANON_KEY from Step 4>
SERVICE_ROLE_KEY=<paste SERVICE_ROLE_KEY from Step 4>

DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<your chosen Studio password>

API_EXTERNAL_URL=http://<LAN-IP>:8000
SUPABASE_PUBLIC_URL=http://<LAN-IP>:8000

ENABLE_EMAIL_AUTOCONFIRM=true
```

Replace `<LAN-IP>` with the actual IP found in Task 1 Step 1.

Save the file.

- [ ] **Step 7: Start the Supabase stack**

```powershell
cd C:\supabase-self-host
docker compose up -d
```

First run downloads all images — takes 5–10 minutes. Watch for errors.

- [ ] **Step 8: Wait for health**

```powershell
docker compose ps
```

All services should show `healthy` or `running`. If any show `Exit` or `Restarting`, run:
```powershell
docker compose logs <service-name>
```
to read the error.

- [ ] **Step 9: Verify Studio loads**

Open browser on THIS PC: `http://localhost:3000`

Should prompt for username/password → enter the `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` from Step 6.

Studio should load showing empty tables.

- [ ] **Step 10: Verify API responds**

```powershell
Invoke-WebRequest -Uri "http://localhost:8000/rest/v1/" -Headers @{"apikey"="<ANON_KEY>"} -UseBasicParsing
```

Expected: HTTP 200 with JSON response (even if `{"message":"Not Found"}`). Any 2xx or 4xx (not 5xx or connection refused) means Kong is up.

---

## Task 4: Configure Network (Static IP + Firewall)

**Goal:** PC holds a fixed LAN IP forever; staff devices can reach ports 80, 8000, 3000.

**Files:** None.

- [ ] **Step 1: Find the network adapter name**

```powershell
Get-NetAdapter | Where-Object { $_.Status -eq "Up" } | Select-Object Name, MacAddress, LinkSpeed
```

Note the adapter name (e.g. `Ethernet` or `Wi-Fi`) and its MAC address.

- [ ] **Step 2: Set static IP in Windows**

Replace `Ethernet` with your adapter name from Step 1. Replace IPs to match your network (check your router's web UI for gateway — usually `192.168.1.1` or `192.168.0.1`):

```powershell
# Run as Administrator
$adapter = "Ethernet"   # <-- change if your adapter is named differently
$ip      = "192.168.1.100"   # <-- the IP you want to fix (use current IP from Task 1)
$gateway = "192.168.1.1"     # <-- your router's IP
$dns     = "8.8.8.8"

New-NetIPAddress -InterfaceAlias $adapter -IPAddress $ip -PrefixLength 24 -DefaultGateway $gateway
Set-DnsClientServerAddress -InterfaceAlias $adapter -ServerAddresses $dns
```

If you see `The object already exists` error → the IP is already set statically. Continue.

- [ ] **Step 3: Verify IP is fixed**

```powershell
ipconfig | Select-String "IPv4"
```

Must show the IP you set. If the router reassigns a different IP later (possible with DHCP) → log into your router admin panel and create a DHCP reservation: bind this PC's MAC address to that IP permanently. Router admin URL is usually `http://192.168.1.1` or `http://192.168.0.1`.

- [ ] **Step 4: Add Windows Firewall inbound rules**

Run PowerShell as Administrator:

```powershell
New-NetFirewallRule -DisplayName "Pharmacy App (HTTP)" -Direction Inbound -Protocol TCP -LocalPort 80   -Action Allow
New-NetFirewallRule -DisplayName "Supabase API"        -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
New-NetFirewallRule -DisplayName "Supabase Studio"     -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Expected output for each: `Name : ...` with no errors.

- [ ] **Step 5: Verify from another device on the same WiFi/LAN**

On another phone or laptop connected to the same office network, open a browser and go to:
```
http://<LAN-IP>:3000
```

Should show Studio login page. If it times out → check that firewall rule for 3000 was added (Step 4) and Docker is running.

---

## Task 5: Migrate Data from Singapore Supabase

**Goal:** Schema, tables, RLS policies, and all rows from project `xkylwjlcablefymuzoie` loaded into local Postgres.

**Files:** Temporary dump files in `C:\supabase-self-host\migration\`

- [ ] **Step 1: Install Supabase CLI**

```powershell
winget install Supabase.CLI
```

If `winget` not found (Windows 10 without App Installer):
```powershell
# Download from GitHub releases
$url = "https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\supabase-cli.zip"
Expand-Archive "$env:TEMP\supabase-cli.zip" -DestinationPath "C:\supabase-cli"
$env:PATH += ";C:\supabase-cli"
```

Verify:
```powershell
supabase --version
```

- [ ] **Step 2: Log in to Supabase CLI**

```powershell
supabase login
```

Opens browser → log in with the Supabase account that owns project `xkylwjlcablefymuzoie` → copy the token shown → paste it back in the terminal.

- [ ] **Step 3: Create migration folder**

```powershell
New-Item -ItemType Directory -Path C:\supabase-self-host\migration -Force
cd C:\supabase-self-host\migration
```

- [ ] **Step 4: Dump schema (DDL + RLS policies) from Singapore**

```powershell
supabase db dump --project-ref xkylwjlcablefymuzoie -f schema.sql
```

Expected: creates `schema.sql` (hundreds of lines, includes `CREATE TABLE`, `CREATE POLICY`, etc.)

- [ ] **Step 5: Dump data from Singapore**

```powershell
supabase db dump --project-ref xkylwjlcablefymuzoie --data-only -f data.sql
```

Expected: creates `data.sql` (INSERT statements for all rows)

- [ ] **Step 6: Copy dump files into Postgres container**

```powershell
docker cp C:\supabase-self-host\migration\schema.sql supabase-db:/tmp/schema.sql
docker cp C:\supabase-self-host\migration\data.sql   supabase-db:/tmp/data.sql
```

- [ ] **Step 7: Load schema**

```powershell
docker exec -it supabase-db psql -U postgres -d postgres -f /tmp/schema.sql
```

Watch output. Lines like `CREATE TABLE`, `CREATE POLICY`, `ALTER TABLE` are good. Lines like `ERROR:  relation already exists` are usually harmless (Supabase creates some base tables on startup). Lines like `ERROR: permission denied` or `ERROR: syntax error` need investigation.

- [ ] **Step 8: Load data**

```powershell
docker exec -it supabase-db psql -U postgres -d postgres -f /tmp/data.sql
```

- [ ] **Step 9: Verify tables and rows in Studio**

Open Studio `http://localhost:3000` → Table Editor. You should see tables: `drugs`, `transactions`, `dispensing_requests`, `antibiotic_forms`, `profiles`, `user_roles`, `drug_quotas`, `patient_registry`, `patient_drug_history`, `ai_audit_logs`.

Click on `drugs` table → confirm rows are present.

- [ ] **Step 10: Clean up dump files**

```powershell
Remove-Item C:\supabase-self-host\migration -Recurse
```

---

## Task 6: Build Frontend + Add nginx to Stack

**Goal:** Staff can open `http://<LAN-IP>` and see the pharmacy app login screen.

**Files created:** `C:\Users\<YourUsername>\pharmacy-bin-keeper\.env`, `C:\supabase-self-host\nginx.conf` (modified `docker-compose.yml`)

- [ ] **Step 1: Clone the pharmacy app repo**

```powershell
cd C:\Users\$env:USERNAME
git clone https://github.com/VVSDigitalSolutions/pharmacy-bin-keeper.git
```

(If the repo URL differs, check with whoever manages the GitHub account.)

- [ ] **Step 2: Find your ANON_KEY**

```powershell
Select-String "ANON_KEY" C:\supabase-self-host\.env
```

Copy the long JWT value — needed in the next step.

- [ ] **Step 3: Create the frontend .env file**

```powershell
$lanIp   = "<LAN-IP>"     # <-- paste the actual LAN IP e.g. 192.168.1.100
$anonKey = "<ANON_KEY>"   # <-- paste the ANON_KEY value from Step 2

@"
VITE_SUPABASE_URL=http://${lanIp}:8000
VITE_SUPABASE_PUBLISHABLE_KEY=${anonKey}
"@ | Out-File -Encoding utf8 "C:\Users\$env:USERNAME\pharmacy-bin-keeper\.env"
```

**Critical:** `VITE_SUPABASE_URL` must use the LAN IP, not `localhost`. This value is baked into the JavaScript bundle at build time. Staff browsers on other devices call this URL directly.

- [ ] **Step 4: Install dependencies and build**

```powershell
cd "C:\Users\$env:USERNAME\pharmacy-bin-keeper"
npm install
npm run build
```

Expected: `dist/` folder created. Final line: `✓ built in X.Xs`

If build fails with TypeScript errors → run `npm run lint` first to see them clearly.

- [ ] **Step 5: Create nginx.conf**

Save this file as `C:\supabase-self-host\nginx.conf`:

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

- [ ] **Step 6: Add nginx service to docker-compose.yml**

Open `C:\supabase-self-host\docker-compose.yml` in Notepad.

Find the `services:` block. Add this new service at the end of the services list (same indentation level as `db:`, `kong:`, etc.):

```yaml
  pharmacy-web:
    container_name: pharmacy-web
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - C:/Users/<YourUsername>/pharmacy-bin-keeper/dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

Replace `<YourUsername>` with the actual Windows username (visible in `C:\Users\`). Use forward slashes in the path.

**If Docker shows a file sharing error on startup:** Docker Desktop → Settings → Resources → File Sharing → add `C:\Users\<YourUsername>\pharmacy-bin-keeper` → Apply & Restart.

- [ ] **Step 7: Start the nginx service**

```powershell
cd C:\supabase-self-host
docker compose up -d pharmacy-web
```

- [ ] **Step 8: Verify on this PC**

Open browser: `http://localhost`

Should show pharmacy app login screen. (Do NOT log in yet — users haven't been created.)

If blank page → open browser dev tools (F12) → Console tab → check for errors like `Failed to fetch` or CORS errors. These indicate the `VITE_SUPABASE_URL` env var was set incorrectly.

- [ ] **Step 9: Verify from another device**

On another phone or laptop on the same network, open browser: `http://<LAN-IP>`

Should show pharmacy app login screen. If it times out → confirm firewall rule for port 80 (Task 4 Step 4).

---

## Task 7: Create Staff User Accounts

**Goal:** Each staff member has a login with the correct role.

**Files:** None. Done entirely through Studio UI + SQL editor.

Reference roles from the app codebase:
- `admin` — full access
- `pharmacist` — inventory, fulfilment, reports
- `mo` — doctor: drug requests, antibiotic forms
- `fms` — specialist: antibiotic approvals

- [ ] **Step 1: Open Studio**

`http://localhost:3000` → log in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

- [ ] **Step 2: For each staff member — create auth user**

Studio → Authentication (left sidebar) → Users → "Add user" button → "Create new user":

- Email: staff member's email
- Password: temporary password (tell them to remember it; password reset requires SMTP which isn't set up)
- ✅ Auto Confirm User (should already be checked since we set `ENABLE_EMAIL_AUTOCONFIRM=true`)

Click "Create User". Note the UUID shown in the user list — you need it for the next step.

- [ ] **Step 3: For each staff member — insert into profiles table**

Studio → SQL Editor → New query:

```sql
INSERT INTO profiles (id, full_name, facility)
VALUES (
  '<user-uuid>',         -- paste UUID from Step 2
  'Staff Full Name',     -- their display name
  'Klinik Kesihatan X'   -- facility name
);
```

Run the query.

- [ ] **Step 4: For each staff member — assign role**

Still in SQL Editor:

```sql
INSERT INTO user_roles (user_id, role)
VALUES (
  '<user-uuid>',   -- same UUID as Step 3
  'pharmacist'     -- one of: admin, pharmacist, mo, fms
);
```

Run the query.

- [ ] **Step 5: Test login from a staff device**

On another device, go to `http://<LAN-IP>`. Log in with one staff member's credentials.

After login, the app should show the correct dashboard for their role (e.g. pharmacist sees inventory dashboard).

If login succeeds but wrong page shown → check `user_roles` row for that user: the role value must exactly match one of `admin`, `pharmacist`, `mo`, `fms`.

---

## Task 8: Daily Database Backup

**Goal:** Postgres dumps to OneDrive/Google Drive folder every night at 2 AM. Old files auto-deleted after 30 days.

**Files created:** `C:\PharmacyBackup\daily-backup.ps1`

- [ ] **Step 1: Find OneDrive or Google Drive folder path**

In File Explorer, find where your OneDrive or Google Drive syncs locally. Common paths:
- OneDrive: `C:\Users\<YourUsername>\OneDrive`
- Google Drive: `C:\Users\<YourUsername>\Google Drive` or `G:\My Drive`

Run this to confirm OneDrive path:
```powershell
[System.Environment]::GetEnvironmentVariable("OneDrive")
```

Note the full path — you'll use it in Step 2.

- [ ] **Step 2: Create backup folder**

```powershell
New-Item -ItemType Directory -Path C:\PharmacyBackup -Force
```

- [ ] **Step 3: Create the backup script**

Save this as `C:\PharmacyBackup\daily-backup.ps1`.

Replace the `$folder` value with your actual OneDrive or Google Drive path from Step 1:

```powershell
$date    = Get-Date -Format "yyyy-MM-dd"
$folder  = "$env:OneDrive\PharmacyBackup"   # <-- OneDrive. For Google Drive change to e.g. "G:\My Drive\PharmacyBackup"
$sqlFile = "$folder\pharmacy-$date.sql"
$zipFile = "$folder\pharmacy-$date.zip"

if (-not (Test-Path $folder)) {
    New-Item -ItemType Directory -Path $folder
}

# Dump Postgres to .sql then zip it
docker exec supabase-db pg_dump -U postgres postgres | Out-File $sqlFile -Encoding utf8
Compress-Archive -Path $sqlFile -DestinationPath $zipFile -Force
Remove-Item $sqlFile

# Delete backups older than 30 days
Get-ChildItem $folder -Filter "pharmacy-*.zip" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item
```

- [ ] **Step 4: Run the backup script once manually to test**

```powershell
powershell.exe -NonInteractive -File C:\PharmacyBackup\daily-backup.ps1
```

- [ ] **Step 5: Verify backup file was created**

```powershell
Get-ChildItem "$env:OneDrive\PharmacyBackup"
```

Expected: one `.zip` file named `pharmacy-2026-06-30.zip` (today's date). File size should be > 1 KB.

If file is 0 bytes → Docker container `supabase-db` may not be running. Check: `docker ps | Select-String supabase-db`.

- [ ] **Step 6: Schedule daily run at 2 AM**

Run PowerShell as Administrator:

```powershell
$action  = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -File C:\PharmacyBackup\daily-backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable:$false -StartWhenAvailable:$true

Register-ScheduledTask `
    -TaskName "PharmacyDBBackup" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force
```

- [ ] **Step 7: Verify task is registered**

```powershell
Get-ScheduledTask -TaskName "PharmacyDBBackup" | Select-Object TaskName, State, LastRunTime, NextRunTime
```

Expected: `State: Ready`, `NextRunTime: tomorrow at 02:00`.

---

## Task 9: Reboot Verification (Auto-Start Test)

**Goal:** Confirm everything survives a full power cycle with no manual intervention.

- [ ] **Step 1: Confirm Docker Desktop is set to auto-start**

Docker Desktop → Settings → General → ✅ "Start Docker Desktop when you sign in"

- [ ] **Step 2: Reboot the PC**

```powershell
Restart-Computer
```

Wait for Windows to fully load (login screen → desktop). Wait 2 more minutes for Docker to start.

- [ ] **Step 3: Verify containers are up**

```powershell
cd C:\supabase-self-host
docker compose ps
```

Expected: all services show `running` or `healthy` status. Look specifically for `pharmacy-web` and `supabase-db` in the list.

- [ ] **Step 4: Verify app is reachable from another device**

On phone or another laptop on the same network: `http://<LAN-IP>`

Should load pharmacy app login without any manual action on the PC.

- [ ] **Step 5: Log in as one staff member and confirm data is intact**

Log in → navigate to Drug Master (`/drugs`) → confirm drug list is populated with migrated data.

---

## Task 10: Commit Config Files to Git

**Goal:** Infrastructure config files are version-controlled so they're not lost.

**Note:** Do NOT commit `C:\supabase-self-host\.env` (contains secrets). Do commit the other config files.

- [ ] **Step 1: Copy config files into the app repo**

```powershell
New-Item -ItemType Directory -Path "C:\Users\$env:USERNAME\pharmacy-bin-keeper\infra" -Force

Copy-Item C:\supabase-self-host\nginx.conf `
    "C:\Users\$env:USERNAME\pharmacy-bin-keeper\infra\nginx.conf"

Copy-Item C:\PharmacyBackup\daily-backup.ps1 `
    "C:\Users\$env:USERNAME\pharmacy-bin-keeper\infra\daily-backup.ps1"
```

- [ ] **Step 2: Create a .env.local-example file documenting the shape**

Save as `C:\Users\<YourUsername>\pharmacy-bin-keeper\infra\.env.supabase-local-example`:

```
# Supabase self-host .env — fill in actual values, never commit with real secrets
POSTGRES_PASSWORD=<generated-32-char-base64>
JWT_SECRET=<generated-40-char-base64>
ANON_KEY=<HS256-jwt-role-anon>
SERVICE_ROLE_KEY=<HS256-jwt-role-service_role>
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=<chosen>
API_EXTERNAL_URL=http://<LAN-IP>:8000
SUPABASE_PUBLIC_URL=http://<LAN-IP>:8000
ENABLE_EMAIL_AUTOCONFIRM=true
```

- [ ] **Step 3: Commit**

```powershell
cd "C:\Users\$env:USERNAME\pharmacy-bin-keeper"
git add infra/
git commit -m "infra: add nginx config, backup script, and supabase env template for self-hosted deployment"
git push
```

---

## Cheatsheet — Key Values (Fill In During Setup)

Keep this in a secure note (e.g. phone notes app, password manager):

```
LAN IP:              192.168.___.___ 
POSTGRES_PASSWORD:   _______________
JWT_SECRET:          _______________
ANON_KEY:            eyJ...
SERVICE_ROLE_KEY:    eyJ...
DASHBOARD_USERNAME:  admin
DASHBOARD_PASSWORD:  _______________
Studio URL:          http://<LAN-IP>:3000
App URL:             http://<LAN-IP>
Backup folder:       C:\Users\...\OneDrive\PharmacyBackup
```

---

## Ongoing Maintenance

**When you pull app code updates:**
```powershell
cd "C:\Users\$env:USERNAME\pharmacy-bin-keeper"
git pull
npm install
npm run build
docker restart pharmacy-web-pharmacy-web-1   # nginx picks up new dist/ automatically
```

Or simpler — just restart the nginx container after rebuilding:
```powershell
docker compose -f C:\supabase-self-host\docker-compose.yml restart pharmacy-web
```

**If a container crashes:**
```powershell
docker compose -f C:\supabase-self-host\docker-compose.yml ps
docker compose -f C:\supabase-self-host\docker-compose.yml logs <service-name>
docker compose -f C:\supabase-self-host\docker-compose.yml restart <service-name>
```

**Add a new staff user:** Repeat Task 7 Steps 2–4.
