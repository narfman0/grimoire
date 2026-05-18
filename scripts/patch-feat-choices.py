#!/usr/bin/env python3
"""Patch existing feat rows with choices schema derived from 5etools structured data."""

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
    "AI": "ai",
    "GoS": "gos",
    "PSA": "psa",
    "WBtW": "wbtw",
    "ToA": "toa",
    "AAG": "aag",
    "VRGR": "vrgr",
    "MOT": "mot",
    "PSI": "psi",
    "XDMG": "dmg-2024",
}


def slugify(s):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def fetch_json(url):
    print(f"Fetching {url} ...")
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode("utf-8"))


def derive_choices(ft):
    choices = {}

    # ASI
    ability = ft.get("ability", [])
    for ab in ability:
        if ab.get("hidden"):
            continue
        choose = ab.get("choose")
        if choose:
            bonus = choose.get("amount", 1)
            frm = choose.get("from", [])
            if frm and len(frm) < 6:
                choices["asi"] = {"bonus": bonus, "allowedAbilities": frm}
            else:
                choices["asi"] = {"bonus": bonus}
        else:
            # Fixed abilities
            fixed = {
                k: v
                for k, v in ab.items()
                if k not in ("hidden", "choose") and isinstance(v, int)
            }
            if fixed:
                keys = list(fixed.keys())
                bonus = list(fixed.values())[0]
                choices["asi"] = {"bonus": bonus, "allowedAbilities": keys}
        break  # take first non-hidden entry

    # Skill proficiencies
    skill_profs = ft.get("skillProficiencies", [])
    for sp in skill_profs:
        choose = sp.get("choose")
        if choose:
            frm = choose.get("from", [])
            choices["skillProficiency"] = {"allowedSkills": frm} if frm else {}
        elif sp.get("any") or sp.get("anyStandard"):
            count = sp.get("any") or sp.get("anyStandard") or 1
            choices["skillProficiency"] = {} if count == 1 else {"picks": count}
        else:
            fixed_skills = [
                k
                for k, v in sp.items()
                if v is True and k not in ("choose", "any", "anyStandard")
            ]
            if fixed_skills:
                choices["skillProficiency"] = {"allowedSkills": fixed_skills}
        break

    # Languages
    lang_profs = ft.get("languageProficiencies", [])
    for lp in lang_profs:
        count = lp.get("anyStandard") or lp.get("any") or 0
        fixed_langs = [
            k
            for k, v in lp.items()
            if v is True and k not in ("anyStandard", "any", "choose")
        ]
        if count > 1:
            choices["language"] = {"picks": count}
        elif count == 1:
            choices["language"] = {}
        elif fixed_langs:
            choices["language"] = {"allowedLanguages": fixed_langs}
        break

    # Tool proficiencies
    tool_profs = ft.get("toolProficiencies", [])
    for tp in tool_profs:
        choose = tp.get("choose")
        if choose:
            choices["toolProficiency"] = {}
        else:
            fixed_tools = [
                slugify(k) for k, v in tp.items() if v is True and k != "choose"
            ]
            if fixed_tools:
                choices["toolProficiency"] = {"allowedTools": fixed_tools}
        break

    # Expertise
    if ft.get("expertise"):
        choices["expertise"] = {"allowedSkills": "proficient"}

    # Additional spells (simplified)
    add_spells = ft.get("additionalSpells", [])
    if add_spells:
        all_spell_slugs = []
        for entry in add_spells:
            for timing_key in ("innate", "known", "prepared"):
                timing = entry.get(timing_key, {})
                for group in timing.values():
                    if isinstance(group, list):
                        for s in group:
                            if isinstance(s, str) and not s.startswith("{@"):
                                all_spell_slugs.append(slugify(s))
                    elif isinstance(group, dict):
                        for rest_type in group.values():
                            if isinstance(rest_type, list):
                                for s in rest_type:
                                    if isinstance(s, str) and not s.startswith("{@"):
                                        all_spell_slugs.append(slugify(s))
        if all_spell_slugs:
            choices["spell"] = {
                "allowedSpells": list(dict.fromkeys(all_spell_slugs))
            }

    return choices


CATEGORY_MAP = {
    "G": "General",
    "O": "Origin",
    "EB": "Epic Boon",
    "FS": "Fighting Style",
    "FS:P": "Fighting Style (Paladin)",
    "FS:R": "Fighting Style (Ranger)",
    "D": "General",  # Dragon/special, treat as General
}


def get_category(ft):
    cat = ft.get("category")
    if cat:
        return CATEGORY_MAP.get(cat, cat)
    return "General"


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


def patch_feat_obj(feat_obj, ft_raw):
    """Patch a feat object with choices and category from 5etools data."""
    choices = derive_choices(ft_raw)
    category = get_category(ft_raw)

    data = feat_obj.get("data", {})
    # Always set category
    data["category"] = category
    # Only set choices if non-empty
    if choices:
        data["choices"] = choices
    elif "choices" in data:
        # Remove empty choices key if it was there before and is now empty
        del data["choices"]
    feat_obj["data"] = data
    return feat_obj


def process_feats_file(feats_file, lookup, pack):
    """Process a feats.json array file. Returns (updated_count, no_match_count, no_match_slugs)."""
    with open(feats_file) as f:
        data = json.load(f)

    if not isinstance(data, list):
        return 0, 0, []

    updated = 0
    no_match = 0
    no_match_slugs = []

    for i, item in enumerate(data):
        if item.get("kind") != "feat":
            continue
        slug = item.get("slug", "")
        key = (slug, pack)
        ft_raw = lookup.get(key)
        if ft_raw is None:
            no_match += 1
            no_match_slugs.append(slug)
            continue
        data[i] = patch_feat_obj(item, ft_raw)
        updated += 1

    with open(feats_file, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    return updated, no_match, no_match_slugs


def process_feats_dir(feats_dir, lookup, pack):
    """Process a feats/ directory of individual JSON files. Returns (updated_count, no_match_count, no_match_slugs)."""
    updated = 0
    no_match = 0
    no_match_slugs = []

    for json_file in sorted(feats_dir.glob("*.json")):
        with open(json_file) as f:
            item = json.load(f)

        if item.get("kind") != "feat":
            continue

        slug = item.get("slug", json_file.stem)
        key = (slug, pack)
        ft_raw = lookup.get(key)
        if ft_raw is None:
            no_match += 1
            no_match_slugs.append(slug)
            continue

        item = patch_feat_obj(item, ft_raw)
        with open(json_file, "w") as f:
            json.dump(item, f, indent=2)
            f.write("\n")
        updated += 1

    return updated, no_match, no_match_slugs


def main():
    feats_raw = fetch_json(
        "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/feats.json"
    )
    feats_list = (
        feats_raw.get("feat", feats_raw)
        if isinstance(feats_raw, dict)
        else feats_raw
    )
    print(f"Loaded {len(feats_list)} feats from 5etools\n")

    lookup = build_lookup(feats_list)
    print(f"Built lookup with {len(lookup)} entries\n")

    # Collect all packs that have feat data
    packs_with_feats = set()
    for pack_dir in PACKS_DIR.iterdir():
        if not pack_dir.is_dir():
            continue
        pack = pack_dir.name
        feats_file = pack_dir / "feats.json"
        feats_dir = pack_dir / "feats"
        if feats_file.is_file() or feats_dir.is_dir():
            packs_with_feats.add(pack)

    total_updated = 0
    total_no_match = 0

    for pack in sorted(packs_with_feats):
        pack_dir = PACKS_DIR / pack
        feats_file = pack_dir / "feats.json"
        feats_dir = pack_dir / "feats"

        pack_updated = 0
        pack_no_match = 0
        pack_no_match_slugs = []

        if feats_dir.is_dir():
            u, nm, nms = process_feats_dir(feats_dir, lookup, pack)
            pack_updated += u
            pack_no_match += nm
            pack_no_match_slugs.extend(nms)

        if feats_file.is_file():
            u, nm, nms = process_feats_file(feats_file, lookup, pack)
            pack_updated += u
            pack_no_match += nm
            pack_no_match_slugs.extend(nms)

        if pack_updated == 0 and pack_no_match == 0:
            continue

        total_updated += pack_updated
        total_no_match += pack_no_match

        status = f"  [{pack}] updated={pack_updated}, no-match={pack_no_match}"
        if pack_no_match_slugs:
            status += f"  (unmatched: {', '.join(pack_no_match_slugs[:5])}{'...' if len(pack_no_match_slugs) > 5 else ''})"
        print(status)

    print(f"\nTotal: {total_updated} feats updated, {total_no_match} had no 5etools match")


if __name__ == "__main__":
    main()
