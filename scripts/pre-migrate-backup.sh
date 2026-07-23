#!/usr/bin/env bash
# Pre-migrate backup of the box-local flux Postgres DB.
# Run on the EC2 box from the app dir (deploy.sh calls it before `prisma migrate deploy`):
#   cd /var/www/flux && bash scripts/pre-migrate-backup.sh
#
# Reads DATABASE_URL from ./.env, writes a timestamped custom-format dump to
# ./db-backups/, and keeps only the most recent $KEEP dumps. Parses the URL into
# libpq flags rather than passing it whole, because the app's DATABASE_URL carries
# the Prisma-only `?schema=` query param, which libpq/pg_dump rejects.
#
# Restore a dump with:
#   pg_restore -h 127.0.0.1 -U flux_app -d flux --clean --if-exists <dump>
set -euo pipefail

ENVF="${1:-.env}"
OUTDIR="db-backups"
KEEP="${KEEP:-10}"

[ -f "$ENVF" ] || { echo "env file not found: $ENVF" >&2; exit 1; }
url=$(grep -E '^DATABASE_URL=' "$ENVF" | head -1 | cut -d= -f2- | tr -d '"')
[ -n "$url" ] || { echo "DATABASE_URL not found in $ENVF" >&2; exit 1; }

# postgresql://user:pass@host:port/db?params  ->  discrete parts
rest=${url#*://}
creds=${rest%%@*}
hostpart=${rest#*@}
user=${creds%%:*}
pass=${creds#*:}
hostport=${hostpart%%/*}
host=${hostport%%:*}
port=${hostport##*:}; [ "$port" = "$hostport" ] && port=5432
dbq=${hostpart#*/}
db=${dbq%%\?*}

[ -n "$user" ] && [ -n "$host" ] && [ -n "$db" ] || { echo "could not parse DATABASE_URL" >&2; exit 1; }

mkdir -p "$OUTDIR"
out="$OUTDIR/flux-$(date +%Y%m%d-%H%M%S).pre-migrate.dump"
PGPASSWORD="$pass" pg_dump -h "$host" -p "$port" -U "$user" -d "$db" -Fc -f "$out"
echo "DB backup -> $out ($(du -h "$out" | cut -f1))"

# prune: keep the newest $KEEP
ls -1t "$OUTDIR"/flux-*.pre-migrate.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
