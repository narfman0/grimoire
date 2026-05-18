#!/usr/bin/env python3
"""Import feats and backgrounds from 5etools into grimoire-packs content system."""

import json
import os
import re
import urllib.request
from pathlib import Path

# Source → pack directory mapping
SOURCE_MAP = {
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

PACKS_DIR = Path("/home/narfman0/.openclaw/workspace/grimoire-packs")


def slugify(name):
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


def strip_tags(text):
    if not isinstance(text, str):
        return str(text)
    text = re.sub(r"\{@damage ([^}]+)\}", r"\1", text)
    text = re.sub(r"\{@hit (-?\d+)\}", r"+\1", text)
    text = re.sub(r"\{@dc (\d+)\}", r"DC \1", text)
    text = re.sub(r"\{@h\}", "Hit: ", text)
    text = re.sub(r"\{@\w+ ([^|}]+)(?:\|[^}]*)?\}", r"\1", text)
    return text.strip()


def flatten_entries(entries):
    if isinstance(entries, str):
        return strip_tags(entries)
    if isinstance(entries, list):
        parts = []
        for e in entries:
            parts.append(flatten_entries(e))
        return " ".join(p for p in parts if p)
    if isinstance(entries, dict):
        if "entries" in entries:
            return flatten_entries(entries["entries"])
        if "items" in entries:
            return flatten_entries(entries["items"])
        if "entry" in entries:
            return flatten_entries(entries["entry"])
        return ""
    return str(entries)


def parse_prerequisite(prereq_list):
    if not prereq_list:
        return None
    parts = []
    for prereq in prereq_list:
        if "level" in prereq:
            lvl = prereq["level"]
            if isinstance(lvl, dict):
                n = lvl.get("level", lvl.get("value", "?"))
            else:
                n = lvl
            suffix = {1: "st", 2: "nd", 3: "rd"}.get(n, "th")
            parts.append(f"{n}{suffix} level")
        if "ability" in prereq:
            ab = prereq["ability"]
            if isinstance(ab, list):
                ab = ab[0] if ab else {}
            ab_parts = []
            for stat, val in ab.items():
                if stat == "choose":
                    continue
                ab_parts.append(f"{stat.upper()} {val}")
            if ab_parts:
                parts.append(", ".join(ab_parts))
        if "race" in prereq:
            race_list = prereq["race"]
            if isinstance(race_list, list):
                race_names = []
                for r in race_list:
                    rname = r.get("name", "")
                    rsubrace = r.get("subrace", "")
                    if rsubrace:
                        race_names.append(f"{rname} ({rsubrace})")
                    else:
                        race_names.append(rname)
                parts.append(" or ".join(race_names))
            elif isinstance(race_list, dict):
                parts.append(race_list.get("name", ""))
        if "spellcasting" in prereq:
            parts.append("Spellcasting")
        if "spellcastingFeature" in prereq:
            parts.append("Spellcasting Feature")
        if "proficiency" in prereq:
            prof_list = prereq["proficiency"]
            for pf in prof_list:
                for ptype, pval in pf.items():
                    parts.append(f"{pval.title()} {ptype} proficiency")
        if "feat" in prereq:
            feat_list = prereq["feat"]
            feat_names = []
            for f in feat_list:
                # Format: "feat-name|source"
                feat_names.append(f.split("|")[0].replace("-", " ").title())
            parts.append(", ".join(feat_names))
        if "other" in prereq:
            parts.append(prereq["other"])
        if "background" in prereq:
            bg_list = prereq["background"]
            bg_names = [b.get("name", "") for b in bg_list]
            parts.append(" or ".join(bg_names))
        if "psionics" in prereq:
            parts.append("Psionics")
        if "campaign" in prereq:
            parts.append(f"Campaign: {prereq['campaign']}")
    result = ", ".join(p for p in parts if p)
    return result if result else None


def parse_modifiers(ability_field):
    if not ability_field:
        return []
    if isinstance(ability_field, list):
        ability_field = ability_field[0] if ability_field else {}
    if not isinstance(ability_field, dict):
        return []
    # If there's a "choose" key, it's a flexible ASI - return empty
    if "choose" in ability_field:
        return []
    modifiers = []
    stat_map = {
        "str": "ability.str",
        "dex": "ability.dex",
        "con": "ability.con",
        "int": "ability.int",
        "wis": "ability.wis",
        "cha": "ability.cha",
    }
    for stat, val in ability_field.items():
        if stat in stat_map and isinstance(val, int):
            modifiers.append({
                "kind": "stat-modifier",
                "target": stat_map[stat],
                "mode": "ADD",
                "value": val,
            })
    return modifiers


def fetch_json(url):
    print(f"Fetching {url} ...")
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_existing_feats_dir(pack_dir):
    """Return feats dir path if it exists, else None."""
    feats_dir = pack_dir / "feats"
    if feats_dir.is_dir():
        return feats_dir
    return None


def get_existing_feats_file(pack_dir):
    """Return feats.json path if it exists as a file, else None."""
    feats_file = pack_dir / "feats.json"
    if feats_file.is_file():
        return feats_file
    return None


def load_existing_slugs_from_dir(feats_dir):
    slugs = set()
    for f in feats_dir.glob("*.json"):
        slugs.add(f.stem)
    return slugs


def load_existing_slugs_from_file(feats_file):
    try:
        with open(feats_file) as f:
            data = json.load(f)
        if isinstance(data, list):
            return {item["slug"] for item in data if "slug" in item}
    except Exception:
        pass
    return set()


def write_feat_to_dir(feats_dir, feat_obj):
    path = feats_dir / f"{feat_obj['slug']}.json"
    with open(path, "w") as f:
        json.dump(feat_obj, f, indent=2)
        f.write("\n")


def append_feats_to_file(feats_file, new_feats):
    if feats_file.exists():
        with open(feats_file) as f:
            data = json.load(f)
    else:
        data = []
    if not isinstance(data, list):
        data = []
    data.extend(new_feats)
    with open(feats_file, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def convert_feat(raw):
    name = raw.get("name", "")
    slug = slugify(name)
    source = raw.get("source", "")
    pack = SOURCE_MAP.get(source)
    if not pack:
        return None, None

    entries = raw.get("entries", [])
    description = flatten_entries(entries)

    prereq_raw = raw.get("prerequisite")
    prereq_str = parse_prerequisite(prereq_raw) if prereq_raw else None

    modifiers = parse_modifiers(raw.get("ability"))

    data = {
        "description": description,
        "modifiers": modifiers,
        "triggers": [],
    }
    if prereq_str:
        data["prerequisite"] = prereq_str

    feat_obj = {
        "kind": "feat",
        "slug": slug,
        "version": 1,
        "name": name,
        "data": data,
    }
    return pack, feat_obj


def import_feats(feats_data):
    # Group by pack
    by_pack = {}
    for raw in feats_data:
        source = raw.get("source", "")
        pack = SOURCE_MAP.get(source)
        if not pack:
            continue
        pack_dir = PACKS_DIR / pack
        if not pack_dir.is_dir():
            continue
        pack, feat_obj = convert_feat(raw)
        if not pack or not feat_obj:
            continue
        if pack not in by_pack:
            by_pack[pack] = []
        by_pack[pack].append(feat_obj)

    total_written = 0
    total_skipped = 0

    for pack, feats in sorted(by_pack.items()):
        pack_dir = PACKS_DIR / pack
        feats_dir = get_existing_feats_dir(pack_dir)
        feats_file = get_existing_feats_file(pack_dir)

        if feats_dir:
            existing_slugs = load_existing_slugs_from_dir(feats_dir)
            written = 0
            skipped = 0
            for feat_obj in feats:
                if feat_obj["slug"] in existing_slugs:
                    skipped += 1
                    continue
                write_feat_to_dir(feats_dir, feat_obj)
                existing_slugs.add(feat_obj["slug"])
                written += 1
            print(f"  [{pack}] feats/: wrote {written}, skipped {skipped} existing")
            total_written += written
            total_skipped += skipped
        elif feats_file:
            existing_slugs = load_existing_slugs_from_file(feats_file)
            new_feats = [f for f in feats if f["slug"] not in existing_slugs]
            skipped = len(feats) - len(new_feats)
            if new_feats:
                append_feats_to_file(feats_file, new_feats)
            print(f"  [{pack}] feats.json: wrote {len(new_feats)}, skipped {skipped} existing")
            total_written += len(new_feats)
            total_skipped += skipped
        else:
            # Create feats.json
            feats_file = pack_dir / "feats.json"
            with open(feats_file, "w") as f:
                json.dump(feats, f, indent=2)
                f.write("\n")
            print(f"  [{pack}] feats.json (new): wrote {len(feats)}")
            total_written += len(feats)

    print(f"\nFeats total: {total_written} written, {total_skipped} skipped")


def convert_background(raw):
    name = raw.get("name", "")
    slug = slugify(name)
    source = raw.get("source", "")
    pack = SOURCE_MAP.get(source)
    if not pack:
        return None, None

    entries = raw.get("entries", [])
    description = flatten_entries(entries)

    # Skill proficiencies
    skill_profs = []
    sp_list = raw.get("skillProficiencies", [])
    if sp_list:
        sp = sp_list[0] if isinstance(sp_list, list) else sp_list
        if isinstance(sp, dict):
            for key, val in sp.items():
                if key in ("choose", "any", "anyStandard"):
                    continue
                if val is True:
                    skill_profs.append(key.lower())

    # Tool proficiencies
    tool_profs = []
    tp_list = raw.get("toolProficiencies", [])
    if tp_list:
        tp = tp_list[0] if isinstance(tp_list, list) else tp_list
        if isinstance(tp, dict):
            for key, val in tp.items():
                if key in ("choose", "any", "anyStandard"):
                    continue
                if val is True:
                    tool_profs.append(key)

    # Languages
    lang_count = 0
    lp_list = raw.get("languageProficiencies", [])
    if lp_list:
        lp = lp_list[0] if isinstance(lp_list, list) else lp_list
        if isinstance(lp, dict):
            lang_count = lp.get("anyStandard", lp.get("any", 0))
            if not isinstance(lang_count, int):
                lang_count = 0

    bg_obj = {
        "kind": "background",
        "slug": slug,
        "version": 1,
        "name": name,
        "data": {
            "description": description,
            "skillProficiencies": skill_profs,
            "toolProficiencies": tool_profs,
            "languages": lang_count,
            "equipment": [],
        },
    }
    return pack, bg_obj


def import_backgrounds(backgrounds_data):
    # Group by pack
    by_pack = {}
    for raw in backgrounds_data:
        source = raw.get("source", "")
        pack = SOURCE_MAP.get(source)
        if not pack:
            continue
        pack_dir = PACKS_DIR / pack
        if not pack_dir.is_dir():
            continue
        pack, bg_obj = convert_background(raw)
        if not pack or not bg_obj:
            continue
        if pack not in by_pack:
            by_pack[pack] = []
        by_pack[pack].append(bg_obj)

    total_written = 0
    total_skipped = 0

    for pack, bgs in sorted(by_pack.items()):
        pack_dir = PACKS_DIR / pack
        bg_file = pack_dir / "backgrounds.json"

        if bg_file.exists():
            with open(bg_file) as f:
                existing = json.load(f)
            if not isinstance(existing, list):
                existing = []
            existing_slugs = {item["slug"] for item in existing if "slug" in item}
            new_bgs = [b for b in bgs if b["slug"] not in existing_slugs]
            skipped = len(bgs) - len(new_bgs)
            if new_bgs:
                existing.extend(new_bgs)
                with open(bg_file, "w") as f:
                    json.dump(existing, f, indent=2)
                    f.write("\n")
            print(f"  [{pack}] backgrounds.json: wrote {len(new_bgs)}, skipped {skipped} existing")
            total_written += len(new_bgs)
            total_skipped += skipped
        else:
            with open(bg_file, "w") as f:
                json.dump(bgs, f, indent=2)
                f.write("\n")
            print(f"  [{pack}] backgrounds.json (new): wrote {len(bgs)}")
            total_written += len(bgs)

    print(f"\nBackgrounds total: {total_written} written, {total_skipped} skipped")


def main():
    print("=== Importing Feats ===")
    feats_raw = fetch_json(
        "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/feats.json"
    )
    feats_list = feats_raw.get("feat", feats_raw) if isinstance(feats_raw, dict) else feats_raw
    print(f"Loaded {len(feats_list)} feats from 5etools")
    import_feats(feats_list)

    print("\n=== Importing Backgrounds ===")
    backgrounds_raw = fetch_json(
        "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/backgrounds.json"
    )
    backgrounds_list = (
        backgrounds_raw.get("background", backgrounds_raw)
        if isinstance(backgrounds_raw, dict)
        else backgrounds_raw
    )
    print(f"Loaded {len(backgrounds_list)} backgrounds from 5etools")
    import_backgrounds(backgrounds_list)

    print("\nDone!")


if __name__ == "__main__":
    main()
