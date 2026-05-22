# SRD 5.2 Mechanical Support Matrix

Generated: 2026-05-21 | Last full audit: 2026-05-21

## Summary

| Status | Count |
|--------|-------|
| ✅ Full | 151 |
| ⚠️ Partial | 87 |
| ❌ Missing | 0 |
| 🚫 Out of Scope | 12 |

**Status legend:**
- ✅ Full — correct as-is
- ⚠️ Partial — implemented but wrong value, missing a tier, or a known workaround
- ❌ Missing — feature referenced but no implementation
- 🚫 Out of Scope — engine limitation (DSL target not yet supported)

---

## Classes

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| class | barbarian | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d12 HD, STR/CON saves, all proficiencies and skill list correct | 2026-05-21 |
| class | barbarian | Feature: rage (L1) | ✅ Full | Resistance modifiers, rage-damage action-modifier, enter-rage activity with per-level uses table | 2026-05-21 |
| class | barbarian | Feature: unarmored-defense-barbarian (L1) | ✅ Full | ac.formula OVERRIDE 10+DEX+CON requires no-armor | 2026-05-21 |
| class | barbarian | Feature: weapon-mastery (L1) | ⚠️ Partial | Feature entry exists; mastery effects (Cleave/Push/etc.) are unsupported engine targets — choice flag only | 2026-05-21 |
| class | barbarian | Feature: danger-sense (L2) | ⚠️ Partial | save.advantage.dex OVERRIDE vs-seen-effects — evaluator reads the target but condition qualifier not enforced | 2026-05-21 |
| class | barbarian | Feature: reckless-attack (L2) | ✅ Full | action-modifier toggle granting attack.advantage + attacker.grants-advantage-against | 2026-05-21 |
| class | barbarian | Feature: primal-path (L3) | ✅ Full | Feature entry exists with subclass choice slot | 2026-05-21 |
| class | barbarian | Feature: primal-knowledge (L3+L10) | ✅ Full | Two feature rows (primal-knowledge + primal-knowledge-l10); both use data.choices.skillProficiency so engine synthesizes proficiency.skill.{chosen}; L10 entry added to class features list | 2026-05-21 |
| class | barbarian | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature in features/shared.json; class references the slug | 2026-05-21 |
| class | barbarian | Feature: extra-attack (L5) | ✅ Full | Shared feature, attacks-per-action UPGRADE 2 | 2026-05-21 |
| class | barbarian | Feature: fast-movement (L5) | ✅ Full | speed.walk ADD 10 with no-heavy-armor condition | 2026-05-21 |
| class | barbarian | Feature: feral-instinct (L7) | 🚫 Out of Scope | initiative.advantage not a supported evaluator target; both effects surfaced as trait tags | 2026-05-21 |
| class | barbarian | Feature: brutal-strike (L9) | 🚫 Out of Scope | Forced movement, speed reduction, and per-hit extra-die rider are all out of scope; trait tag + annotated activity only | 2026-05-21 |
| class | barbarian | Feature: relentless-rage (L11) | ⚠️ Partial | Trigger on self.reduced-to-0hp fires a free CON save; escalating DC not auto-tracked (manual note in feature) | 2026-05-21 |
| class | bard | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, DEX/CHA saves, light armor, simple weapons, 3 musical instruments, pick 3 from all skills | 2026-05-21 |
| class | bard | Feature: bardic-inspiration (L1) | ✅ Full | Resource activity correct (PB/long-rest); die-size surfaced via damageRolls type=inspiration with perClass bard table (d6→d8→d10→d12 by level) | 2026-05-21 |
| class | bard | Feature: spellcasting-bard (L1) | ✅ Full | spellcasting.ability OVERRIDE cha | 2026-05-21 |
| class | bard | Feature: expertise-bard-2 (L2) | ⚠️ Partial | Choice slot surfaced; derive.ts hard-codes expertise=false — doubled-PB not yet applied | 2026-05-21 |
| class | bard | Feature: jack-of-all-trades (L2) | 🚫 Out of Scope | Half-proficiency on non-proficient checks not a supported stat-modifier target; trait tag only | 2026-05-21 |
| class | bard | Feature: bard-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | bard | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | bard | Feature: font-of-inspiration (L5) | ⚠️ Partial | Activity surfaced as short-rest resource; UI should hide L1 long-rest version when L5 is active (not auto-wired) | 2026-05-21 |
| class | cleric | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, WIS/CHA saves, light/medium armor + shield, simple weapons, pick 2 from list | 2026-05-21 |
| class | cleric | Feature: spellcasting-cleric (L1) | ✅ Full | spellcasting.ability OVERRIDE wis | 2026-05-21 |
| class | cleric | Feature: divine-order (L1) | ⚠️ Partial | Choice slot present; Warden armor/weapon proficiency modifiers wired; Magician cantrip + skill bonus deferred (trait flag) | 2026-05-21 |
| class | cleric | Feature: channel-divinity (L2) | ⚠️ Partial | Activity surfaced with static max=2; scaling (2→3→4) not auto-computed by engine | 2026-05-21 |
| class | cleric | Feature: turn-undead (L2) | ✅ Full | Save activity (WIS vs spell DC) at 30 ft | 2026-05-21 |
| class | cleric | Feature: cleric-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | cleric | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | cleric | Feature: sear-undead (L5) | 🚫 Out of Scope | Dynamic dice count = WIS modifier; engine damage schema accepts only static dice strings — trait tag + annotated damage activity | 2026-05-21 |
| class | druid | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, INT/WIS saves, light armor + shield, simple weapons, herbalism kit, pick 2 from list; metal-armor restriction correctly removed per 2024 | 2026-05-21 |
| class | druid | Feature: druidic (L1) | ✅ Full | proficiency.language.druidic OVERRIDE true | 2026-05-21 |
| class | druid | Feature: spellcasting-druid (L1) | ✅ Full | spellcasting.ability OVERRIDE wis | 2026-05-21 |
| class | druid | Feature: primal-order (L1) | ⚠️ Partial | Warden armor/weapon proficiency modifiers gated on choice; Magician cantrip + WIS-mod-to-skills deferred (trait tag) | 2026-05-21 |
| class | druid | Feature: wild-companion (L2) | ⚠️ Partial | Resource + utility activity; Find Familiar summoning effect not simulated | 2026-05-21 |
| class | druid | Feature: wild-shape (L2) | 🚫 Out of Scope | Full statblock replacement out of scope for v0; resource + utility activity only | 2026-05-21 |
| class | druid | Feature: druid-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | druid | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | druid | Feature: wild-resurgence (L5) | ⚠️ Partial | Leg B (1/long-rest Wild Shape → level-1 slot) surfaced; leg A (per-turn, spell-slot-funded Wild Shape refund) not expressible in activity DSL | 2026-05-21 |
| class | fighter | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d10 HD, STR/CON saves, all armor + shield, simple/martial weapons, pick 2 from list | 2026-05-21 |
| class | fighter | Feature: fighting-style-fighter (L1) | ⚠️ Partial | Choice slot present; individual styles implemented — some use unsupported targets (GWF: damage.reroll-1s-and-2s, TWF: off-hand split, Protection/Interception: trigger DSL) | 2026-05-21 |
| class | fighter | Feature: second-wind (L2) | ✅ Full | Heal activity with per-level uses table and 1d10+fighterLevel damage part | 2026-05-21 |
| class | fighter | Feature: weapon-mastery-fighter (L1) | ⚠️ Partial | Pick-3 choice flag; per-level scaling and mastery property effects unsupported | 2026-05-21 |
| class | fighter | Feature: action-surge (L2) | ✅ Full | Utility activity with per-level uses table (1/short-rest, 2 at L17) | 2026-05-21 |
| class | fighter | Feature: tactical-mind (L2) | ✅ Full | Utility activity, PB uses/long-rest, add 1d10 on failed check (refund if still fails — noted in activity) | 2026-05-21 |
| class | fighter | Feature: fighter-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | fighter | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | fighter | Feature: extra-attack (L5) | ✅ Full | Shared feature, attacks-per-action UPGRADE 2 | 2026-05-21 |
| class | fighter | Feature: extra-attack-2 (L11) | ✅ Full | attacks-per-action UPGRADE 3 | 2026-05-21 |
| class | fighter | Feature: extra-attack-3 (L20) | ✅ Full | attacks-per-action UPGRADE 4 | 2026-05-21 |
| class | monk | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, STR/DEX saves, no armor, simple + martial-light-finesse weapons, one artisan or musical tool, pick 2 from list | 2026-05-21 |
| class | monk | Feature: martial-arts (L1) | ✅ Full | DEX action-modifier + bonus unarmed strike; die field uses perClass monk table (1d6→1d8→1d10→1d12), evaluated by new engine support for object-shaped dice in attack activities; Flurry of Blows updated too | 2026-05-21 |
| class | monk | Feature: unarmored-defense-monk (L1) | ✅ Full | ac.formula OVERRIDE 10+DEX+WIS requires no-armor-no-shield | 2026-05-21 |
| class | monk | Feature: monks-focus (L1) | ⚠️ Partial | Focus points pool with per-level table surfaced; auto-deduction on spend not wired | 2026-05-21 |
| class | monk | Feature: step-of-the-wind (L2) | ⚠️ Partial | Bonus-action utility activity; focus-point deduction not automatic | 2026-05-21 |
| class | monk | Feature: patient-defense (L2) | ⚠️ Partial | Bonus-action utility activity; focus-point cost for Dodge+Disengage variant not auto-deducted | 2026-05-21 |
| class | monk | Feature: flurry-of-blows (L2) | ⚠️ Partial | Bonus-action attack activity (models one of two strikes); focus-point deduction not automatic; L10 third strike not modelled | 2026-05-21 |
| class | monk | Feature: unarmored-movement (L2) | ✅ Full | speed.walk ADD with per-level table, gated on no-armor-no-shield | 2026-05-21 |
| class | monk | Feature: monk-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | monk | Feature: deflect-attacks (L3) | ✅ Full | Trigger on self.hit-by-attack, reaction activity reducing damage 1d10+DEX+monk-level; note documents focus-point redirect option | 2026-05-21 |
| class | monk | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | monk | Feature: extra-attack (L5) | ✅ Full | Shared feature | 2026-05-21 |
| class | monk | Feature: stunning-strike (L5) | ⚠️ Partial | Action-modifier toggle with on-hit.target.save effect; focus-point deduction and once-per-turn cap not enforced | 2026-05-21 |
| class | paladin | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d10 HD, WIS/CHA saves, all armor + shield, simple/martial weapons, pick 2 from list | 2026-05-21 |
| class | paladin | Feature: spellcasting-paladin (L1) | ⚠️ Partial | spellcasting.ability OVERRIDE cha; half-caster slot table not yet implemented (engine uses full-caster progression) | 2026-05-21 |
| class | paladin | Feature: lay-on-hands (L1) | ✅ Full | Bonus-action heal activity with 5×paladinLevel pool per-level table | 2026-05-21 |
| class | paladin | Feature: weapon-mastery-paladin (L1) | ⚠️ Partial | Pick-2 choice flag; mastery property effects unsupported | 2026-05-21 |
| class | paladin | Feature: fighting-style-paladin (L2) | ⚠️ Partial | Choice slot; Blessed Warrior cantrip grant deferred; other styles share fighter implementations with same limitations | 2026-05-21 |
| class | paladin | Feature: divine-smite (L2) | ⚠️ Partial | Action-modifier toggle; slot consumption not auto-deducted; divineSmiteSlotDice magic identifier not yet resolved by evaluator; Undead/Fiend bonus not auto-applied | 2026-05-21 |
| class | paladin | Feature: channel-oath (L2) | ✅ Full | Utility activity with per-level uses table (2 at L2, 3 at L9) / short-rest | 2026-05-21 |
| class | paladin | Feature: paladin-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | paladin | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | paladin | Feature: extra-attack (L5) | ✅ Full | Shared feature | 2026-05-21 |
| class | paladin | Feature: faithful-steed (L5) | ✅ Full | 1/long-rest cast activity for Find Steed | 2026-05-21 |
| class | ranger | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d10 HD, STR/DEX saves, light/medium armor + shield, simple/martial weapons, pick 3 from list | 2026-05-21 |
| class | ranger | Feature: spellcasting-ranger (L1) | ⚠️ Partial | spellcasting.ability OVERRIDE wis; half-caster slot table not yet implemented | 2026-05-21 |
| class | ranger | Feature: favored-enemy (L1) | ⚠️ Partial | Resource pool for slotless Hunter's Mark casts surfaced; auto-prepared spell and slotless-cast plumbing not wired | 2026-05-21 |
| class | ranger | Feature: weapon-mastery-ranger (L1) | ⚠️ Partial | Pick-2 choice flag; mastery property effects unsupported | 2026-05-21 |
| class | ranger | Feature: deft-explorer (L2) | ⚠️ Partial | Expertise choice + difficult-terrain-bypass trait tag; doubled-PB and terrain bypass not evaluated | 2026-05-21 |
| class | ranger | Feature: fighting-style-ranger (L2) | ⚠️ Partial | Choice slot; Druidic Warrior cantrip grant deferred; other styles share fighter implementations | 2026-05-21 |
| class | ranger | Feature: ranger-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | ranger | Feature: roving (L3) | ⚠️ Partial | Walk +10 and climb/swim UPGRADE to 40 ft; walkSpeed magic identifier unsupported so climb/swim hard-coded to 40 rather than matching post-bonus walk speed | 2026-05-21 |
| class | ranger | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | ranger | Feature: extra-attack-ranger (L5) | ✅ Full | attacks-per-action UPGRADE 2, ranger-specific feature entry | 2026-05-21 |
| class | rogue | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, DEX/INT saves, light armor, simple + martial-finesse-or-light, thieves' tools, pick 4 from list | 2026-05-21 |
| class | rogue | Feature: expertise-rogue (L1) | ⚠️ Partial | Pick-2 expertise choice surfaced; derive.ts hard-codes expertise=false — doubled-PB not applied | 2026-05-21 |
| class | rogue | Feature: sneak-attack (L1) | ⚠️ Partial | Action-modifier with per-level dice table correct; once-per-turn cap and advantage/ally-adjacency gating not enforced by engine | 2026-05-21 |
| class | rogue | Feature: thieves-cant (L1) | ✅ Full | proficiency.language.thieves-cant OVERRIDE true | 2026-05-21 |
| class | rogue | Feature: weapon-mastery-rogue (L1) | ⚠️ Partial | Pick-2 choice flag; mastery property effects unsupported | 2026-05-21 |
| class | rogue | Feature: cunning-action (L2) | ✅ Full | Bonus-action utility activity (Dash/Disengage/Hide) | 2026-05-21 |
| class | rogue | Feature: rogue-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | rogue | Feature: steady-aim (L3) | ⚠️ Partial | Bonus-action utility activity surfaced; advantage-on-next-attack and speed=0 not evaluator targets | 2026-05-21 |
| class | rogue | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | rogue | Feature: cunning-strike (L5) | ⚠️ Partial | Four action-modifier toggles (Disarm/Poison/Trip/Withdraw) surfaced; dice-spend accounting and imposed saves/conditions not simulated | 2026-05-21 |
| class | rogue | Feature: uncanny-dodge (L5) | ⚠️ Partial | Trigger on self.hit-by-attack with reaction; damage halving (damage.halve-incoming) not yet a first-class evaluator target | 2026-05-21 |
| class | sorcerer | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d6 HD, CON/CHA saves, no armor, simple weapons, pick 2 from list | 2026-05-21 |
| class | sorcerer | Feature: spellcasting-sorcerer (L1) | ✅ Full | spellcasting.ability OVERRIDE cha | 2026-05-21 |
| class | sorcerer | Feature: innate-sorcery (L1) | ⚠️ Partial | 2/long-rest bonus-action activity; spell DC +1 applied; duration-gated advantage on spell attacks tagged but not evaluated | 2026-05-21 |
| class | sorcerer | Feature: sorcerous-origin (L1) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | sorcerer | Feature: font-of-magic (L2) | ⚠️ Partial | Sorcery points pool with per-level table surfaced; Flexible Casting conversions not wired | 2026-05-21 |
| class | sorcerer | Feature: metamagic (L2) | ⚠️ Partial | Pick-2 choice + all 10 metamagic action-modifier toggles surfaced; sorcery-point costs and spell-modification effects (extra target, ignore resistance, etc.) not simulated | 2026-05-21 |
| class | sorcerer | Feature: sorcerer-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | sorcerer | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | sorcerer | Feature: sorcerous-restoration (L5) | ⚠️ Partial | 1/long-rest utility activity on short-rest trigger; half-sorcerer-level cap and pool interaction not plumbed | 2026-05-21 |
| class | warlock | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d8 HD, WIS/CHA saves, light armor, simple weapons, pick 2 from list | 2026-05-21 |
| class | warlock | Feature: pact-magic (L1) | ✅ Full | spellcasting.ability OVERRIDE cha; pact slot table now handled by pactCasterSlots() in derive.ts (upstream); class uses progression:'pact' | 2026-05-21 |
| class | warlock | Feature: eldritch-invocations (L1) | ✅ Full | Choice slot + 4 SRD invocations; agonizing-blast now uses chaMod (resolves correctly); per-level pick count scaling declared | 2026-05-21 |
| class | warlock | Feature: pact-boon (L1) | ⚠️ Partial | Choice slot present (Blade/Chain/Tome/Talisman); mechanical effects of each boon deferred to future batch | 2026-05-21 |
| class | warlock | Feature: magical-cunning (L2) | ⚠️ Partial | 1/long-rest ritual activity surfaced; slot-refresh effect descriptive only (pact slots not yet emitted) | 2026-05-21 |
| class | warlock | Feature: warlock-subclass (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | warlock | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | wizard | Hit Die / Saves / Proficiencies / Skill Choices | ✅ Full | d6 HD, INT/WIS saves, no armor, simple weapons, pick 2 from list | 2026-05-21 |
| class | wizard | Feature: spellcasting-wizard (L1) | ✅ Full | spellcasting.ability OVERRIDE int; spellbook=true | 2026-05-21 |
| class | wizard | Feature: ritual-adept (L1) | ✅ Full | spellcasting.ritual-without-prep OVERRIDE true | 2026-05-21 |
| class | wizard | Feature: arcane-recovery (L1) | ⚠️ Partial | 1/long-rest utility activity on short-rest trigger; slot-level budget (half wizard level rounded up) not enforced | 2026-05-21 |
| class | wizard | Feature: scholar (L2) | ⚠️ Partial | Feature entry exists with expertise choice slot; doubled-PB not applied by derive.ts | 2026-05-21 |
| class | wizard | Feature: arcane-tradition (L3) | ✅ Full | Subclass choice slot present | 2026-05-21 |
| class | wizard | Feature: ability-score-improvement (L4) | ✅ Full | Shared feature | 2026-05-21 |
| class | wizard | Feature: memorize-spell (L5) | ✅ Full | trait.memorize-spell flag; UI handles the spell-swap on long rest | 2026-05-21 |
| class | wizard | Feature: spell-mastery (L18) | ⚠️ Partial | Two-slot choice + trait flag; free-cast slot suppression per specific prepared spell not yet engine-supported | 2026-05-21 |
| class | wizard | Feature: signature-spells (L20) | ⚠️ Partial | Pick-2 choice + two 1/short-rest activities; slot suppression for specific prepared spells not yet engine-supported | 2026-05-21 |

---

## Subclasses

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| subclass | path-of-the-berserker | Parent Class (barbarian) / Feature List | ✅ Full | parentClass=barbarian, features=[frenzy, mindless-rage, intimidating-presence, retaliation] | 2026-05-21 |
| subclass | path-of-the-berserker | Feature: frenzy (L3) | ⚠️ Partial | action-modifier tag surfaced; discrete bonus-action Frenzied Strike not synthesized; push/prone rider out of scope | 2026-05-21 |
| subclass | path-of-the-berserker | Feature: mindless-rage (L3) | ✅ Full | immunity.charmed and immunity.frightened OVERRIDE true gated on rage condition | 2026-05-21 |
| subclass | college-of-lore | Parent Class (bard) / Feature List | ✅ Full | parentClass=bard, features=[bonus-proficiencies-lore, cutting-words, magical-secrets-lore, peerless-skill] | 2026-05-21 |
| subclass | college-of-lore | Feature: bonus-proficiencies-lore (L3) | ⚠️ Partial | Pick-3 skill choice slot surfaced; chosen skills not yet auto-applied as proficiency.skill modifiers | 2026-05-21 |
| subclass | college-of-lore | Feature: cutting-words (L3) | ⚠️ Partial | Trigger on enemy attack/check/damage within 60 ft; reaction activity surfaced; Bardic Inspiration die spend not auto-deducted | 2026-05-21 |
| subclass | college-of-lore | Feature: magical-secrets-lore (L6) | ⚠️ Partial | Pick-2 any-class-list spell choice; chosen spells not yet injected into bard.spells.known | 2026-05-21 |
| subclass | life-domain | Parent Class (cleric) / Feature List | ✅ Full | parentClass=cleric, features=[life-domain-spells, life-domain-heavy-armor, disciple-of-life, preserve-life, blessed-healer, supreme-healing] | 2026-05-21 |
| subclass | life-domain | Feature: life-domain-spells (L3) | ⚠️ Partial | trait.domain-spells.life flag; auto-prep injection into character.spells.prepared not wired | 2026-05-21 |
| subclass | life-domain | Feature: life-domain-heavy-armor (L3) | ✅ Full | proficiency.armor.heavy OVERRIDE true | 2026-05-21 |
| subclass | life-domain | Feature: disciple-of-life (L3) | ⚠️ Partial | action-modifier on heal activities; heal.bonus ADD spellLevelPlus2 tagged — spellLevelPlus2 magic identifier not evaluated | 2026-05-21 |
| subclass | life-domain | Feature: preserve-life (L3) | 🚫 Out of Scope | Pool = 5×clericLevel; fiveTimesClericLevel is not a supported magic identifier — trait tag + annotated heal activity | 2026-05-21 |
| subclass | life-domain | Feature: blessed-healer (L6) | 🚫 Out of Scope | self.heal-on-heal-other is not a supported evaluator target — tagged action-modifier only | 2026-05-21 |
| subclass | circle-of-the-land | Parent Class (druid) / Feature List | ✅ Full | parentClass=druid, features=[circle-of-the-land-spells, lands-aid, natural-recovery, natures-ward, natures-sanctuary] | 2026-05-21 |
| subclass | circle-of-the-land | Feature: circle-of-the-land-spells (L3) | ⚠️ Partial | Land-choice slot + trait flag; auto-prep injection not wired | 2026-05-21 |
| subclass | circle-of-the-land | Feature: lands-aid (L3) | ⚠️ Partial | Save activity with 2d6 necrotic + 2d6 healing at base; damage/heal scaling (L10/L14/L17) not modelled | 2026-05-21 |
| subclass | circle-of-the-land | Feature: natural-recovery (L6) | ⚠️ Partial | 1/long-rest utility on short-rest trigger; slot-recovery accounting left to player | 2026-05-21 |
| subclass | champion | Parent Class (fighter) / Feature List | ✅ Full | parentClass=fighter, features=[improved-critical, remarkable-athlete, additional-fighting-style, superior-critical] | 2026-05-21 |
| subclass | champion | Feature: improved-critical (L3) | ✅ Full | attack.crit-threshold DOWNGRADE 19 | 2026-05-21 |
| subclass | champion | Feature: remarkable-athlete (L3) | ✅ Full | initiative ADD strMod; climb/swim UPGRADE walkSpeed — walkSpeed now resolves via evaluateValue (engine updated); running jump STR-mod bonus is out of scope | 2026-05-21 |
| subclass | way-of-the-open-hand | Parent Class (monk) / Feature List | ✅ Full | parentClass=monk, features=[open-hand-technique, wholeness-of-body, tranquility, quivering-palm] | 2026-05-21 |
| subclass | way-of-the-open-hand | Feature: open-hand-technique (L3) | ⚠️ Partial | action-modifier tag on Flurry of Blows attacks; three effect options and their saves/conditions left to play | 2026-05-21 |
| subclass | way-of-the-open-hand | Feature: wholeness-of-body (L6) | ⚠️ Partial | Bonus-action heal activity 2d8+wisMod; uses.max=focusPoints is a DSL approximation — actual cost is 3 focus points | 2026-05-21 |
| subclass | oath-of-devotion | Parent Class (paladin) / Feature List | ✅ Full | parentClass=paladin, features=[devotion-spells, channel-divinity-sacred-weapon, channel-divinity-holy-rebuke, aura-of-devotion] | 2026-05-21 |
| subclass | oath-of-devotion | Feature: devotion-spells (L3) | ⚠️ Partial | trait.oath-spells.devotion flag; auto-prep injection not wired | 2026-05-21 |
| subclass | oath-of-devotion | Feature: channel-divinity-sacred-weapon (L3) | ✅ Full | Bonus-action utility activity + action-modifier adding chaMod to attack.bonus.melee; chaMod now resolves via evaluateValue (engine updated) | 2026-05-21 |
| subclass | oath-of-devotion | Feature: channel-divinity-holy-rebuke (L3) | ✅ Full | Reaction save activity (CON vs spell DC, 2d8+paladinLevel radiant) | 2026-05-21 |
| subclass | oath-of-devotion | Feature: aura-of-devotion (L6) | ⚠️ Partial | immunity.charmed OVERRIDE true for self; aura.charmed-immunity.radius=10 tagged; ally proximity logic not in engine | 2026-05-21 |
| subclass | hunter | Parent Class (ranger) / Feature List | ✅ Full | parentClass=ranger, features=[hunters-lore, hunters-prey, defensive-tactics, hunter-multiattack, superior-hunters-defense] | 2026-05-21 |
| subclass | hunter | Feature: hunters-lore (L3) | ✅ Full | Bonus-action utility at 120 ft; DM reveals immunity/resistance/vulnerability | 2026-05-21 |
| subclass | hunter | Feature: hunters-prey (L3) | ⚠️ Partial | Pick-1 choice; Colossus Slayer action-modifier + Horde Breaker/Giant Killer triggers implemented; only chosen option should be active (not engine-enforced) | 2026-05-21 |
| subclass | thief | Parent Class (rogue) / Feature List | ✅ Full | parentClass=rogue, features=[fast-hands, second-story-work, supreme-sneak, use-magic-device, thiefs-reflexes] | 2026-05-21 |
| subclass | thief | Feature: fast-hands (L3) | ✅ Full | trait.fast-hands flag extending Cunning Action bonus action to Utilize/Sleight-of-Hand/Thieves' Tools | 2026-05-21 |
| subclass | thief | Feature: second-story-work (L3) | ✅ Full | speed.climb UPGRADE walkSpeed — walkSpeed now resolves via evaluateValue; jump-distance DEX bonus is out of scope | 2026-05-21 |
| subclass | draconic-sorcery | Parent Class (sorcerer) / Feature List | ✅ Full | parentClass=sorcerer, features=[draconic-resilience, dragon-ancestry, elemental-affinity, dragon-wings, draconic-presence] | 2026-05-21 |
| subclass | draconic-sorcery | Feature: draconic-resilience (L3) | ✅ Full | hp.max ADD sorcererLevel + ac.formula OVERRIDE 13+DEX requires no-armor | 2026-05-21 |
| subclass | draconic-sorcery | Feature: dragon-ancestry (L3) | ✅ Full | Pick-1 dragon-type choice + proficiency.language.draconic OVERRIDE true | 2026-05-21 |
| subclass | draconic-sorcery | Feature: elemental-affinity (L6) | ⚠️ Partial | Action-modifier for chaMod bonus (now resolves); trait tag for resistance; dynamic ancestry-type predicate (damage.type.matches-dragon-ancestry) not evaluable by engine | 2026-05-21 |
| subclass | fiend-patron | Parent Class (warlock) / Feature List | ✅ Full | parentClass=warlock, features=[fiend-spells, dark-ones-blessing, dark-ones-own-luck, fiendish-resilience, hurl-through-hell] | 2026-05-21 |
| subclass | fiend-patron | Feature: fiend-spells (L3) | ⚠️ Partial | trait.patron-spells.fiend flag; auto-prep injection not wired | 2026-05-21 |
| subclass | fiend-patron | Feature: dark-ones-blessing (L3) | ⚠️ Partial | Trigger on enemy-reduce-to-zero within 30 ft; temp HP grant amount "warlockLevelPlusChaMod" not a resolved magic identifier | 2026-05-21 |
| subclass | fiend-patron | Feature: dark-ones-own-luck (L6) | ✅ Full | Trigger on own ability check/save; free activity adds 1d10 to roll; 1/short-rest limit | 2026-05-21 |
| subclass | evocation | Parent Class (wizard) / Feature List | ✅ Full | parentClass=wizard, features=[evocation-savant, sculpt-spells, potent-cantrip, empowered-evocation, overchannel] | 2026-05-21 |
| subclass | evocation | Feature: evocation-savant (L3) | ⚠️ Partial | Pick-2 wizard-evocation spell choice surfaced; per-level free-copy not auto-tracked | 2026-05-21 |
| subclass | evocation | Feature: sculpt-spells (L3) | ⚠️ Partial | Action-modifier tag on evocation casts; ally auto-success logic left to play | 2026-05-21 |
| subclass | evocation | Feature: potent-cantrip (L6) | ⚠️ Partial | Action-modifier tag on cantrip casts; half-on-save semantics not enforced by evaluator | 2026-05-21 |

---

## Feats

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| feat | alert | Full Feat Implementation | ✅ Full | initiative ADD proficiencyBonus + initiative-swap utility activity | 2026-05-21 |
| feat | lucky | Full Feat Implementation | ✅ Full | Two PB/long-rest activities (Advantage and Disadvantage variants); shared pool split modelled as separate resources | 2026-05-21 |
| feat | magic-initiate-wizard | Full Feat Implementation | ✅ Full | 1/long-rest level-1 spell cast activity; two cantrips noted; -cleric and -druid variants also present in feats.json | 2026-05-21 |
| feat | savage-attacker | Full Feat Implementation | 🚫 Out of Scope | damage.reroll-and-keep-higher not a supported evaluator target — tagged action-modifier only | 2026-05-21 |
| feat | skilled | Full Feat Implementation | ✅ Full | Pick-3 skill/tool choice; proficiencies applied from character document | 2026-05-21 |
| feat | tough | Full Feat Implementation | ⚠️ Partial | Two hp.max ADD totalLevel modifiers (= +2/level); brittle workaround since evaluator lacks arithmetic on magic identifiers | 2026-05-21 |
| feat | great-weapon-master | Full Feat Implementation | ✅ Full | Heavy-weapon-mastery action-modifier (PB damage bonus) + Hew trigger (bonus-action attack on crit/kill) + STR+1 | 2026-05-21 |
| feat | sharpshooter | Full Feat Implementation | 🚫 Out of Scope | Cover-bypass and range/melee-proximity disadvantage-removal targets not supported by evaluator; DEX+1 applies; tagged modifiers only | 2026-05-21 |
| feat | polearm-master | Full Feat Implementation | ✅ Full | Pole Strike bonus-action attack (1d4) + Reactive Strike reaction trigger; no-limit Hew note correct per 2024 | 2026-05-21 |
| feat | sentinel | Full Feat Implementation | ⚠️ Partial | Guardian trigger (reaction OA on Disengage/ally-hit) correct; Halt effect (on-hit.target.speed=0) not a supported evaluator target — tagged modifier | 2026-05-21 |
| feat | war-caster | Full Feat Implementation | 🚫 Out of Scope | save.advantage.concentration and spellcasting.somatic-with-occupied-hands not supported by evaluator; Reactive Spell trigger surfaced; tagged modifiers only | 2026-05-21 |
| feat | resilient | Full Feat Implementation | ✅ Full | +1 to chosen ability + save proficiency in chosen ability; emitted per character choice | 2026-05-21 |
| feat | crafter | Full Feat Implementation | 🚫 Out of Scope | shopping.nonmagical-discount not a supported evaluator target; three tool choices surfaced; tagged modifier only | 2026-05-21 |
| feat | healer | Full Feat Implementation | ⚠️ Partial | Stabilize + Mend activities surfaced; per-creature short-rest gating on Mend not trackable by engine | 2026-05-21 |
| feat | musician | Full Feat Implementation | ⚠️ Partial | Three musical instrument choices; Encouraging Song activity surfaced; Heroic Inspiration grant not tracked by engine | 2026-05-21 |
| feat | tavern-brawler | Full Feat Implementation | ⚠️ Partial | Unarmed 1d4 override + improvised-weapon proficiency + Push trigger; free damage-die reroll not modelled | 2026-05-21 |
| feat | ability-score-improvement | Full Feat Implementation | ✅ Full | Budget-2 ASI with ability choices; engine synthesizes ADD modifiers from character.feats[].choices.asis | 2026-05-21 |
| feat | charger | Full Feat Implementation | ⚠️ Partial | Trigger on Dash action with 10-ft straight move; bonus-action attack or shove surfaced; choice between +1d8 damage and push left to player | 2026-05-21 |
| feat | dual-wielder | Full Feat Implementation | ⚠️ Partial | +1 AC while dual-wielding and Quick Draw trigger surfaced; one-handed (non-Light) allowance not enforced by evaluator | 2026-05-21 |
| feat | elemental-adept | Full Feat Implementation | 🚫 Out of Scope | damage.ignore-resistance and damage.die.min not supported by evaluator — tagged action-modifier only | 2026-05-21 |
| feat | mobile | Full Feat Implementation | ⚠️ Partial | speed.walk ADD 10 correct; movement.dash-difficult-terrain-no-extra-cost not a supported evaluator target — tagged; Mobile Evade trigger surfaced | 2026-05-21 |
| feat | defensive-duelist | Full Feat Implementation | ✅ Full | Parry trigger (reaction: add PB to AC on melee hit while wielding finesse) + DEX+1 | 2026-05-21 |

---

## Species

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| species | orc | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, darkvision 120, powerful-build trait, features=[adrenaline-rush, relentless-endurance, powerful-build-orc] | 2026-05-21 |
| species | orc | Feature: adrenaline-rush | ✅ Full | Bonus-action Dash + temp HP equal to PB; PB uses/short-rest | 2026-05-21 |
| species | orc | Feature: relentless-endurance | ✅ Full | Trigger on damage-reduce-to-zero: set HP to 1; 1/long-rest | 2026-05-21 |
| species | human | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, Common + 1 language; features=[resourceful, skillful, versatile] | 2026-05-21 |
| species | human | Feature: resourceful | ✅ Full | Trigger on long-rest end grants Heroic Inspiration; trait flag | 2026-05-21 |
| species | human | Feature: skillful | ✅ Full | trait.skillful-skill-choice flag; proficiency applied from character document | 2026-05-21 |
| species | human | Feature: versatile | ✅ Full | trait.versatile-origin-feat-choice flag; extra Origin feat applied from character document | 2026-05-21 |
| species | dwarf | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, darkvision 60, Common+Dwarvish; features=[dwarven-resilience, dwarven-toughness, stonecunning, dwarven-tool-proficiency] | 2026-05-21 |
| species | dwarf | Feature: dwarven-toughness | ✅ Full | hp.max ADD totalLevel | 2026-05-21 |
| species | dwarf | Feature: stonecunning | ✅ Full | Bonus-action Tremorsense 60 ft (10 min, PB/long-rest); trait flag | 2026-05-21 |
| species | dragonborn | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, Common+Draconic, no darkvision; features=[draconic-ancestry, breath-weapon, damage-resistance-draconic, draconic-flight] | 2026-05-21 |
| species | dragonborn | Feature: draconic-ancestry | ✅ Full | Pick-1 dragon-type choice; trait.draconic-ancestry-chosen flag | 2026-05-21 |
| species | dragonborn | Feature: breath-weapon | ⚠️ Partial | DC now calc:custom base=8 bonus=[conMod,proficiencyBonus] (engine updated to support this); damage still hardcoded 1d10 — level-scaling (1d10→2d10→3d10→4d10) requires evaluated dice strings in save activities (Group B) | 2026-05-21 |
| species | dragonborn | Feature: damage-resistance-draconic | ⚠️ Partial | trait.draconic-damage-resistance flag; dynamic resistance type (from ancestry choice) not applied — engine limitation | 2026-05-21 |
| species | dragonborn | Feature: draconic-flight (L5) | ⚠️ Partial | 1/long-rest bonus-action utility activity granting fly at walk speed; walkSpeed identifier not supported — fly value is "walk" (symbolic, engine must resolve) | 2026-05-21 |
| species | elf | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, darkvision 60, Common+Elvish; fey-ancestry + trance modifiers on species row; features=[fey-ancestry, keen-senses, trance, elven-lineage] | 2026-05-21 |
| species | elf | Feature: fey-ancestry | ✅ Full | save.advantage.charmed OVERRIDE true | 2026-05-21 |
| species | elf | Feature: keen-senses | ⚠️ Partial | trait.keen-senses-skill-choice flag; chosen proficiency applied from character document; proficiency.skill not auto-wired | 2026-05-21 |
| species | elf | Feature: trance | ⚠️ Partial | trait.trance flag; rest-time halving and bonus proficiency on trance require engine support | 2026-05-21 |
| species | elf | Feature: elven-lineage | ⚠️ Partial | trait.elven-lineage-chosen flag; lineage-specific speed/spells/cantrips deferred until choice system lands | 2026-05-21 |
| species | gnome | Size / Speed / Feature List | ✅ Full | Small, 30 ft walk, darkvision 60, Common+Gnomish; INT/WIS/CHA save advantage vs magic on species row; features=[gnomish-cunning, gnomish-lineage] | 2026-05-21 |
| species | gnome | Feature: gnomish-cunning | ✅ Full | save.advantage.int/wis/cha OVERRIDE "magic" (vs spells and magical effects) | 2026-05-21 |
| species | gnome | Feature: gnomish-lineage | ⚠️ Partial | trait.gnomish-lineage-chosen flag; Forest/Rock lineage cantrips and tool proficiencies deferred | 2026-05-21 |
| species | goliath | Size / Speed / Feature List | ✅ Full | Medium, 35 ft walk, Common+Giant, powerful-build + large-form traits on species row; features=[giant-ancestry, large-form, powerful-build-goliath] | 2026-05-21 |
| species | goliath | Feature: giant-ancestry | ✅ Full | Feature-pick choice (choices.feature); 6 sub-features authored: Cloud (30ft teleport utility), Fire (1d10 fire damage activity), Frost (damage.reduce trigger 1d12+strMod), Hill (knock-prone trigger, descriptive), Stone (damage.reduce trigger 1d12+conMod), Storm (push trigger, descriptive). Trigger uses scales with PB via evaluateValue. Hill/Storm forced-save mechanics marked Out of Scope. | 2026-05-21 |
| species | goliath | Feature: large-form (L5) | ✅ Full | 1/long-rest bonus-action activity; grants STR-check advantage + walk+10; duration 10 min | 2026-05-21 |
| species | goliath | Feature: powerful-build-goliath | ✅ Full | trait.powerful-build OVERRIDE true | 2026-05-21 |
| species | halfling | Size / Speed / Feature List | ✅ Full | Small, 30 ft walk, Common; frightened save advantage on species row; features=[brave, halfling-nimbleness, luck] | 2026-05-21 |
| species | halfling | Feature: brave | ✅ Full | save.advantage.frightened OVERRIDE true | 2026-05-21 |
| species | halfling | Feature: halfling-nimbleness | ✅ Full | trait.halfling-nimbleness flag (move through larger creature's space) | 2026-05-21 |
| species | halfling | Feature: luck | ✅ Full | Trigger on d20.roll-natural-one: reroll and must use new roll; unlimited uses | 2026-05-21 |
| species | halfling | Feature: naturally-stealthy | ✅ Full | Correctly absent — this was a 2014 feature removed in SRD 5.2; halfling features[] does not include this slug | 2026-05-21 |
| species | tiefling | Size / Speed / Feature List | ✅ Full | Medium, 30 ft walk, darkvision 60, Common+Infernal; fiendish-legacy trait on species row; features=[fiendish-legacy, otherworldly-presence] | 2026-05-21 |
| species | tiefling | Feature: fiendish-legacy | ⚠️ Partial | Pick-1 legacy choice (Abyssal/Chthonic/Infernal) + L3/L5 spell activities; specific resistance and full spell list per legacy deferred | 2026-05-21 |
| species | tiefling | Feature: otherworldly-presence | ⚠️ Partial | trait.otherworldly-presence flag; Thaumaturgy cantrip grant and per-legacy casting ability deferred | 2026-05-21 |

---

## Backgrounds

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| background | acolyte | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | INT/WIS/CHA ability choices; Insight + Religion proficiencies wired; 2 languages; originFeat=magic-initiate-cleric (feat exists in feats.json) | 2026-05-21 |
| background | soldier | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | STR/DEX/CON ability choices; Athletics + Intimidation proficiencies; gaming-set tool; originFeat=savage-attacker | 2026-05-21 |
| background | criminal | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | DEX/CON/INT ability choices; Sleight-of-Hand + Stealth; thieves-tools; originFeat=alert | 2026-05-21 |
| background | sage | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | CON/INT/WIS ability choices; Arcana + History; calligraphers-supplies; 2 languages; originFeat=magic-initiate-wizard | 2026-05-21 |
| background | charlatan | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | DEX/CON/CHA ability choices; Deception + Sleight-of-Hand; forgery-kit; originFeat=skilled | 2026-05-21 |
| background | entertainer | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | STR/DEX/CHA ability choices; Acrobatics + Performance; musical-instrument; originFeat=musician | 2026-05-21 |
| background | folk-hero | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | STR/CON/WIS ability choices; Animal-Handling + Survival; artisans-tools; originFeat=healer | 2026-05-21 |
| background | guide | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | DEX/CON/WIS ability choices; Stealth + Survival; cartographers-tools; originFeat=magic-initiate-druid (feat exists in feats.json) | 2026-05-21 |
| background | hermit | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | CON/WIS/CHA ability choices; Medicine + Religion; herbalism-kit; 1 language; originFeat=magic-initiate-druid | 2026-05-21 |
| background | noble | Ability Choices / Skill Proficiencies / Tool Proficiencies / Origin Feat | ✅ Full | STR/INT/CHA ability choices; History + Persuasion; gaming-set; 1 language; originFeat=skilled | 2026-05-21 |

---

## Conditions

| Kind | Slug | Mechanic | Status | Notes | Audited |
|------|------|----------|--------|-------|---------|
| condition | blinded | Mechanical Effects (modifiers) | ✅ Full | vision.cannot-see, ability-check auto-fail sight, attack.disadvantage, attacked.advantage | 2026-05-21 |
| condition | charmed | Mechanical Effects (modifiers) | ⚠️ Partial | attack.cannot-target-source tagged; charmer social-check advantage tagged — both are non-standard targets not yet evaluated | 2026-05-21 |
| condition | deafened | Mechanical Effects (modifiers) | ✅ Full | hearing.cannot-hear + ability-check auto-fail hearing-required | 2026-05-21 |
| condition | exhaustion | Mechanical Effects (modifiers) | ⚠️ Partial | Per-level −2 to all D20 Tests and −5 to all speeds via perConditionStack; speed floor at 0 and death-at-10 must be engine-enforced | 2026-05-21 |
| condition | frightened | Mechanical Effects (modifiers) | ⚠️ Partial | Disadvantage on checks and attacks while source in sight tagged; movement restriction (cannot-approach-source) is a spatial constraint not enforced by engine | 2026-05-21 |
| condition | grappled | Mechanical Effects (modifiers) | ✅ Full | All speeds OVERRIDE 0; 2024 version correctly omits attack-roll disadvantage | 2026-05-21 |
| condition | incapacitated | Mechanical Effects (modifiers) | ✅ Full | action.disabled, reaction.disabled, concentration.broken, speech.cannot-speak, initiative.disadvantage | 2026-05-21 |
| condition | invisible | Mechanical Effects (modifiers) | ✅ Full | concealed OVERRIDE true, attack.advantage, attacked.disadvantage | 2026-05-21 |
| condition | paralyzed | Mechanical Effects (modifiers) | ⚠️ Partial | Implies incapacitated, all speeds 0, STR/DEX auto-fail, attacked.advantage; auto-crit-within-5ft (tag) requires evaluator support | 2026-05-21 |
| condition | petrified | Mechanical Effects (modifiers) | ⚠️ Partial | Implies incapacitated, all speeds 0, STR/DEX auto-fail, attacked.advantage, resistance.all, immunity.poison/disease; weight/aging tags informational | 2026-05-21 |
| condition | poisoned | Mechanical Effects (modifiers) | ✅ Full | attack.disadvantage + ability-check.disadvantage | 2026-05-21 |
| condition | prone | Mechanical Effects (modifiers) | ✅ Full | crawl-only movement, attack.disadvantage, attacked-by-melee.advantage, attacked-by-ranged.disadvantage | 2026-05-21 |
| condition | rage | Mechanical Effects (modifiers) | ✅ Full | Condition row exists as self-applied marker; modifiers live on the rage feature | 2026-05-21 |
| condition | restrained | Mechanical Effects (modifiers) | ✅ Full | All speeds OVERRIDE 0, attack.disadvantage, attacked.advantage, save.disadvantage.dex | 2026-05-21 |
| condition | stunned | Mechanical Effects (modifiers) | ⚠️ Partial | Implies incapacitated, all speeds 0, STR/DEX auto-fail, attacked.advantage; speech note correct | 2026-05-21 |
| condition | unconscious | Mechanical Effects (modifiers) | ⚠️ Partial | Implies incapacitated+prone, all speeds 0, STR/DEX auto-fail, attacked.advantage; auto-crit-within-5ft (tag) requires evaluator support | 2026-05-21 |

---

## Cross-Reference: Missing Feature Entries

The following slugs appear in a `features[]` array of a class, subclass, or species but have **no matching entry** in any `features/*.json` file. Audit agents should treat these as primary investigation targets.

| Class / Species | Missing Slug | Level | Source Array |
|-----------------|-------------|-------|--------------|
| halfling | `naturally-stealthy` | — | species.json matrix row only — slug does not appear in halfling features[] either; row should be removed or the feature authored |

**Note on feats summary:** `feats.json` contains entries for all 22 matrix feat rows plus `magic-initiate-cleric`, `magic-initiate-druid`, and various epic-boon and fighting-style feats. The `magic-initiate-cleric` and `magic-initiate-druid` slugs referenced in `backgrounds.json` (originFeat fields for `acolyte`, `guide`, `hermit`) both have matching feat entries in `feats.json` — no missing-feat issue. The `ability-score-improvement` feat row tracks the standalone feat distinct from the class ASI feature.
