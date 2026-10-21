#!/usr/bin/env bash
# Logical backup of the catalogue database (custom format, compressed).
#
#   pnpm db:backup                       # uses BACKUP_DATABASE_URL or DATABASE_URL
#   BACKUP_DIR=/mnt/backups pnpm db:backup
#
# Use a direct (non-pooled) connection string for pg_dump on Neon/Supabase.
set -euo pipefail

if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then set -a; source .env; set +a; fi
URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL or BACKUP_DATABASE_URL must be set}}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DIR"
chmod 700 "$DIR"
FILE="$DIR/merven-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --dbname="$URL" --format=custom --compress=9 --no-owner --no-privileges --file="$FILE"
chmod 600 "$FILE"

# Verify the archive is readable before declaring success.
pg_restore --list "$FILE" > /dev/null
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Keep the newest $KEEP backups.
ls -1t "$DIR"/merven-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
