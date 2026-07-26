#!/bin/sh
# Container entrypoint: migrate, then serve — with Litestream replication
# when configured.
#
# Offsite backups activate when LITESTREAM_REPLICA_URL is set (an S3/R2/B2
# URL, e.g. s3://bucket/grimoire.db) together with the usual
# LITESTREAM_ACCESS_KEY_ID / LITESTREAM_SECRET_ACCESS_KEY (and
# AWS_REGION/LITESTREAM_* endpoint vars for non-AWS providers). On Fly:
#   fly secrets set LITESTREAM_REPLICA_URL=s3://... LITESTREAM_ACCESS_KEY_ID=... LITESTREAM_SECRET_ACCESS_KEY=...
# Without the env var this script behaves exactly like the pre-Litestream
# CMD: migrate && serve. Restore procedure: see README "Backups".
set -e

node scripts/migrate.mjs

if [ -n "$LITESTREAM_REPLICA_URL" ]; then
  DB_PATH="${DATABASE_URL:-./grimoire.db}"
  echo "litestream: replicating $DB_PATH -> $LITESTREAM_REPLICA_URL"
  exec litestream replicate \
    -exec "node build" \
    "$DB_PATH" "$LITESTREAM_REPLICA_URL"
else
  echo "litestream: LITESTREAM_REPLICA_URL not set — offsite replication disabled"
  exec node build
fi
