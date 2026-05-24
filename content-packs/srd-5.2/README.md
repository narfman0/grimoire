# srd-5.2 — System Reference Document 5.2.1

WotC's April 2025 SRD release, under CC-BY 4.0. See
[`LICENSE`](./LICENSE) for the required attribution boilerplate and a
note on provenance for spell rows imported via
`scripts/import-spells.mjs`.

## Contents

| Kind         | Source file                                       |
| ------------ | ------------------------------------------------- |
| meta         | `meta.json`                                       |
| species      | `species.json`                                    |
| classes      | `classes/<class>.json`                            |
| subclasses   | `subclasses.json`                                 |
| backgrounds  | `backgrounds.json`                                |
| feats        | `feats.json`                                      |
| features     | `features/<feature>.json`                         |
| spells       | `spells/<level>.json` (cantrips, 1st-level, …)    |
| items        | `items/<group>.json`                              |
| monsters     | `monsters.json`                                   |
| conditions   | `conditions.json`                                 |

## Updating spells

Bulk-import scaffold lives at
[`/scripts/import-spells.mjs`](../../scripts/import-spells.mjs). It
parses the upstream SRD spell list (currently `~/workspace/dnd-5e-srd`)
and emits slug-stub rows preserving hand-authored `activities[]` /
`upcastScaling` on the existing rows. See the script's `--help` output.
