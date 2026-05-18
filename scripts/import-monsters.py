#!/usr/bin/env python3
"""Import 5etools bestiary monsters into grimoire content-pack format."""

import json
import os
import re
import urllib.request

PACKS_DIR = "/home/narfman0/.openclaw/workspace/grimoire-packs"
SRD_MONSTERS_PATH = "/home/narfman0/.openclaw/workspace/grimoire/content-packs/srd-5.2/monsters.json"
BESTIARY_BASE = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/"

# Source code → pack slug mapping
SOURCE_TO_PACK = {
    "MM": "mm",
    "VGM": "volos",
    "MTF": "mtof",
    "MPMM": "mpmm",
    "XMM": "xmm",
    "XDMG": "dmg-2024",
    "XPHB": "phb-2024",
    "BGG": "bigby",
    "FTD": "fizbans",
    "BGDIA": "bgdia",
    "CoS": "cos",
    "CoA": "coa",
    "CRCotN": "crcn",
    "DSotDQ": "dsotdq",
    "EGW": "wildemount",
    "ERLW": "erlw",
    "GGR": "ggr",
    "GoS": "gos",
    "IDRotF": "idrotf",
    "JttRC": "jttrc",
    "KftGV": "kftgv",
    "LMoP": "lmop",
    "MOT": "mot",
    "OotA": "oota",
    "PaBTSO": "pabtso",
    "PSA": "psa",
    "PSK": "psk",
    "PSD": "psd",
    "PSI": "psi",
    "PSX": "psx",
    "PSZ": "psz",
    "PotA": "pota",
    "QftIS": "qftis",
    "SCC": "scc",
    "SDW": "sdw",
    "SKT": "skt",
    "TCE": "tashas",
    "ToA": "toa",
    "TftYP": "tfttyp",
    "VRGR": "vrgr",
    "WBtW": "wbtw",
    "WDH": "wdh",
    "WDMM": "wdmm",
    "XGE": "xanathars",
    "CM": "cm",
    "HotDQ": "hotdq",
    "RoT": "rot",
    "DMG": "dmg",
    "AI": "ai",
    "ABH": "abh",
    "AWM": "awm",
    "BAM": "bam",
    "BMT": "bmt",
    "DC": "dc",
    "AATM": "aatm",
    "LFL": "lfl",
    "LLK": "llk",
    "LR": "lr",
    "NF": "nf",
    "RMBRE": "rmbre",
    "VEoR": "veor",
    "NRH-TCMC": "nrh-at",
    "NRH-AVitW": "nrh-at",
    "NRH-ASS": "nrh-at",
    "NRH-CoI": "nrh-at",
    "NRH-TLT": "nrh-at",
    "NRH-AWoL": "nrh-at",
    "NRH-AT": "nrh-at",
}

# Packs that need creation with specific metadata
CREATE_PACKS = {
    "mm": {"slug": "mm", "name": "Monster Manual"},
    "xmm": {"slug": "xmm", "name": "Monster Manual 2024"},
    "aatm": {"slug": "aatm", "name": "Adventure Atlas: The Mortuary"},
    "nrh-at": {"slug": "nrh-at", "name": "NERDS Restoring Harmony"},
}

SIZE = {'T': 'tiny', 'S': 'small', 'M': 'medium', 'L': 'large', 'H': 'huge', 'G': 'gargantuan', 'V': 'varies'}

LAW = {'L': 'lawful', 'C': 'chaotic', 'N': 'neutral', 'NX': 'neutral', 'NY': 'neutral', 'U': 'unaligned', 'A': 'any'}
MOR = {'G': 'good', 'E': 'evil', 'N': 'neutral', 'U': 'unaligned', 'A': 'any'}

CR_XP = {
    '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100,
    '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200,
    '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000,
    '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000,
    '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000
}


def slugify(name):
    return re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', name.lower()))


def parse_alignment(arr):
    if not arr:
        return ''
    if isinstance(arr, str):
        return arr.lower()
    # Handle objects like {"alignment": [...], "chance": 50}
    flat = []
    for item in arr:
        if isinstance(item, dict):
            sub = item.get('alignment', item.get('special', ''))
            if isinstance(sub, list):
                flat.extend(sub)
            elif sub:
                flat.append(sub)
        elif isinstance(item, str):
            flat.append(item)
    arr = flat
    if not arr:
        return ''
    if 'U' in arr:
        return 'unaligned'
    if 'A' in arr:
        return 'any alignment'
    law_parts = [x for x in arr if x in ('L', 'C', 'NX')]
    mor_parts = [x for x in arr if x in ('G', 'E', 'NY')]
    n_count = arr.count('N')
    if not law_parts and not mor_parts:
        return 'neutral'
    law_str = LAW.get(law_parts[0], 'neutral') if law_parts else ('neutral' if n_count > 0 else '')
    mor_str = MOR.get(mor_parts[0], '') if mor_parts else ('neutral' if n_count > 1 else '')
    if law_str == 'neutral' and mor_str == 'neutral':
        return 'neutral'
    if not mor_str and law_str == 'neutral':
        return 'neutral'
    if mor_str:
        return f'{law_str} {mor_str}'.strip()
    return law_str.strip()


def parse_ac(ac_list):
    if not ac_list:
        return None, None
    first = ac_list[0]
    if isinstance(first, int):
        return first, None
    if isinstance(first, dict):
        ac_val = first.get('ac')
        frm = first.get('from', [])
        desc = ', '.join(str(f) for f in frm) if frm else None
        # Clean tags from desc
        if desc:
            desc = strip_tags(desc)
        return ac_val, desc
    return None, None


def parse_type(t):
    if isinstance(t, str):
        return t.lower()
    base = t.get('type', '')
    # Handle nested choose: {"choose": ["celestial", "fiend"]}
    if isinstance(base, dict):
        choose = base.get('choose', [])
        base = '/'.join(choose) if choose else 'unknown'
    tags = t.get('tags', [])
    swarm = t.get('swarmSize')
    if swarm:
        base_lower = base.lower() if base else ''
        size_lower = SIZE.get(swarm, swarm).lower()
        return f'swarm of {size_lower} {base_lower}s'
    if tags:
        tag_strs = []
        for tag in tags:
            if isinstance(tag, str):
                tag_strs.append(tag)
            elif isinstance(tag, dict):
                tag_strs.append(tag.get('tag', str(tag)))
        return f'{base.lower()} ({", ".join(tag_strs)})'
    return base.lower()


def parse_senses(senses_list, passive):
    result = {}
    if passive:
        result['passivePerception'] = passive
    for s in (senses_list or []):
        s_lower = str(s).lower()
        for kind in ['darkvision', 'blindsight', 'tremorsense', 'truesight']:
            m = re.search(rf'{kind}\s+(\d+)', s_lower)
            if m:
                result[kind] = int(m.group(1))
    return result


def strip_tags(text):
    if not text:
        return ''
    # {@damage Xd+Y} → Xd+Y
    text = re.sub(r'\{@damage ([^}]+)\}', r'\1', text)
    # {@scaledice ...} → keep formula
    text = re.sub(r'\{@scaledice ([^|}]+)(?:\|[^}]*)?\}', r'\1', text)
    # {@hit X} → +X
    text = re.sub(r'\{@hit (-?\d+)\}', r'+\1', text)
    # {@dc X} → DC X
    text = re.sub(r'\{@dc (\d+)\}', r'DC \1', text)
    # {@h} → Hit:
    text = re.sub(r'\{@h\}', 'Hit: ', text)
    # {@atk ...} → remove
    text = re.sub(r'\{@atk [^}]+\}', '', text)
    # Other tags: {@tagname content|...} → keep content
    text = re.sub(r'\{@\w+ ([^|}]+)(?:\|[^}]*)?\}', r'\1', text)
    # Remaining unclosed tags
    text = re.sub(r'\{@\w+\}', '', text)
    return text.strip()


def entries_to_text(entries):
    """Flatten entries (which may be nested) into a single text string."""
    parts = []
    for e in entries:
        if isinstance(e, str):
            parts.append(e)
        elif isinstance(e, dict):
            sub = e.get('entries', e.get('items', []))
            if sub:
                parts.append(entries_to_text(sub))
            elif 'entry' in e:
                parts.append(str(e['entry']))
    return ' '.join(parts)


def parse_action(action_entry):
    name = action_entry.get('name', '')
    entries = action_entry.get('entries', [])
    # Gather raw text preserving tags for detection
    raw_text = entries_to_text(entries)

    result = {'name': name}

    # Detect attack type from @atk tag
    atk_match = re.search(r'\{@atk ([^}]+)\}', raw_text)
    if atk_match:
        atk_types = [x.strip() for x in atk_match.group(1).split(',')]
        has_melee = any(x in ('mw', 'ms') for x in atk_types)
        has_ranged = any(x in ('rw', 'rs') for x in atk_types)
        if has_melee and has_ranged:
            result['type'] = 'attack'
            result['range'] = 'melee-or-ranged'
        elif has_melee:
            result['type'] = 'attack'
            result['range'] = 'melee'
        elif has_ranged:
            result['type'] = 'attack'
            result['range'] = 'ranged'
        else:
            result['type'] = 'attack'
            result['range'] = 'melee'

        # Hit bonus
        hit_m = re.search(r'\{@hit (-?\d+)\}', raw_text)
        if hit_m:
            result['attackBonus'] = int(hit_m.group(1))

        # Reach
        reach_m = re.search(r'reach (\d+) ft', raw_text, re.IGNORECASE)
        if reach_m:
            result['reach'] = int(reach_m.group(1))

        # Range bands
        range_m = re.search(r'range (\d+)/(\d+) ft', raw_text, re.IGNORECASE)
        if range_m:
            result['rangeBands'] = {'normal': int(range_m.group(1)), 'long': int(range_m.group(2))}

        # Damage after {@h}
        h_idx = raw_text.find('{@h}')
        after_hit = raw_text[h_idx:] if h_idx >= 0 else raw_text

        dmg_list = []
        dmg_patterns = re.finditer(r'\{@damage ([^}]+)\}[^a-zA-Z]*\)?\s+([a-zA-Z]+)\s+damage', after_hit)
        for dm in dmg_patterns:
            formula = dm.group(1).strip()
            dtype = dm.group(2).strip().lower()
            dmg_list.append({'dice': formula, 'type': dtype})

        if dmg_list:
            result['damage'] = dmg_list

        return result
    else:
        # Non-attack: just description
        result['description'] = strip_tags(raw_text)
        return result


def parse_saves(save_dict):
    if not save_dict:
        return {}
    result = {}
    for k, v in save_dict.items():
        try:
            result[k] = int(str(v).replace('+', ''))
        except (ValueError, TypeError):
            pass
    return result


def parse_skills(skill_dict):
    if not skill_dict:
        return {}
    result = {}
    for k, v in skill_dict.items():
        try:
            result[k.lower()] = int(str(v).replace('+', ''))
        except (ValueError, TypeError):
            pass
    return result


def cr_to_xp(cr):
    if isinstance(cr, dict):
        cr = cr.get('cr', '0')
    return CR_XP.get(str(cr), 0)


def cr_to_str(cr):
    if isinstance(cr, dict):
        return cr.get('cr', '0')
    return str(cr) if cr is not None else '0'


def parse_speed(speed_obj):
    if not speed_obj:
        return {'walk': 30}
    if isinstance(speed_obj, int):
        return {'walk': speed_obj}
    result = {}
    for key in ['walk', 'fly', 'swim', 'climb', 'burrow']:
        val = speed_obj.get(key)
        if val is not None:
            if isinstance(val, dict):
                val = val.get('number', 0)
            result[key] = int(val)
    if not result:
        result['walk'] = 0
    return result


def parse_languages(lang_list):
    if not lang_list:
        return []
    result = []
    for lang in lang_list:
        if isinstance(lang, str):
            cleaned = strip_tags(lang)
            if cleaned and cleaned.lower() not in ('--', '—', ''):
                result.append(cleaned)
    return result


def parse_damage_resistances(dr):
    if not dr:
        return []
    result = []
    for item in dr:
        if isinstance(item, str):
            result.append(item)
        elif isinstance(item, dict):
            # Has conditions, just grab the damage types
            dmg_types = item.get('resist', item.get('immune', item.get('vulnerable', [])))
            if isinstance(dmg_types, list):
                result.extend([d for d in dmg_types if isinstance(d, str)])
    return result


def convert_monster(m, pack_slug):
    """Convert a 5etools monster to grimoire format."""
    name = m.get('name', '')
    slug_base = slugify(name)
    source_raw = m.get('source', '')
    # Add source suffix to slug to disambiguate
    pack = SOURCE_TO_PACK.get(source_raw, pack_slug)
    slug = slug_base  # slug within the pack

    # Size
    size_code = m.get('size', ['M'])
    if isinstance(size_code, list):
        size_code = size_code[0] if size_code else 'M'
    size = SIZE.get(size_code, 'medium')

    # Type
    mtype = parse_type(m.get('type', 'unknown'))

    # Alignment
    alignment = parse_alignment(m.get('alignment', []))

    # AC
    ac_val, ac_desc = parse_ac(m.get('ac', []))

    # HP
    hp_obj = m.get('hp', {})
    hp_max = hp_obj.get('average', 0) if isinstance(hp_obj, dict) else 0
    hp_formula = hp_obj.get('formula', '') if isinstance(hp_obj, dict) else ''
    # Clean formula
    if hp_formula:
        hp_formula = strip_tags(hp_formula)

    # Speed
    speed = parse_speed(m.get('speed'))

    # Ability scores
    ability_scores = {
        'str': m.get('str', 10),
        'dex': m.get('dex', 10),
        'con': m.get('con', 10),
        'int': m.get('int', 10),
        'wis': m.get('wis', 10),
        'cha': m.get('cha', 10),
    }

    # Saving throws
    saves = parse_saves(m.get('save', {}))

    # Skills
    skills = parse_skills(m.get('skill', {}))

    # Senses
    senses = parse_senses(m.get('senses', []), m.get('passive'))

    # Languages
    languages = parse_languages(m.get('languages', []))

    # CR
    cr_raw = m.get('cr')
    cr_str = cr_to_str(cr_raw)
    xp = cr_to_xp(cr_raw)

    # Damage resistances / immunities / vulnerabilities
    dmg_resist = parse_damage_resistances(m.get('resist', []))
    dmg_immune = parse_damage_resistances(m.get('immune', []))
    cond_immune = []
    for item in (m.get('conditionImmune', []) or []):
        if isinstance(item, str):
            cond_immune.append(item)
        elif isinstance(item, dict):
            cond_immune.extend([c for c in item.get('conditionImmune', []) if isinstance(c, str)])
    dmg_vuln = parse_damage_resistances(m.get('vulnerable', []))

    # Traits
    traits = []
    for trait in (m.get('trait', []) or []):
        tname = trait.get('name', '')
        tentries = trait.get('entries', [])
        ttext = strip_tags(entries_to_text(tentries))
        if tname:
            traits.append({'name': tname, 'text': ttext})

    # Actions
    actions = []
    for action in (m.get('action', []) or []):
        parsed = parse_action(action)
        if parsed.get('name'):
            actions.append(parsed)

    # Bonus actions
    bonus_actions = []
    for ba in (m.get('bonus', []) or []):
        parsed = parse_action(ba)
        if parsed.get('name'):
            bonus_actions.append(parsed)

    # Reactions
    reactions = []
    for reaction in (m.get('reaction', []) or []):
        rname = reaction.get('name', '')
        rentries = reaction.get('entries', [])
        rtext = strip_tags(entries_to_text(rentries))
        if rname:
            reactions.append({'name': rname, 'text': rtext})

    # Legendary actions
    legendary_actions = []
    for la in (m.get('legendary', []) or []):
        parsed = parse_action(la)
        if parsed.get('name'):
            legendary_actions.append(parsed)

    data = {
        'size': size,
        'type': mtype,
        'alignment': alignment,
        'ac': ac_val,
        'hp': {'max': hp_max, 'formula': hp_formula},
        'speed': speed,
        'abilityScores': ability_scores,
        'senses': senses,
        'languages': languages,
        'cr': cr_str,
        'xp': xp,
        'damageResistances': dmg_resist,
        'damageImmunities': dmg_immune,
        'damageVulnerabilities': dmg_vuln,
        'conditionImmunities': cond_immune,
        'traits': traits,
        'actions': actions,
        'reactions': reactions,
        'legendaryActions': legendary_actions,
    }

    if ac_desc:
        data['acDescription'] = ac_desc
    if saves:
        data['savingThrows'] = saves
    if skills:
        data['skills'] = skills
    if bonus_actions:
        data['bonusActions'] = bonus_actions

    result = {
        'kind': 'monster',
        'slug': slug,
        'version': 1,
        'name': name,
        'source': pack,
        'data': data,
    }

    return result


def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'grimoire-importer/1.0'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))


def load_existing_monsters(path):
    """Load existing monsters.json and return dict of slug→monster."""
    if not os.path.exists(path):
        return {}
    with open(path, 'r') as f:
        data = json.load(f)
    return {m['slug']: m for m in data}


def ensure_pack(pack_slug):
    """Create pack directory and meta.json if needed."""
    pack_dir = os.path.join(PACKS_DIR, pack_slug)
    os.makedirs(pack_dir, exist_ok=True)
    meta_path = os.path.join(pack_dir, 'meta.json')
    if not os.path.exists(meta_path):
        meta = CREATE_PACKS.get(pack_slug, {'slug': pack_slug, 'name': pack_slug})
        meta['version'] = '1.0.0'
        meta['default_source'] = pack_slug
        with open(meta_path, 'w') as f:
            json.dump(meta, f, indent=2)
        print(f"  Created meta.json for {pack_slug}")
    return pack_dir


def main():
    # Load SRD slugs to avoid duplication
    print("Loading SRD monster slugs...")
    srd_slugs = set()
    if os.path.exists(SRD_MONSTERS_PATH):
        with open(SRD_MONSTERS_PATH, 'r') as f:
            srd_data = json.load(f)
        srd_slugs = {m['slug'] for m in srd_data}
        print(f"  Found {len(srd_slugs)} SRD monster slugs to skip.")

    # Fetch bestiary index
    print("Fetching bestiary index...")
    index = fetch_json(BESTIARY_BASE + "index.json")
    print(f"  Found {len(index)} sources in index.")

    # Build reverse mapping: source_code → filename
    # Index maps source → filename (e.g. "MM" → "bestiary-mm.json")
    source_to_file = {}
    for src, filename in index.items():
        source_to_file[src] = filename

    # Collect all sources we need
    sources_to_process = {}
    for src_code, pack_slug in SOURCE_TO_PACK.items():
        # Find the file for this source
        # Try exact match first
        filename = source_to_file.get(src_code)
        if not filename:
            # Try case-insensitive
            for k, v in source_to_file.items():
                if k.lower() == src_code.lower():
                    filename = v
                    break
        if filename:
            sources_to_process[src_code] = (filename, pack_slug)
        else:
            print(f"  WARNING: No index entry for source {src_code}")

    # Group by pack slug so we write each pack's monsters.json once
    pack_to_sources = {}
    for src_code, (filename, pack_slug) in sources_to_process.items():
        if pack_slug not in pack_to_sources:
            pack_to_sources[pack_slug] = []
        pack_to_sources[pack_slug].append((src_code, filename))

    # Track which filenames we've already fetched (multiple sources can share a file)
    fetched_files = {}

    # Process each pack
    for pack_slug in sorted(pack_to_sources.keys()):
        source_files = pack_to_sources[pack_slug]
        pack_dir = ensure_pack(pack_slug)
        monsters_path = os.path.join(pack_dir, 'monsters.json')

        # Load existing monsters
        existing = load_existing_monsters(monsters_path)
        new_count = 0
        skip_count = 0

        for src_code, filename in source_files:
            url = BESTIARY_BASE + filename
            if filename not in fetched_files:
                try:
                    print(f"  Fetching {filename}...")
                    data = fetch_json(url)
                    fetched_files[filename] = data
                except Exception as e:
                    print(f"  ERROR fetching {filename}: {e}")
                    fetched_files[filename] = {'monster': []}

            file_data = fetched_files[filename]
            monsters_raw = file_data.get('monster', [])

            # Filter to only this source's monsters
            src_monsters = [m for m in monsters_raw if m.get('source', '') == src_code]
            print(f"Processing {src_code} ({pack_slug}): {len(src_monsters)} monsters from {filename}")

            for m in src_monsters:
                # Skip _copy variants (they inherit from another monster)
                if '_copy' in m:
                    skip_count += 1
                    continue

                # Skip NPC-only entries
                if m.get('isNpc', False):
                    skip_count += 1
                    continue

                name = m.get('name', '')
                if not name:
                    skip_count += 1
                    continue

                slug = slugify(name)

                # Skip SRD duplicates
                if slug in srd_slugs:
                    skip_count += 1
                    continue

                # Skip if already in pack
                if slug in existing:
                    skip_count += 1
                    continue

                try:
                    converted = convert_monster(m, pack_slug)
                    existing[slug] = converted
                    new_count += 1
                except Exception as e:
                    print(f"    ERROR converting {name}: {e}")
                    skip_count += 1

        if new_count > 0:
            # Write sorted by name for readability
            monster_list = sorted(existing.values(), key=lambda x: x.get('name', ''))
            with open(monsters_path, 'w') as f:
                json.dump(monster_list, f, indent=2, ensure_ascii=False)
            print(f"  Wrote {len(monster_list)} total monsters to {monsters_path} ({new_count} new, {skip_count} skipped)")
        else:
            print(f"  No new monsters for {pack_slug} ({skip_count} skipped)")

    print("\nDone!")


if __name__ == '__main__':
    main()
