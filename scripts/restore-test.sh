#!/usr/bin/env bash
# Restores a backup into a throwaway database and checks it matches the source.
#
#   pnpm db:restore-test                 # newest file in ./backups
#   pnpm db:restore-test path/to/file.dump
#
# Needs a role that can CREATE/DROP DATABASE on the server given by
# RESTORE_SERVER_URL (defaults to the server in DATABASE_URL, database "postgres").
set -euo pipefail

if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then set -a; source .env; set +a; fi
SOURCE_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:?DATABASE_URL must be set}}"
FILE="${1:-$(ls -1t "${BACKUP_DIR:-./backups}"/merven-*.dump 2>/dev/null | head -n1)}"
[[ -n "$FILE" && -f "$FILE" ]] || { echo "No backup file found. Run pnpm db:backup first." >&2; exit 1; }

SERVER_URL="${RESTORE_SERVER_URL:-$(python3 - "$SOURCE_URL" <<'PY'
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); print(u.urlunsplit(p._replace(path="/postgres")))
PY
)}"
SCRATCH="merven_restore_test_$(date -u +%s)"
SCRATCH_URL="$(python3 - "$SERVER_URL" "$SCRATCH" <<'PY'
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); print(u.urlunsplit(p._replace(path="/" + sys.argv[2])))
PY
)"

cleanup() { psql --dbname="$SERVER_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Restoring $FILE into scratch database $SCRATCH…"
psql --dbname="$SERVER_URL" -qc "CREATE DATABASE \"$SCRATCH\"" 2>/dev/null
pg_restore --dbname="$SCRATCH_URL" --no-owner --no-privileges --exit-on-error "$FILE"

QUERY='SELECT (SELECT count(*) FROM category)||'"'"' '"'"'||(SELECT count(*) FROM product)||'"'"' '"'"'||(SELECT count(*) FROM product_variant)||'"'"' '"'"'||(SELECT count(*) FROM product_image)||'"'"' '"'"'||(SELECT count(*) FROM admin_user)||'"'"' '"'"'||(SELECT count(*) FROM _prisma_migrations)'
RESTORED="$(psql --dbname="$SCRATCH_URL" -Atqc "$QUERY" 2>/dev/null)"
SOURCE="$(psql --dbname="$SOURCE_URL" -Atqc "$QUERY" 2>/dev/null)"
CHECKS="$(psql --dbname="$SCRATCH_URL" -Atqc "SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'product%'" 2>/dev/null)"

echo "Row counts (category product variant image admin migrations)"
echo "  restored: $RESTORED"
echo "  source:   $SOURCE"
echo "  CHECK constraints restored: $CHECKS"
if [[ "$RESTORED" == "$SOURCE" && "$CHECKS" -ge 5 ]]; then
  echo "Restore test PASSED"
else
  echo "Restore test FAILED (counts differ; the source may have changed since the backup)" >&2
  exit 1
fi
