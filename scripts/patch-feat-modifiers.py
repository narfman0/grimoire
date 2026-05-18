#!/usr/bin/env python3
"""Patch existing feat files with modifiers, triggers, and activities from 5etools and known mechanics."""

import json
import re
import urllib.request
from pathlib import Path

PACKS_DIR = Path("/home/narfman0/.openclaw/workspace/grimoire-packs")

SOURCE_TO_PACK = {
    "PHB": "phb-2014",
    "XPHB": "phb-2024",
    "XGE": "xanathars",
    "TCE": "tashas",
    "FRHoF": "frhof",
    "EFA": "efa",
    "ABH": "abh",
    "BGG": "bigby",
    "DSotDQ": "dsotdq",
    "SatO": "sato",
    "FTD": "fizbans",
    "BMT": "bmt",
    "MTF": "mtof",
    "SCC": "scc",
    "ERLW": "erlw",
    "LFL": "lfl",
    "PSK": "psk",
    "PSX": "psx",
    "GGR": "ggr",
    "SCAG": "scag",
    "BGDIA": "bgdia",
    "EGW": "wildemount",
}

KNOWN_MECHANICS = {
    # --- PHB 2014 ---
    "alert": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "initiative", "mode": "ADD", "value": 5},
            {"kind": "stat-modifier", "target": "flag.no-surprise", "mode": "OVERRIDE", "value": True},
        ]
    },
    "athlete": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "speed.climb", "mode": "MAX", "value": "walkSpeed"},
            {"kind": "stat-modifier", "target": "speed.jump", "mode": "ADD", "value": 0},
        ]
    },
    "charger": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.charger", "mode": "OVERRIDE", "value": True}
        ]
    },
    "dual-wielder": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "ac.bonus", "mode": "ADD", "value": 1},
            {"kind": "stat-modifier", "target": "proficiency.armor.shield", "mode": "OVERRIDE", "value": False},
            {"kind": "stat-modifier", "target": "flag.dual-wielder", "mode": "OVERRIDE", "value": True},
        ]
    },
    "dungeon-delver": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.dungeon-delver", "mode": "OVERRIDE", "value": True}
        ]
    },
    "durable": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.durable-hd-min", "mode": "OVERRIDE", "value": True}
        ]
    },
    "grappler": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.grappler", "mode": "OVERRIDE", "value": True}
        ]
    },
    "great-weapon-master": {
        "modifiers": [
            {
                "kind": "action-modifier",
                "id": "gwm-bonus-attack",
                "name": "Great Weapon Master — bonus attack on crit/kill",
                "appliesTo": {"activityType": "attack", "predicates": [{"attack.range": "melee"}]},
                "effects": [
                    {"target": "flag.gwm-bonus-action-attack", "mode": "OVERRIDE", "value": True}
                ],
            }
        ],
        "triggers": [
            {
                "kind": "trigger",
                "id": "gwm-power-attack",
                "name": "GWM Power Attack (-5/+10)",
                "on": ["attack.declare"],
                "scope": {"predicates": [{"attack.range": "melee"}, {"weapon.heavy": True}]},
                "grants": {"type": "toggle", "id": "gwm-power-attack-toggle"},
                "toggleEffect": {"attackBonus": -5, "damageBonus": 10},
            }
        ],
    },
    "heavily-armored": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.armor.heavy", "mode": "OVERRIDE", "value": True}
        ]
    },
    "heavy-armor-master": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.ham-damage-reduction", "mode": "OVERRIDE", "value": True}
        ]
    },
    "inspiring-leader": {
        "activities": [
            {
                "id": "inspiring-leader-speech",
                "type": "utility",
                "name": "Inspiring Leader",
                "cost": "10-minutes",
                "uses": {"max": "charisma-mod", "per": "short-rest"},
            }
        ]
    },
    "keen-mind": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.keen-mind", "mode": "OVERRIDE", "value": True}
        ]
    },
    "lucky": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "lucky",
                "name": "Lucky",
                "on": ["attack.declare", "save.declare", "check.declare", "attack.against.declare"],
                "grants": {"type": "force-reroll"},
                "limit": {"per": "long-rest", "uses": 3},
            }
        ]
    },
    "mage-slayer": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "mage-slayer-reaction",
                "name": "Mage Slayer — reaction attack",
                "on": ["spell.cast.within-5ft"],
                "grants": {"type": "opportunity-attack"},
                "limit": {"per": "turn", "uses": 1},
            }
        ]
    },
    "mobile": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "speed.walk", "mode": "ADD", "value": 10},
            {"kind": "stat-modifier", "target": "flag.mobile-no-opp-attack", "mode": "OVERRIDE", "value": True},
        ]
    },
    "moderately-armored": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.armor.medium", "mode": "OVERRIDE", "value": True},
            {"kind": "stat-modifier", "target": "proficiency.armor.shield", "mode": "OVERRIDE", "value": True},
        ]
    },
    "mounted-combatant": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.mounted-combatant", "mode": "OVERRIDE", "value": True}
        ]
    },
    "observant": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "skill.passive-perception", "mode": "ADD", "value": 5},
            {"kind": "stat-modifier", "target": "skill.passive-investigation", "mode": "ADD", "value": 5},
        ]
    },
    "polearm-master": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "polearm-master-reaction",
                "name": "Polearm Master — opportunity attack on entry",
                "on": ["creature.enters.reach"],
                "grants": {"type": "opportunity-attack"},
            }
        ]
    },
    "savage-attacker": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.savage-attacker", "mode": "OVERRIDE", "value": True}
        ]
    },
    "sentinel": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "sentinel-reaction",
                "name": "Sentinel — reaction attack on disengage",
                "on": ["creature.disengage"],
                "grants": {"type": "opportunity-attack"},
            }
        ],
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.sentinel-zero-speed", "mode": "OVERRIDE", "value": True}
        ],
    },
    "sharpshooter": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "sharpshooter-power-attack",
                "name": "Sharpshooter Power Attack (-5/+10)",
                "on": ["attack.declare"],
                "scope": {"predicates": [{"attack.range": "ranged"}, {"weapon.ranged": True}]},
                "grants": {"type": "toggle", "id": "sharpshooter-power-attack-toggle"},
                "toggleEffect": {"attackBonus": -5, "damageBonus": 10},
            }
        ]
    },
    "skulker": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.skulker", "mode": "OVERRIDE", "value": True}
        ]
    },
    "tavern-brawler": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.weapon.improvised", "mode": "OVERRIDE", "value": True}
        ]
    },
    "tough": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "hp.bonus-per-level", "mode": "ADD", "value": 2}
        ]
    },
    "war-caster": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.war-caster-concentration-adv", "mode": "OVERRIDE", "value": True},
            {"kind": "stat-modifier", "target": "flag.war-caster-somatic-hands", "mode": "OVERRIDE", "value": True},
        ]
    },
    "weapon-master": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.weapon.martial", "mode": "OVERRIDE", "value": True}
        ]
    },
    # --- XGE ---
    "bountiful-luck": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "bountiful-luck",
                "name": "Bountiful Luck — share luck with ally",
                "on": ["ally.rolls.1"],
                "grants": {"type": "force-reroll"},
            }
        ]
    },
    "dragon-fear": {
        "activities": [
            {
                "id": "dragon-fear-frightful",
                "type": "utility",
                "name": "Dragon Fear",
                "cost": "action",
                "uses": {"max": 1, "per": "short-rest"},
            }
        ]
    },
    "elven-accuracy": {
        "modifiers": []  # already has ASI choice; no flat modifiers
    },
    "orcish-fury": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "orcish-fury-extra-die",
                "name": "Orcish Fury — extra weapon damage die",
                "on": ["attack.hit"],
                "limit": {"per": "short-rest", "uses": 1},
            }
        ]
    },
    "second-chance": {
        "triggers": [
            {
                "kind": "trigger",
                "id": "second-chance",
                "name": "Second Chance — force reroll",
                "on": ["attack.against.declare"],
                "grants": {"type": "force-reroll"},
                "limit": {"per": "short-rest", "uses": 1},
            }
        ]
    },
    "squat-nimbleness": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "speed.walk", "mode": "ADD", "value": 5}
        ]
    },
    # --- TCE ---
    "artificer-initiate": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.tool.artisan", "mode": "OVERRIDE", "value": True}
        ]
    },
    "chef": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.tool.cook-s-utensils", "mode": "OVERRIDE", "value": True}
        ]
    },
    "crusher": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.crusher", "mode": "OVERRIDE", "value": True}
        ]
    },
    "eldritch-adept": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.eldritch-adept", "mode": "OVERRIDE", "value": True}
        ]
    },
    "fey-touched": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.fey-touched", "mode": "OVERRIDE", "value": True}
        ]
    },
    "fighting-initiate": {
        "modifiers": []
    },
    "gunner": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.weapon.firearms", "mode": "OVERRIDE", "value": True},
            {"kind": "stat-modifier", "target": "flag.gunner-no-disadvantage", "mode": "OVERRIDE", "value": True},
        ]
    },
    "metamagic-adept": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "resource.sorcery-points", "mode": "ADD", "value": 2}
        ]
    },
    "piercer": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.piercer", "mode": "OVERRIDE", "value": True}
        ]
    },
    "poisoner": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "proficiency.tool.poisoner-s-kit", "mode": "OVERRIDE", "value": True},
            {"kind": "stat-modifier", "target": "flag.poisoner", "mode": "OVERRIDE", "value": True},
        ]
    },
    "shadow-touched": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.shadow-touched", "mode": "OVERRIDE", "value": True}
        ]
    },
    "skill-expert": {
        "modifiers": []  # handled by choices
    },
    "slasher": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.slasher", "mode": "OVERRIDE", "value": True}
        ]
    },
    "telekinetic": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "flag.telekinetic", "mode": "OVERRIDE", "value": True}
        ]
    },
    "telepathic": {
        "modifiers": [
            {"kind": "stat-modifier", "target": "sense.telepathy", "mode": "MAX", "value": 60}
        ]
    },
}

ARMOR_MAP = {"light": "light", "medium": "medium", "heavy": "heavy", "shield": "shield"}


def slugify(s):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def fetch_json(url):
    print(f"Fetching {url} ...")
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_structured_modifiers(ft):
    """Extract modifiers from 5etools structured fields."""
    mods = []

    # resist -> damage resistances
    resist_list = ft.get("resist", [])
    for dmg_type in resist_list:
        if isinstance(dmg_type, str):
            mods.append(
                {"kind": "stat-modifier", "target": f"resistance.{dmg_type}", "mode": "OVERRIDE", "value": True}
            )

    # immune -> damage immunities
    immune_list = ft.get("immune", [])
    for dmg_type in immune_list:
        if isinstance(dmg_type, str):
            mods.append(
                {"kind": "stat-modifier", "target": f"immunity.{dmg_type}", "mode": "OVERRIDE", "value": True}
            )

    # conditionImmune -> condition immunities
    cond_immune_list = ft.get("conditionImmune", [])
    for cond in cond_immune_list:
        if isinstance(cond, str):
            mods.append(
                {
                    "kind": "stat-modifier",
                    "target": f"immunity.condition.{cond}",
                    "mode": "OVERRIDE",
                    "value": True,
                }
            )

    # senses and bonusSenses -> sense modifiers
    for sense_key in ("senses", "bonusSenses"):
        senses_list = ft.get(sense_key, [])
        for sense_entry in senses_list:
            if not isinstance(sense_entry, dict):
                continue
            for sense_name, value in sense_entry.items():
                if isinstance(value, (int, float)):
                    mods.append(
                        {"kind": "stat-modifier", "target": f"sense.{sense_name}", "mode": "MAX", "value": value}
                    )

    # armorProficiencies -> proficiency modifiers
    for entry in ft.get("armorProficiencies", []):
        for k, v in entry.items():
            if v is True and k in ARMOR_MAP:
                mods.append(
                    {
                        "kind": "stat-modifier",
                        "target": f"proficiency.armor.{k}",
                        "mode": "OVERRIDE",
                        "value": True,
                    }
                )

    # weaponProficiencies -> proficiency modifiers
    for entry in ft.get("weaponProficiencies", []):
        for k, v in entry.items():
            if v is True:
                mods.append(
                    {
                        "kind": "stat-modifier",
                        "target": f"proficiency.weapon.{k}",
                        "mode": "OVERRIDE",
                        "value": True,
                    }
                )

    return mods


def merge_mechanics(data, slug, structured_mods):
    """
    Merge structured modifiers and known mechanics into the feat data dict.
    Returns True if anything was changed.
    """
    changed = False

    # Start with whatever's already there
    existing_mods = data.get("modifiers", [])
    existing_triggers = data.get("triggers", [])
    existing_activities = data.get("activities", [])

    new_mods = list(existing_mods)
    new_triggers = list(existing_triggers)
    new_activities = list(existing_activities)

    # Apply structured modifiers if feat currently has empty modifiers
    if not existing_mods and structured_mods:
        new_mods = structured_mods

    # Apply known mechanics
    known = KNOWN_MECHANICS.get(slug, {})

    # Modifiers: always merge known mechanics additively (don't overwrite hand-coded data,
    # but do supplement existing modifiers with known mechanics that aren't already present).
    # Only skip if existing_mods already contains non-ASI / non-structured modifiers from
    # a previous run of this script (identified by flag.* or non-ability targets).
    if "modifiers" in known:
        km = known["modifiers"]
        combined = list(new_mods)  # already has structured (may include ASI from choices script)
        # Collect existing targets to avoid duplicates
        existing_targets = {m.get("target") for m in combined if isinstance(m, dict)}
        existing_ids = {m.get("id") for m in combined if isinstance(m, dict) and m.get("id")}
        for mod in km:
            if not isinstance(mod, dict):
                continue
            if mod.get("kind") == "action-modifier":
                # action-modifiers keyed by id
                if mod.get("id") not in existing_ids:
                    combined.append(mod)
            elif mod.get("target") not in existing_targets:
                combined.append(mod)
                existing_targets.add(mod.get("target"))
        new_mods = combined

    # Triggers: add known triggers that aren't already present (by id)
    if "triggers" in known:
        existing_trigger_ids = {t.get("id") for t in existing_triggers if isinstance(t, dict)}
        combined_triggers = list(existing_triggers)
        for trig in known["triggers"]:
            if isinstance(trig, dict) and trig.get("id") not in existing_trigger_ids:
                combined_triggers.append(trig)
        new_triggers = combined_triggers

    # Activities: add known activities that aren't already present (by id)
    if "activities" in known:
        existing_activity_ids = {a.get("id") for a in existing_activities if isinstance(a, dict)}
        combined_activities = list(existing_activities)
        for act in known["activities"]:
            if isinstance(act, dict) and act.get("id") not in existing_activity_ids:
                combined_activities.append(act)
        new_activities = combined_activities

    # Write back
    if new_mods != existing_mods:
        data["modifiers"] = new_mods
        changed = True
    if new_triggers != existing_triggers:
        data["triggers"] = new_triggers
        changed = True
    if new_activities != existing_activities:
        data["activities"] = new_activities
        changed = True

    return changed


def patch_feat_obj(feat_obj, ft_raw):
    """Extract structured modifiers and merge known mechanics. Returns (feat_obj, changed)."""
    slug = feat_obj.get("slug", "")
    data = feat_obj.get("data", {})

    structured_mods = extract_structured_modifiers(ft_raw) if ft_raw else []
    changed = merge_mechanics(data, slug, structured_mods)

    feat_obj["data"] = data
    return feat_obj, changed


def build_lookup(feats_list):
    """Build a lookup (slug, pack) -> feat object from 5etools data."""
    lookup = {}
    for ft in feats_list:
        name = ft.get("name", "")
        source = ft.get("source", "")
        pack = SOURCE_TO_PACK.get(source)
        if not pack:
            continue
        key = (slugify(name), pack)
        lookup[key] = ft
    return lookup


def process_feats_file(feats_file, lookup, pack):
    """Process a feats.json array file. Returns (updated_count, skipped_count)."""
    with open(feats_file) as f:
        data = json.load(f)

    if not isinstance(data, list):
        return 0, 0

    updated = 0
    skipped = 0

    for i, item in enumerate(data):
        if item.get("kind") != "feat":
            continue
        slug = item.get("slug", "")
        key = (slug, pack)
        ft_raw = lookup.get(key)
        # ft_raw may be None if no 5etools entry (still apply known mechanics)
        item, changed = patch_feat_obj(item, ft_raw)
        data[i] = item
        if changed:
            updated += 1
        else:
            skipped += 1

    with open(feats_file, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    return updated, skipped


def process_feats_dir(feats_dir, lookup, pack):
    """Process a feats/ directory of individual JSON files. Returns (updated_count, skipped_count)."""
    updated = 0
    skipped = 0

    for json_file in sorted(feats_dir.glob("*.json")):
        with open(json_file) as f:
            item = json.load(f)

        if item.get("kind") != "feat":
            continue

        slug = item.get("slug", json_file.stem)
        key = (slug, pack)
        ft_raw = lookup.get(key)
        item, changed = patch_feat_obj(item, ft_raw)

        with open(json_file, "w") as f:
            json.dump(item, f, indent=2)
            f.write("\n")

        if changed:
            updated += 1
        else:
            skipped += 1

    return updated, skipped


def main():
    feats_raw = fetch_json(
        "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/feats.json"
    )
    feats_list = (
        feats_raw.get("feat", feats_raw) if isinstance(feats_raw, dict) else feats_raw
    )
    print(f"Loaded {len(feats_list)} feats from 5etools\n")

    lookup = build_lookup(feats_list)
    print(f"Built lookup with {len(lookup)} entries\n")

    # Collect all packs that have feat data
    packs_with_feats = []
    for pack_dir in sorted(PACKS_DIR.iterdir()):
        if not pack_dir.is_dir():
            continue
        pack = pack_dir.name
        feats_file = pack_dir / "feats.json"
        feats_dir = pack_dir / "feats"
        if feats_file.is_file() or feats_dir.is_dir():
            packs_with_feats.append(pack)

    total_updated = 0
    total_skipped = 0

    for pack in packs_with_feats:
        pack_dir = PACKS_DIR / pack
        feats_file = pack_dir / "feats.json"
        feats_dir = pack_dir / "feats"

        pack_updated = 0
        pack_skipped = 0

        if feats_dir.is_dir():
            u, s = process_feats_dir(feats_dir, lookup, pack)
            pack_updated += u
            pack_skipped += s

        if feats_file.is_file():
            u, s = process_feats_file(feats_file, lookup, pack)
            pack_updated += u
            pack_skipped += s

        total_updated += pack_updated
        total_skipped += pack_skipped

        print(f"  [{pack}] updated={pack_updated}, unchanged={pack_skipped}")

    print(f"\nTotal: {total_updated} feats populated, {total_skipped} unchanged")


if __name__ == "__main__":
    main()
