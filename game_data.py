"""Pinned, shared game data. No search, server or essence dependencies."""
import json
import re
from pathlib import Path
from unlock_text import translate_condition

ROOT = Path(__file__).parent
VERSION = '2026-09-14.2'
COMMIT = 'e93dd1c87ca453de8fae8165bdbef220732feabc'

def read(name):
    return json.loads((ROOT / 'data' / (name + '.json')).read_text())

DEMONS = read('demon-data') | read('ven-demon-data')
SPECIAL = read('ven-special-recipes')
PREREQS = read('fusion-prereqs') | read('ven-fusion-prereqs')
CHART, ELEMENT = read('ven-fusion-chart'), read('element-chart')
SKILLS = {}
for filename in ('skill-data', 'ven-skill-data'):
    for row in read(filename).values():
        SKILLS[row['a'][0]] = dict(name=row['a'][0], element=row['a'][1], rank=row['b'][0], mp=row['b'][1], power=row['b'][2], description=' / '.join(row['c']), raw=row)
UNLOCKS, DLC = {}, set()
for group in read('ven-demon-unlocks'):
    for names, condition in group['conditions'].items():
        for name in names.split(','):
            UNLOCKS[name] = condition
            if group['category'] == 'Vengeance DLC': DLC.add(name)
PLAYABLE = {n: d for n, d in DEMONS.items() if d['race'] in CHART['races'] + ['Element']}
ACCIDENTS = {n for n, p in PREREQS.items() if p == 'Fusion Accident'}
RAW_UNLOCKS, RAW_PREREQS = UNLOCKS.copy(), PREREQS.copy()
UNLOCKS = {n: translate_condition(t) for n,t in RAW_UNLOCKS.items()}
PREREQS = {n: translate_condition(t) for n,t in RAW_PREREQS.items()}
RACES = {r: i for i, r in enumerate(CHART['races'])}
LABELS = {kind: read(kind+'-names') for kind in ('demon', 'skill', 'race')}
INNATE = read('innate-skills')
# Official game text is an optional, locally supplied resource pack. A clean
# source checkout must work without distributing the game's text or artwork.
def load_profiles():
    if (ROOT / 'data' / 'demon-profiles.json').is_file():
        return read('demon-profiles')
    return {'source': {'kind': 'not-installed', 'label': ''}, 'demons': {}}

DEMON_PROFILES = load_profiles()

def label(name, kind='demon'):
    suffix = re.match(r'^(.*) ([A-HJ-Z])$', name)
    base = suffix[1] if suffix else name
    translated = LABELS[kind].get(base, [])
    result = translated[1] if len(translated)>1 and translated[1] else base
    return result + (' '+suffix[2] if suffix else '')

def transferable(skill):
    return skill in SKILLS and SKILLS[skill]['element'] != 'inn' and 0 < SKILLS[skill]['rank'] < 99

def string_list(value,title,valid):
    if not isinstance(value,list) or not all(isinstance(x,str) and x in valid for x in value):raise ValueError(title+'包含无效项目。')
    return list(dict.fromkeys(value))

