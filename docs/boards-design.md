# Boards — battle maps, fog of war, and the turn optimizer

Design for positional combat: a standalone map builder with a painted
tile board, board-aware encounters with fog of war riding the existing
reveals model, movement in the turn plan, and a deterministic NPC turn
suggester. A later AI path generates a draft board from an uploaded
photo or drawing.

Boards are strictly additive: `posX/posY` are nullable and an encounter
with no board attached behaves exactly as a board-less encounter does
today. Theater-of-mind tables lose nothing.

## Why a tile board (and not a zone graph or a full simulator)

An earlier design sketched a zone graph (nodes with tags, edges with
costs) to avoid the "grid simulator trap". The trap is real, but it is
pixel-perfect walls, raycast lighting, and physics — not tiles. A tile
board *is* a graph, just denser: cells are nodes, adjacency is edges,
terrain flags are tags. Every pure primitive the zone design wanted
(`distance`, `reachable`, `inRange`, `aoe`, `coverBetween`) is the same
function over cells, and painting tiles is a dramatically better
authoring UX than sketching polygons. A W×H grid of tile codes is also a
robust structured-output target for AI ingestion, where freehand
polygons are not.

The zone idea survives as one degenerate case: board-less encounters get
an implicit 3-cell near/mid/far strip so every engine primitive still
answers sensibly without a map.

## Board model — `src/lib/board/`

Pure, deterministic, no I/O — the same discipline as `src/lib/rules/`,
pinned by the same purity guard.

### Tileset

The tileset is data, defined once and read by both the painter and the
engine:

```ts
interface TileDef {
  id: number;            // stable wire code; 0 = unknown/void
  slug: string;          // 'floor' | 'wall' | ...
  name: string;
  color: string;         // flat fill; light/dark theme pair
  glyph?: string;        // small SVG/emoji overlay for legibility
  blocksMove?: boolean;
  blocksSight?: boolean;
  difficult?: boolean;   // double movement cost
  cover?: 'half' | 'three-quarters' | 'full';
  hazard?: { note: string };  // advisory chip, not auto-damage
  door?: 'closed' | 'open';   // toggleable pair; closed blocks move+sight
}
```

Base set (~16): void, floor, wall, difficult (rubble), water (difficult),
deep water, lava (hazard), pit, door closed/open, stairs, foliage (half
cover + difficult), furniture (half cover), darkness (blocks sight),
bridge, ice (difficult + hazard note). Flat colors plus glyphs —
licensing-clean, theme-aware, no sprite art. A real image tileset later
is a rendering swap, not a model change: `TileDef` is the extension
point.

### Board

```ts
interface Board {
  w: number; h: number;        // cells; capped (100×100)
  cellFt: number;              // default 5
  tiles: string;               // RLE-encoded tile ids, row-major
  background?: string | null;  // optional image url under the tiles
}
```

RLE keeps a full board at a few KB of text — whole-board writes, no
incremental protocol.

### Geometry primitives

All pure functions over the decoded grid:

- `distanceFt(a, b)` — every diagonal 5 ft (Chebyshev × `cellFt`).
- `reachableCells(board, from, speedFt, occupied)` — Dijkstra;
  difficult terrain doubles, `blocksMove` blocks, enemies block, allies
  cost.
- `inRangeFt(board, a, b, rangeFt)`.
- `lineOfSight(board, a, b)` — Bresenham over `blocksSight`.
- `coverBetween(board, attacker, target)` — intervening cover/sight
  tiles → none/half/three-quarters/full.
- `aoeCells(board, origin, shape: sphere|cone|line|cube, sizeFt, dir?)`.
- `threatenedCells(board, participants, byTeam)` — union of enemy melee
  reach; the opportunity-attack map.
- `impliedBoard()` — the 3-cell fallback for board-less encounters.

## Data model and API

- **`maps`** — a user's reusable library: owner, name, dimensions,
  `cellFt`, tiles, optional background image. Any user can build maps;
  they matter when attached to an encounter the user DMs.
- **`encounter_boards`** — the per-encounter instance: unique per
  encounter, optional pointer back to the source map, its own copy of
  the tiles, a fog mask (`revealedJson`, RLE bitmask), and a `version`
  that increments on any tiles/fog write. **Copy-on-attach:** attaching
  a library map snapshots its tiles, so mid-fight edits (a door opens, a
  wall crumbles) never mutate the library original; saving back to the
  library is an explicit action.
- **`participants`** gain nullable `posX`, `posY`, and `sizeCells`
  (default 1, for Large+ token footprints). Null means untracked.

Routes follow house style (Zod schemas + `_openapi`): map-library CRUD
with a multipart background upload (same pattern as character
portraits); an encounter board resource with attach/create-blank,
DM-only tile and fog patches, and detach. Position writes ride the
existing participant PATCH — players may move only their own PC's
token, the DM moves anyone, mirroring the plan endpoint's guard.

## Visibility — fog rides the reveals model

Board visibility extends the existing per-participant reveals scheme
(`src/lib/realtime/reveals.ts`); it does not invent a new permissions
system. Both layers are enforced server-side at the load/GET layer,
never by client-side filtering:

1. **Fog.** Players receive tile codes only for revealed cells;
   unrevealed cells are masked to `0` before the response leaves the
   server. The DM paints reveals with the same brush/rect/flood tools
   used for terrain.
2. **Tokens.** A participant flagged `hidden`, or standing on an
   unrevealed cell, has its position redacted from the player view.

The encounter state poll carries `positions` per participant and a
`boardVersion`, folded into the existing ETag token. Clients refetch the
board resource only when the version bumps, so the poll payload stays
small and "the DM reveals a corridor and every player sees it within one
poll cycle" falls out of the same mechanism as every other reveal.

The optimizer honors the same boundary: player-facing suggestions are
computed against the redacted snapshot, so a hint can never leak what
the player cannot see.

## Map builder

A standalone feature: a library page listing the user's maps, and a
painter.

- Palette from the tileset; tools: brush (1/2/3 cells), rectangle fill,
  flood fill, eraser, door toggle. Undo/redo as a client-side op stack;
  save writes the whole RLE string.
- Grid resize, `cellFt` setting, and an optional background image with
  an opacity slider — the trace-over-a-drawing workflow, and the manual
  precursor of AI ingestion.
- Keyboard-first: number keys select the palette, `[`/`]` brush size,
  ctrl+Z undo.
- Quick-start templates (blank room, cavern, tavern) as seeded tile
  patterns.

The painter component is deliberately reusable in three modes: edit (map
builder, and DM mid-fight terrain changes), fog-paint (the DM reveal
brush), and read-only (players, table display).

**The bar for "fast":** a usable tavern-brawl board in under two minutes
from a blank map.

## Encounter integration

The encounter page gains a collapsible board panel (absent when no board
is attached):

- **Tokens** are participants: portrait/initials, `sizeCells` footprint,
  HP-bucket ring color, active-turn highlight. Drag to move; changes
  propagate on the poll.
- **DM tools:** attach/detach, fog brush, door toggle, embedded painter
  for terrain edits, bulk reveal/hide.
- **Planning overlays:** while planning, the board shades reachable
  cells for the actor's speed, highlights legal targets in range,
  previews AoE templates under the cursor, and marks threatened cells a
  path would cross.
- **Warnings, not blocks:** an out-of-range attack or unreachable move
  surfaces a soft warning chip. DM fiat always wins.
- A ruler tool for ad-hoc distance questions.
- The table-display view renders the board read-only through the player
  redaction path wholesale — fog applied, hidden tokens absent.

## Turn plan movement

The turn plan gains `moveTo?: {x, y}` (and an optional `path` for
display). Players pick a destination constrained to the shaded reachable
set, then action and targets; the target picker binds to visible
participants only. Resolution validates reachability and range as soft
warnings; advancing the turn applies `moveTo` to the participant's
position and records the move in the action log.

## NPC turn suggester

`suggestTurn(board, participants, actorId, opts) → RankedPlan[]` — pure
and deterministic (stable tie-break, exported scoring-weight table) so
fixtures pin exact output. It composes with the existing
action-availability and monster-derive layers rather than re-deriving
legality.

1. Enumerate the actor's actions (including multiattack and recharge
   state) × legal targets (visible, in range from some reachable cell)
   × candidate destination cells.
2. Score: expected damage (dice EV × hit probability against known AC),
   finishing a downed target, breaking concentration, focus-fire
   continuity, AoE placement (maximize enemies, minimize allies),
   positioning (cover gained, threat avoided, ranged keeps distance,
   brutes close), and the opportunity-attack cost of the path.
3. Return ranked plans in turn-plan shape plus a one-line rationale
   ("move to flank behind half cover; multiattack; 2 OA risked").

Surfaces: a "suggest turn" button per NPC returning the top few as
tappable drafts (the suggester proposes, the DM disposes); an
"auto-plan round" action that drafts every unplanned NPC; and optional
player hints behind a campaign setting, computed against the redacted
view. The suggester's legal-move enumeration is also the grounding layer
for the AI suggest-turn endpoint: the model picks among options this
module declares legal, so an illegal suggestion is structurally
impossible.

## Legendary and lair actions

Independent of the board, and improved by it:

- The legendary budget ("can take 3 legendary actions") and per-action
  costs ("costs 2 actions") are parsed into structured `{budget, costs}`
  at monster-derive time; the per-round legendary counter becomes
  cost-aware.
- **End-of-turn prompt:** when a PC's turn ends and a legendary creature
  has budget left, the DM is prompted with the creature's options and
  costs; one tap spends, logs to the action log, and decrements the
  tracker. The initiative-20 lair reminder joins the same prompt queue —
  one consistent channel for "it's the monster's moment".
- With a board attached, the suggester ranks legendary picks between
  turns using real positions.

## AI board generation (later)

An ingest endpoint accepts a photo or drawing and returns a **draft**
board: a vision call through the existing AI module, constrained by
structured output to the same Zod board schema the REST API validates —
W×H tile codes from the tileset enum plus a `cellFt` guess from detected
grid squares. The draft opens in the painter for the DM to correct and
commit; the model proposes, the human paints over its mistakes. This is
why the painter ships first and why the board schema doubles as the AI
contract.

## Acceptance

- A DM paints a five-room dungeon in under two minutes, attaches it to
  an encounter, and runs combat with dragged tokens.
- Players see exactly the revealed region and visible tokens, live
  within one poll cycle; a wire-level test proves unrevealed tile codes
  never leave the server.
- Planning shades reachable cells, previews AoE templates, and warns on
  out-of-range or unreachable — without ever hard-blocking the DM.
- The suggester returns a deterministic, test-pinned, sane plan on a
  fixture ambush; auto-plan drafts every NPC in one tap.
- A legendary creature prompts the DM after each PC turn with a
  cost-aware budget.
- Board-less encounters behave exactly as before.
