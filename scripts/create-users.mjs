#!/usr/bin/env node
// scripts/create-users.mjs
//
// Bulk-creates the clinic staff accounts through the admin-user-mgmt edge
// function. Same code path as the "Add New User" dialog in Role Management,
// just looped — nothing here touches the database directly.
//
// Safe to re-run: an address that already exists comes back 409 and is
// reported as SKIP, not as a failure.
//
// Usage:
//   SUPABASE_URL=https://<kong-host> \
//   SUPABASE_ANON_KEY=<anon key> \
//   ADMIN_EMAIL=psubramaniam@moh.gov.my \
//   ADMIN_PASSWORD=<super_admin password> \
//   CLINIC_ID=00000000-0000-0000-0000-000000000001 \
//   node scripts/create-users.mjs [--dry-run] [--only=email@example.com]
//
// Every created account carries must_change_password, so each user is held on
// /change-password until they replace TEMP_PASSWORD.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CLINIC_ID = process.env.CLINIC_ID;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD ?? "P@ssword1234";

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY = process.argv.find(a => a.startsWith("--only="))?.slice("--only=".length);

/** email is the login identity; full_name and role are what the app displays and gates on. */
const USERS = [
  { email: "drnisha274@gmail.com",        full_name: "NISHANTHINI A/P SUBRAMANIAM",              role: "mo" },
  { email: "nuruleina95@gmail.com",       full_name: "NURUL AMALINA BINTI ISHRAQI SHAH",         role: "mo" },
  { email: "fairuzsyahirah19@gmail.com",  full_name: "Fairuz syahirah binti husin",              role: "mo" },
  { email: "mageswary005@gmail.com",      full_name: "MAGESWARY A/P SUBRAMONIE",                 role: "mo" },
  { email: "pavipavithra6994@gmail.com",  full_name: "Pavithra A/P Ravinthiran",                 role: "mo" },
  { email: "arlinieahmad@gmail.com",      full_name: "Arlinie binti Ahmad",                      role: "mo" },
  { email: "sitiaiyshahshahid@gmail.com", full_name: "SITI AIYSHAH BINTI SHAHID",                role: "pharmacist" },
  { email: "norhidayahjamal@gmail.com",   full_name: "DR NOR HIDAYAH BINTI JAMAL",               role: "mo" },
  { email: "rajaizrulhaikal@gmail.com",   full_name: "RAJA IZRUL HAIKAL BIN RAJA EZAR ISHAMUDDIN", role: "mo" },
  { email: "athirahbudiono@gmail.com",    full_name: "Athirah binti budiono",                    role: "mo" },
  { email: "muhammadsyapiko@gmail.com",   full_name: "Muhammad Ezzatul Syafiq bin Muhammad Asri", role: "mo" },
  { email: "krisinasunther2016@gmail.com", full_name: "Krisina",                                 role: "mo" },
  // Login address given separately from the contact gmail on the roster.
  { email: "silverdaffodil@yahoo.com.sg", full_name: "ILI SHAZWANI BINTI MOHAMED MANSOR",        role: "mo" },
  { email: "arina97my@gmail.com",         full_name: "NUR ARINA BINTI MOHD AMIN",                role: "mo" },
  { email: "izzati.aziz@outlook.com",     full_name: "Nur Izzati binti Abdul Aziz",              role: "mo" },
];

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function signInAsAdmin() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Admin sign-in failed (${res.status}): ${body.error_description ?? body.msg ?? JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function createUser(token, user) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-user-mgmt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "create_user",
      full_name: user.full_name,
      email: user.email,
      password: TEMP_PASSWORD,
      role: user.role,
      // Required because the caller is super_admin: the function refuses to
      // guess a clinic for an account that spans all of them.
      clinic_id: CLINIC_ID,
    }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text }; }
  return { status: res.status, body };
}

async function main() {
  // A dry run only echoes the roster, so it stays usable without credentials.
  if (!DRY_RUN) {
    requireEnv("SUPABASE_URL", SUPABASE_URL);
    requireEnv("SUPABASE_ANON_KEY", SUPABASE_ANON_KEY);
    requireEnv("ADMIN_EMAIL", ADMIN_EMAIL);
    requireEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
    requireEnv("CLINIC_ID", CLINIC_ID);
  }

  const roster = ONLY ? USERS.filter(u => u.email === ONLY) : USERS;
  if (ONLY && roster.length === 0) {
    console.error(`--only=${ONLY} matches nobody on the roster.`);
    process.exit(1);
  }

  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Clinic: ${CLINIC_ID}`);
  console.log(`Users:  ${roster.length}${DRY_RUN ? "  (dry run — nothing will be created)" : ""}\n`);

  if (DRY_RUN) {
    for (const u of roster) console.log(`  DRY   ${u.email.padEnd(32)} ${u.role.padEnd(11)} ${u.full_name}`);
    return;
  }

  const token = await signInAsAdmin();
  const results = [];

  for (const user of roster) {
    const { status, body } = await createUser(token, user);
    // The message test is not redundant with the 409: older deployments of the
    // function matched GoTrue's duplicate wording too narrowly and returned
    // 500 for an address that already exists.
    const duplicate = status === 409 || /already\b.*\bregistered/i.test(body.error ?? "");
    let outcome;
    if (status === 201) outcome = "OK";
    else if (duplicate) outcome = "SKIP (exists)";
    else outcome = `FAIL ${status}: ${body.error ?? JSON.stringify(body)}`;
    results.push({ email: user.email, role: user.role, outcome });
    console.log(`  ${outcome.startsWith("FAIL") ? "✗" : "·"} ${user.email.padEnd(32)} ${outcome}`);
  }

  const ok = results.filter(r => r.outcome === "OK").length;
  const skipped = results.filter(r => r.outcome.startsWith("SKIP")).length;
  const failed = results.filter(r => r.outcome.startsWith("FAIL"));

  console.log(`\ncreated ${ok}   skipped ${skipped}   failed ${failed.length}`);
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ${f.email}: ${f.outcome}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
