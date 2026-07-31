# SMTP Setup — invite + reset emails (self-hosted Supabase)

Emails (invite links, forgot-password) are sent by GoTrue (the `auth`
container). Until SMTP is configured, `invite_user` and
`resetPasswordForEmail` calls fail with an SMTP error.

## Prerequisites

- A Hostinger mailbox, e.g. `noreply@<domain>` (Hostinger hPanel → Emails →
  Create mailbox). Note the mailbox password.

## Configure (Coolify)

In Coolify → the Supabase stack → the `auth` (GoTrue) service → Environment
Variables, set:

| Variable | Value |
|---|---|
| `GOTRUE_SMTP_HOST` | `smtp.hostinger.com` |
| `GOTRUE_SMTP_PORT` | `465` |
| `GOTRUE_SMTP_USER` | `noreply@<domain>` |
| `GOTRUE_SMTP_PASS` | mailbox password |
| `GOTRUE_SMTP_ADMIN_EMAIL` | `noreply@<domain>` |
| `GOTRUE_SMTP_SENDER_NAME` | `PharmaSync` |

Redeploy/restart the `auth` service.

Note: some Supabase docker-compose stacks name these `SMTP_HOST`, `SMTP_PORT`,
etc. and map them through to GoTrue — check the stack's compose file for which
names it forwards, and set the ones it uses.

## Also verify

- `GOTRUE_SITE_URL` (or `SITE_URL`) is the production app URL.
- `GOTRUE_URI_ALLOW_LIST` (or `ADDITIONAL_REDIRECT_URLS`) includes
  `<production-origin>/reset-password`.

## Smoke test

1. Login page → "Forgot password" → own email → reset email arrives.
2. Role Management → Add New User → invite mode → test email → invite arrives,
   link opens `/reset-password`, password can be set, login works.
