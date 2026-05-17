# D&D Beyond paste import (M3)

**Status:** placeholder. M0 ships nothing here.

## Why paste, not scrape

WotC's TOS plus D&D Beyond's anti-bot measures make scraping a maintenance
treadmill. Asking the user to copy from a character page side-steps both
issues: the user is logged into their DDB account, the data crosses a
user-initiated boundary, and the importer never talks to ddb.com.

## Likely shape

1. User opens their character on https://www.dndbeyond.com/characters/<id>.
2. In Grimoire, hits "Import from D&D Beyond" → modal asks them to paste
   the character's full page text (or, better, the JSON visible in
   browser devtools network panel for `/character-service/...`).
3. We parse one of:
   - the JSON blob from the DDB character-service endpoint (best fidelity),
   - the printable character sheet plaintext (lower fidelity, more work).
4. Map fields to Grimoire's character Y.Doc shape and create the character
   row.

## Open questions for M3

- Which paste format do we commit to first? JSON blob is much higher
  fidelity but requires devtools savvy from the user.
- How much of DDB's homebrew / source content do we replicate vs leave
  as freeform text fields?
- Do we round-trip — re-import to refresh a sheet that was edited on DDB?
  Probably not in M3; merging CRDT edits with a fresh import is a separate
  problem.
