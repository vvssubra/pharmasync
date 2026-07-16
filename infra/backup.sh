#!/usr/bin/env bash
# Nightly PharmaSync backup: Postgres (public+auth+storage schemas), storage
# object files, and the Obsidian vault. 30-day local rotation.
#
# Install (as root):
#   crontab -e
#   0 2 * * * /opt/pharmasync/infra/backup.sh >> /var/log/pharmasync-backup.log 2>&1
#
# Off-box copy: uncomment the rclone line after configuring a remote
# (rclone config), or rsync $DEST to another host — a backup that lives only
# on the VPS disappears with the VPS.
set -euo pipefail

STAMP=$(date +%F)
DEST=/opt/backups
SUPABASE_DOCKER_DIR=/opt/supabase/docker
VAULT_DIR=/opt/pharmasync-vault

mkdir -p "$DEST"

# DB: superuser dump so ownership/ACL lines and --clean restore cleanly.
docker exec supabase-db pg_dump -U supabase_admin -d postgres \
  --clean --if-exists -n public -n auth -n storage \
  | gzip > "$DEST/db-$STAMP.sql.gz"

# Storage object FILES (DB rows above are metadata only).
tar czf "$DEST/storage-$STAMP.tar.gz" -C "$SUPABASE_DOCKER_DIR/volumes" storage

# Obsidian vault (dosing notes).
if [ -d "$VAULT_DIR" ]; then
  tar czf "$DEST/vault-$STAMP.tar.gz" -C "$(dirname "$VAULT_DIR")" "$(basename "$VAULT_DIR")"
fi

# 30-day rotation.
find "$DEST" -name '*.gz' -mtime +30 -delete

# rclone copy "$DEST" remote:pharmasync-backups   # ← configure and uncomment

echo "[backup] $STAMP done: $(ls -sh "$DEST" | tail -n +2 | wc -l) files in $DEST"
