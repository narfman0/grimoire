#!/usr/bin/env bash
# Seed a fresh DM session against the dev server and print
# `KEY=VALUE` lines the caller can `source` into their shell.
#
# Usage:
#   bash seed.sh                  # DM only
#   bash seed.sh --with-player    # also seed a second user joined as player
#
# Pre: pnpm dev running on http://localhost:5173.
set -euo pipefail

BASE=${BASE:-http://localhost:5173}
WITH_PLAYER=0
for arg in "$@"; do
  case "$arg" in
    --with-player) WITH_PLAYER=1 ;;
  esac
done

# Cheap aliveness check — fail clearly if the dev server isn't up.
if ! curl -sIf "$BASE/" >/dev/null 2>&1; then
  echo "seed.sh: $BASE not reachable — start the dev server first" >&2
  exit 2
fi

# Distinct names so concurrent runs / leftover state don't collide.
SUFFIX="$(date +%s)_$$"
DM_USERNAME="verify_dm_${SUFFIX}"
DM_PASSWORD="verify-pass-123"
DM_COOKIE_JAR="/tmp/verifier-encounter-dm-${SUFFIX}.txt"

# Helper: extract a single JSON field via node (no jq dependency).
json_field() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).$1)}catch(e){process.stderr.write('parse fail: '+d);process.exit(1)}})"
}

# 1. Signup DM.
curl -sfX POST "$BASE/api/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$DM_USERNAME\",\"password\":\"$DM_PASSWORD\"}" \
  -c "$DM_COOKIE_JAR" -o /dev/null

# 2. Create campaign.
CAMP_JSON=$(curl -sfX POST "$BASE/api/campaigns" \
  -H 'Content-Type: application/json' -b "$DM_COOKIE_JAR" \
  -d '{"name":"verify-encounter-campaign"}')
CAMPAIGN_ID=$(echo "$CAMP_JSON" | json_field 'id')
CAMPAIGN_CODE=$(echo "$CAMP_JSON" | json_field 'code')

# 3. Create encounter (DM-owned, defaults to staging).
ENC_JSON=$(curl -sfX POST "$BASE/api/encounters" \
  -H 'Content-Type: application/json' -b "$DM_COOKIE_JAR" \
  -d "{\"campaignCode\":\"$CAMPAIGN_CODE\",\"name\":\"verify-encounter\"}")
ENCOUNTER_ID=$(echo "$ENC_JSON" | json_field 'id')

# 4. Promote to live so the encounter page renders the live UI.
curl -sfX PATCH "$BASE/api/encounters/$ENCOUNTER_ID" \
  -H 'Content-Type: application/json' -b "$DM_COOKIE_JAR" \
  -d '{"status":"live"}' -o /dev/null

# 5. Add a non-PC participant named Goblin.
MON_JSON=$(curl -sfX POST "$BASE/api/encounters/$ENCOUNTER_ID/participants" \
  -H 'Content-Type: application/json' -b "$DM_COOKIE_JAR" \
  -d '{"kind":"npc","name":"Goblin"}')
MONSTER_ID=$(echo "$MON_JSON" | json_field 'id')

# Output (shell-eval'able).
cat <<EOF
COOKIE_JAR=$DM_COOKIE_JAR
DM_USERNAME=$DM_USERNAME
DM_PASSWORD=$DM_PASSWORD
CAMPAIGN_ID=$CAMPAIGN_ID
CAMPAIGN_CODE=$CAMPAIGN_CODE
ENCOUNTER_ID=$ENCOUNTER_ID
MONSTER_ID=$MONSTER_ID
BASE=$BASE
EOF

if [[ "$WITH_PLAYER" == "1" ]]; then
  PLAYER_USERNAME="verify_player_${SUFFIX}"
  PLAYER_COOKIE_JAR="/tmp/verifier-encounter-player-${SUFFIX}.txt"
  curl -sfX POST "$BASE/api/auth/signup" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$PLAYER_USERNAME\",\"password\":\"$DM_PASSWORD\"}" \
    -c "$PLAYER_COOKIE_JAR" -o /dev/null
  curl -sfX POST "$BASE/api/campaigns/$CAMPAIGN_CODE/join" \
    -b "$PLAYER_COOKIE_JAR" -o /dev/null
  cat <<EOF
PLAYER_USERNAME=$PLAYER_USERNAME
PLAYER_COOKIE_JAR=$PLAYER_COOKIE_JAR
EOF
fi
