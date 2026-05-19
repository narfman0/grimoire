import { error, redirect } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, schema } from '$lib/server/db';
import { derive } from '$lib/rules';
import type { CharacterDocument } from '$lib/rules/types';
import { buildContentLookup, serializeDerived } from '$lib/server/content/lookup';
import { requireMembershipByCode } from '$lib/server/auth/membership';
import { hpBucket, parseReveals } from '$lib/realtime/reveals';
import type { TPlanJson } from '$lib/server/api/encounter-schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const code = params.code.toUpperCase();
  const membership = await requireMembershipByCode(locals.user, code);

  const campaignRows = await db
    .select({
      id: schema.campaigns.id,
      code: schema.campaigns.code,
      name: schema.campaigns.name
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.code, code))
    .limit(1);
  if (campaignRows.length === 0) throw redirect(303, '/');
  const campaign = campaignRows[0];

  // Post-Phase 1: a character "belongs to" this campaign iff there's a
  // campaign_characters row pairing them. JOIN through that to enforce
  // the URL's campaign code matches a link the character actually has.
  const characterRows = await db
    .select({
      id: schema.characters.id,
      campaignId: schema.characters.campaignId,
      ownerUserId: schema.characters.ownerUserId,
      name: schema.characters.name,
      document: schema.characters.document,
      updatedAt: schema.characters.updatedAt
    })
    .from(schema.characters)
    .innerJoin(
      schema.campaignCharacters,
      eq(schema.campaignCharacters.characterId, schema.characters.id)
    )
    .where(
      and(
        eq(schema.characters.id, params.id),
        eq(schema.campaignCharacters.campaignId, campaign.id)
      )
    )
    .limit(1);
  if (characterRows.length === 0) throw error(404, 'character not found in this campaign');
  const character = characterRows[0];

  // Hoist lookups above the "no document" early-return so the page always
  // sees the same shape. When the character has no document yet, derived
  // + liveEncounter are null but the picker option lists still load —
  // simpler client typing, no narrowing-then-undefined cascade.
  const document = character.document ? (JSON.parse(character.document) as CharacterDocument) : null;
  // Pass the character's owner so their homebrew content rows are visible to
  // derive() — that user's homebrew wins slug collisions against any
  // pack-loaded row of the same kind/slug.
  const { lookup, map: contentMap } = await buildContentLookup(
    character.ownerUserId ?? undefined
  );
  const derived = document ? derive(document, lookup) : null;

  // Picker visibility — the same rule for every kind. Pack rows + character
  // owner's own homebrew + every author the character owner is subscribed
  // to. Mirrors buildContentLookup so the picker can't show a slug the
  // engine won't resolve.
  const homebrewScope = character.ownerUserId;
  const subscribedAuthorRows = homebrewScope
    ? await db
        .select({ authorUserId: schema.homebrewSubscriptions.authorUserId })
        .from(schema.homebrewSubscriptions)
        .where(eq(schema.homebrewSubscriptions.userId, homebrewScope))
    : [];
  const subscribedAuthorIds = [...new Set(subscribedAuthorRows.map((r) => r.authorUserId))];

  function pickerOwnerFilter() {
    const clauses = [isNull(schema.content.ownerUserId)];
    if (homebrewScope) clauses.push(eq(schema.content.ownerUserId, homebrewScope));
    if (subscribedAuthorIds.length > 0) {
      clauses.push(inArray(schema.content.ownerUserId, subscribedAuthorIds));
    }
    return or(...clauses);
  }
  function homebrewBadge(ownerUserId: string | null) {
    if (ownerUserId === null) return { isHomebrew: false, isSubscribed: false, authorUserId: null };
    return {
      isHomebrew: true,
      isSubscribed: ownerUserId !== homebrewScope,
      authorUserId: ownerUserId
    };
  }
  /** Unique picker key — slug+author so two homebrews with the same slug
   *  from different authors are distinct dropdown entries. */
  function pickerId(slug: string, ownerUserId: string | null): string {
    return `${slug}|${ownerUserId ?? ''}`;
  }

  // Item picker options for the inventory section.
  const itemRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'item'), pickerOwnerFilter()));

  const itemOptions = itemRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        weaponType?: string;
        armorType?: string;
        requiresAttunement?: boolean | object;
        weight?: number;
        cost?: { value?: number; unit?: string } | string | number;
        damage?: Array<{ dice: string; type: string }> | string;
        damageType?: string;
        properties?: string[];
        ac?: number | { value?: number; calc?: string };
        range?: { value?: number; long?: number; units?: string };
        rarity?: string;
        charges?: { max?: number; per?: string };
        description?: string;
      };
      // Homebrew weapons sometimes serialize damage as a single dice string
      // with `damageType` alongside (the rules-engine attack shape) instead
      // of the canonical `Array<{dice, type}>` the picker/template expects.
      // Normalize so downstream code can rely on one shape.
      const damage: Array<{ dice: string; type: string }> | null =
        Array.isArray(data.damage)
          ? data.damage
          : typeof data.damage === 'string' && data.damage.length > 0
            ? [{ dice: data.damage, type: data.damageType ?? '' }]
            : null;
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        category: data.category ?? 'other',
        kindHint: data.weaponType ?? data.armorType ?? data.category ?? '',
        requiresAttunement: data.requiresAttunement === true,
        weaponType: data.weaponType ?? null,
        armorType: data.armorType ?? null,
        weight: typeof data.weight === 'number' ? data.weight : null,
        cost: data.cost ?? null,
        damage,
        properties: data.properties ?? [],
        ac: data.ac ?? null,
        range: data.range ?? null,
        rarity: data.rarity ?? '',
        charges: data.charges ?? null,
        description: typeof data.description === 'string' ? data.description : '',
        pickerId: pickerId(r.slug, r.ownerUserId),
        ...homebrewBadge(r.ownerUserId)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const spellRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'spell'), pickerOwnerFilter()));

  const spellOptions = spellRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        level?: number;
        school?: string;
        castingTime?: string;
        range?: { value?: number; units?: string } | string;
        components?: string[];
        duration?: string | { value?: number; units?: string; concentration?: boolean };
        concentration?: boolean;
        ritual?: boolean;
        description?: string;
        activities?: Array<{
          attack?: { ability?: string; range?: string };
          save?: { ability?: string; dc?: { calc?: string; value?: number } };
          damage?: { parts?: Array<{ dice: string; type: string }> };
        }>;
      };
      const act = data.activities?.[0];
      // Damage dice shown in popup come from the first activity's damage
      // block (mechanical numbers, no flavor). Save / attack info same.
      const damage = act?.damage?.parts ?? null;
      const isConcentration =
        data.concentration === true ||
        (typeof data.duration === 'object' && data.duration?.concentration === true);
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        level: data.level ?? 0,
        school: data.school ?? '',
        castingTime: data.castingTime ?? '',
        range: data.range ?? null,
        components: data.components ?? [],
        duration: data.duration ?? null,
        concentration: isConcentration,
        ritual: data.ritual === true,
        attackKind: act?.attack ? `${act.attack.range ?? ''} attack` : null,
        save: act?.save?.ability
          ? {
              ability: act.save.ability,
              calc: act.save.dc?.calc ?? '',
              value: act.save.dc?.value ?? null
            }
          : null,
        damage,
        description: typeof data.description === 'string' ? data.description : '',
        pickerId: pickerId(r.slug, r.ownerUserId),
        ...homebrewBadge(r.ownerUserId)
      };
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

  // Feat picker options. Visibility: pack rows + character-owner's homebrew
  // + every author the character owner subscribes to (via pickerOwnerFilter).
  const featRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'feat'), pickerOwnerFilter()));
  const featOptions = featRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as {
        category?: string;
        description?: string;
        prerequisite?: string;
        choices?: {
          asi?: { bonus?: number; allowedAbilities?: string[] };
          skillProficiency?: { allowedSkills?: string[] };
          expertise?: { allowedSkills?: string[] | 'proficient' };
          savingThrow?: { allowedAbilities?: string[] };
          language?: { allowedLanguages?: string[] };
          toolProficiency?: { allowedTools?: string[] };
          spell?: { picks?: number; level?: number; allowedSpells?: string[] };
          feature?: { allowedFeatures?: string[]; category?: string };
        };
      };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        category: data.category ?? '',
        description: data.description ?? '',
        prerequisite: data.prerequisite ?? '',
        choices: data.choices ?? null,
        pickerId: pickerId(r.slug, r.ownerUserId),
        ...homebrewBadge(r.ownerUserId)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const subclassRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'subclass'), pickerOwnerFilter()));

  const subclassOptions = subclassRows
    .map((r) => {
      const data = JSON.parse(r.data as string) as { parentClass?: string };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        parentClass: data.parentClass ?? '',
        pickerId: pickerId(r.slug, r.ownerUserId),
        ...homebrewBadge(r.ownerUserId)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // M3.4: locate the live encounter (if any) this character is a participant
  // in. The planner section on the sheet connects to that encounter's Y.Doc
  // and lets the player broadcast a turn plan to the DM. If multiple
  // encounters are live for this campaign (allowed — split party, etc.),
  // we pick the most recent. Refresh required if a new encounter goes live
  // mid-session (we don't push encounter-list changes yet).
  const liveEncRows = await db
    .select({
      encId: schema.encounters.id,
      encName: schema.encounters.name,
      encCreatedAt: schema.encounters.createdAt,
      partId: schema.participants.id,
      partName: schema.participants.name
    })
    .from(schema.encounters)
    .innerJoin(schema.participants, eq(schema.participants.encounterId, schema.encounters.id))
    .where(
      and(
        eq(schema.encounters.campaignId, campaign.id),
        eq(schema.encounters.status, 'live'),
        eq(schema.participants.characterId, character.id)
      )
    );
  const liveEncSorted = [...liveEncRows].sort(
    (a, b) => b.encCreatedAt.getTime() - a.encCreatedAt.getTime()
  );
  const liveEncMatch = liveEncSorted[0] ?? null;

  let liveEncounter: {
    id: string;
    name: string;
    selfParticipantId: string;
    /** Last-broadcast turn plan for *this* PC, loaded from participants.plan_json
     *  so the planner pre-selects on first paint (refresh-safe). null when the
     *  player has no active plan. */
    selfPlan: TPlanJson | null;
    participants: Array<{
      id: string;
      name: string;
      kind: string;
      maxHp: number | null;
      hpBucket: ReturnType<typeof hpBucket>;
      reveals: ReturnType<typeof parseReveals>;
    }>;
  } | null = null;
  if (liveEncMatch) {
    const allParticipants = await db
      .select({
        id: schema.participants.id,
        name: schema.participants.name,
        kind: schema.participants.kind,
        maxHp: schema.participants.maxHp,
        currentHp: schema.participants.currentHp,
        revealsJson: schema.participants.revealsJson,
        planJson: schema.participants.planJson
      })
      .from(schema.participants)
      .where(eq(schema.participants.encounterId, liveEncMatch.encId));

    const selfRow = allParticipants.find((p) => p.id === liveEncMatch.partId);
    let selfPlan: TPlanJson | null = null;
    if (selfRow?.planJson) {
      try {
        selfPlan = JSON.parse(selfRow.planJson) as TPlanJson;
      } catch {
        // ignore malformed plan
      }
    }

    // Project for the requester. The DM sees everything; players get the
    // same reveal-filtered shape the encounter page uses, with placeholder
    // names ("Enemy N") in initiative-stable order and HP only as a bucket
    // unless `vitals` is revealed. Self always renders fully (own PC).
    const isDM = membership.role === 'dm';
    const visible = allParticipants.filter(
      (p) => isDM || p.kind === 'pc' || !parseReveals(p.revealsJson).hidden
    );
    let idx = 0;
    const projected = visible.map((p) => {
      const reveals = parseReveals(p.revealsJson);
      const isSelf = p.id === liveEncMatch.partId;
      if (isDM || isSelf || p.kind === 'pc') {
        return {
          id: p.id,
          name: p.name,
          kind: p.kind,
          maxHp: p.maxHp,
          hpBucket: hpBucket(p.currentHp, p.maxHp),
          reveals
        };
      }
      const placeholder = reveals.identity ? p.name : `Enemy ${++idx}`;
      return {
        id: p.id,
        name: placeholder,
        kind: reveals.identity ? p.kind : 'unknown',
        maxHp: reveals.vitals ? p.maxHp : null,
        hpBucket: hpBucket(p.currentHp, p.maxHp),
        reveals
      };
    });

    liveEncounter = {
      id: liveEncMatch.encId,
      name: liveEncMatch.encName,
      selfParticipantId: liveEncMatch.partId,
      selfPlan,
      participants: projected
    };
  }

  // Recent action ids for the planner's suggester (M3.6). We join action_log
  // through participants to find rows where this character acted, then keep
  // the most recent occurrence of each actionId. Cap to ~50 distinct ids
  // — enough for ordering, small enough to ship in page data.
  const logRows = await db
    .select({
      actionId: schema.actionLog.actionId,
      createdAt: schema.actionLog.createdAt
    })
    .from(schema.actionLog)
    .innerJoin(
      schema.participants,
      eq(schema.actionLog.participantId, schema.participants.id)
    )
    .where(eq(schema.participants.characterId, character.id))
    .orderBy(schema.actionLog.createdAt);
  const seenAction = new Map<string, number>();
  for (const r of logRows) {
    seenAction.set(r.actionId, r.createdAt.getTime());
  }
  const recentActionIds = [...seenAction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([id]) => id);

  // Background options for the retroactive picker affordance on the sheet
  // (creation form deliberately doesn't ask for these; user picks here).
  const backgroundRows = await db
    .select({
      slug: schema.content.slug,
      name: schema.content.name,
      source: schema.content.source,
      data: schema.content.data,
      ownerUserId: schema.content.ownerUserId
    })
    .from(schema.content)
    .where(and(eq(schema.content.kind, 'background'), pickerOwnerFilter()));

  const backgroundOptions = backgroundRows
    .map((r) => {
      const d = JSON.parse(r.data as string) as { abilityChoices?: string[] };
      return {
        slug: r.slug,
        name: r.name,
        source: r.source,
        abilityChoices: d.abilityChoices ?? [],
        pickerId: pickerId(r.slug, r.ownerUserId),
        ...homebrewBadge(r.ownerUserId)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    campaign,
    user: locals.user,
    role: membership.role,
    character: {
      id: character.id,
      name: character.name,
      updatedAt: character.updatedAt.getTime()
    },
    document,
    derived: derived ? serializeDerived(derived) : null,
    // Ship the content lookup to the client so derive() can re-run there
    // on every Y.Doc update (M2.3). ~200 KB; revisit when scale matters.
    contentMap,
    itemOptions,
    spellOptions,
    subclassOptions,
    backgroundOptions,
    featOptions,
    liveEncounter,
    recentActionIds
  };
};
