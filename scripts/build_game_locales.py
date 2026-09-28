"""Build optional language packs from message-table exports of a local game.

Inputs are private JSON exports, never executable scripts. Matching uses the
serialized labels (not table row numbers), and every used effect tag must be
resolved. Game text is excluded from the public source/image by default.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import planner
from unlock_text import translate_condition

LANGUAGES = ('en', 'ja', 'zh-Hant', 'ko')
# Replacement fragments for the game's skill-description control tags.
ELEMENTS = {
    'phy': ('Physical', '物理', '物理', '물리'),
    'fir': ('Fire', '火炎', '火炎', '화염'),
    'ice': ('Ice', '氷結', '冰結', '빙결'),
    'ele': ('Electric', '電撃', '電擊', '전격'),
    'for': ('Force', '衝撃', '衝擊', '충격'),
    'lig': ('Light', '破魔', '破魔', '파마'),
    'dar': ('Dark', '呪殺', '咒殺', '주살'),
    'alm': ('Almighty', '万能', '萬能', '만능'),
}
TARGETS = {
    '1 foe': ('1 foe', '敵単体', '敵方單體', '적 1체'),
    'All foes': ('all foes', '敵全体', '敵方全體', '적 전체'),
    'Rand foes': ('random foes', '敵ランダム', '敵方隨機目標', '무작위 적'),
    '1 ally': ('1 ally', '味方単体', '我方單體', '아군 1체'),
    'All allies': ('all allies', '味方全体', '我方全體', '아군 전체'),
    '1 stock': ('1 ally in the stock', 'ストックの仲魔単体', '後備仲魔單體', '스톡의 동료 악마 1체'),
    'Self': ('self', '自身', '自身', '자신'),
    'Universal': ('all allies and foes', '敵味方全体', '敵我全體', '적과 아군 전체'),
}
AILMENTS = {
    'Charm': ('Charm', '魅了', '魅惑', '매혹'),
    'Seal': ('Seal', '封技', '封技', '봉인'),
    'Panic': ('Confusion', '混乱', '混亂', '혼란'),
    'Poison': ('Poison', '毒', '中毒', '독'),
    'Sleep': ('Sleep', '睡眠', '睡眠', '수면'),
    'Mirage': ('Mirage', '幻惑', '幻惑', '환혹'),
}
QUALIFIERS = {
    'CoC': ('Canon of Creation', '創世の女神篇', '創世女神篇', '창세의 여신편'),
    'CoV': ('Canon of Vengeance', '復讐の女神篇', '復仇女神篇', '복수의 여신편'),
    'Law alignment': ('Law alignment', '属性傾向がLAW', '屬性傾向為秩序', '성향이 질서'),
    'Neutral alignment': ('Neutral alignment', '属性傾向がNEUTRAL', '屬性傾向為中立', '성향이 중립'),
    'Chaos alignment': ('Chaos alignment', '属性傾向がCHAOS', '屬性傾向為混沌', '성향이 혼돈'),
    'Law Route': ('Law route', 'LAWルート', '秩序路線', '질서 루트'),
    'Chaos Route': ('Chaos route', 'CHAOSルート', '混沌路線', '혼돈 루트'),
}
PLACES = {
    'Minato': ('Minato', '港区', '港區', '미나토구'),
    'Shinagawa': ('Shinagawa', '品川区', '品川區', '시나가와구'),
    'Chiyoda or Shinjuku': ('Chiyoda or Shinjuku', '千代田区または新宿区', '千代田區或新宿區', '치요다구 또는 신주쿠구'),
    'Taito': ('Taito', '台東区', '台東區', '다이토구'),
    'Asakusa': ('Asakusa', '浅草', '淺草', '아사쿠사'),
    'Honjo': ('Honjo', '本所', '本所', '혼조'),
    'Komagata': ('Komagata', '駒形', '駒形', '고마가타'),
    'Mita': ('Mita', '三田', '三田', '미타'),
    'Nagatacho': ('Nagatacho', '永田町', '永田町', '나가타초'),
    'Shiba Park': ('Shiba Park', '芝公園', '芝公園', '시바 공원'),
    'Shinagawa Pier': ('Shinagawa Pier', '品川埠頭', '品川碼頭', '시나가와 부두'),
    'Shinobazu Pond': ('Shinobazu Pond', '不忍池', '不忍池', '시노바즈 연못'),
    'South Shinagawa': ('South Shinagawa', '南品川', '南品川', '미나미시나가와'),
    'Tennozu': ('Tennozu', '天王洲', '天王洲', '덴노즈'),
    'Tennozu Park': ('Tennozu Park', '天王洲公園', '天王洲公園', '덴노즈 공원'),
    'Shinjuku Gyoen': ('Shinjuku Gyoen', '新宿御苑', '新宿御苑', '신주쿠 교엔'),
    'Yoyogi': ('Yoyogi', '代々木', '代代木', '요요기'),
    'Kabukicho': ('Kabukicho', '歌舞伎町', '歌舞伎町', '가부키초'),
    'West Shinjuku 3rd Block': ('West Shinjuku 3rd Block', '西新宿三丁目', '西新宿三丁目', '니시신주쿠 3초메'),
    'Empyrean: Path to the Throne': ('Empyrean: Path to the Throne', '至高天・玉座への道', '至高天通往王座的道路', '지고천·왕좌로 가는 길'),
    'Shakan: 1st Stratum Foyer': ('Shakan: 1st Stratum Foyer', '至聖所シャカン・第一階層入口', '至聖所夏康第一層入口', '지성소 샤칸·제1계층 입구'),
    'Temple of Eternity: 1F Outside': ('Temple of Eternity: 1F Outside', '万古の神殿・一階外郭', '萬古神殿一層外側', '만고의 신전·1층 외곽'),
}


def localize_condition(condition, language, quests):
    """Translate condition structure and insert verified official quest titles."""
    index = LANGUAGES.index(language)
    phrase = lambda values: values[index]
    condition = condition.replace('Story locked or (CoC) Clear', 'Story locked (CoC) or Clear')
    if condition.startswith('Defeat in '):
        place = PLACES[condition.removeprefix('Defeat in ')][index]
        return phrase((f'Defeat the Fiend in {place}.', f'{place}で魔人を倒すと解禁。', f'在{place}擊敗該魔人後解鎖。', f'{place}에서 해당 마인을 쓰러뜨리면 해금됩니다.'))
    if ' or ' in condition:
        separator = phrase((' OR ', ' または ', ' 或 ', ' 또는 '))
        return separator.join(localize_condition(part, language, quests) for part in condition.split(' or '))
    qualifier = re.search(r' \(([^)]+)\)$', condition)
    if qualifier:
        return QUALIFIERS[qualifier[1]][index] + ': ' + localize_condition(condition[:qualifier.start()], language, quests)
    quest = re.fullmatch(r'(?:Clear )?"([^"]+)"', condition)
    if quest:
        name = quests[quest[1]]
        return phrase((f'Complete “{name}”.', f'「{name}」をクリアすると解禁。', f'完成任務「{name}」後解鎖。', f'「{name}」 완료 후 해금됩니다.'))
    exact = {
        'Story locked': ('Unlocked through story progression.', 'ストーリー進行で解禁。', '隨主線劇情推進解鎖。', '메인 스토리 진행으로 해금됩니다.'),
        'New Game+': ('Start a New Game+ with cleared save data.', 'クリアデータを引き継いで周回を開始すると解禁。', '進入繼承通關資料的新周目後解鎖。', '클리어 데이터를 계승한 새 회차에서 해금됩니다.'),
        'Godborn New Game+': ('Start New Game+ in Godborn mode.', '「創生」モードで周回を開始すると解禁。', '以「創生」模式開啟新周目後解鎖。', '「창생」 모드로 새 회차를 시작하면 해금됩니다.'),
        'Chaos Route': ('Enter the Chaos route.', 'CHAOSルートに入ると解禁。', '進入混沌路線後解鎖。', '혼돈 루트에 진입하면 해금됩니다.'),
        'Fusion Accident': ('Obtained through a fusion accident.', '合体事故で入手。', '透過合體事故獲得。', '합체 사고로 획득합니다.'),
        "Follow up on Bethel's investigation of Yakumo": ('Continue the events involving Bethel’s investigation of Yakumo.', 'ベテルによる八雲の調査イベントを進めると解禁。', '繼續推進伯特利調查八雲的相關事件後解鎖。', '베텔의 야쿠모 조사 관련 이벤트를 진행하면 해금됩니다.'),
    }
    if condition in exact:
        return exact[condition][index]
    if condition.endswith(' Aogami Husk'):
        place = condition.removesuffix(' Aogami Husk')
        if place.startswith('Chiyoda '):
            number = place.removeprefix('Chiyoda ')
            place = phrase((f'Chiyoda (area {number})', f'千代田（エリア{number}）', f'千代田（區域{number}）', f'치요다({number}구역)'))
        else:
            place = PLACES[place][index]
        return phrase((f'Examine the Aogami Husk in {place}.', f'{place}のアオガミの骸を調べる。', f'調查{place}的青神遺骸。', f'{place}의 아오가미 유해를 조사하세요.'))
    if condition.startswith('Tokyo Diet Building Head Researcher after reaching '):
        place = PLACES[condition.removeprefix('Tokyo Diet Building Head Researcher after reaching ')][index]
        return phrase((f'After reaching {place}, speak to the head researcher at the Tokyo Diet Building.', f'{place}に到達後、東京の国会議事堂にいる研究責任者から受け取る。', f'到達{place}後，向東京國會議事堂的研究負責人領取。', f'{place} 도달 후 도쿄 국회의사당의 연구 책임자에게 받으세요.'))
    raise ValueError('Untranslated condition: ' + condition)


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def by_label(table, pattern):
    result = {}
    for row in table.values():
        match = re.fullmatch(pattern, row['label'])
        if not match:
            continue
        identifier = int(match[1])
        if identifier in result:
            raise ValueError(f'Duplicate message label ID: {identifier}')
        result[identifier] = row
    return result


def paragraph(text, language):
    lines = [line.strip() for line in text.splitlines()]
    if language in ('en', 'ko'):
        return re.sub(r'\s+', ' ', ' '.join(lines)).strip()
    return ''.join(lines).strip()


def message(row, language, paragraphs=False):
    if not row or not row.get('pages'):
        raise ValueError('Missing game message')
    result = '\n\n'.join(paragraph(part, language) for page in row['pages']
                         for part in re.split(r'\n\s*\n', page) if part.strip())
    if not result or 'NOT USED' in result or row['label'].startswith('NotUsed_'):
        raise ValueError('Unused or empty game message: ' + row['label'])
    return result if paragraphs else result.replace('\n\n', ' ')


def expand_effect(row, raw, language):
    index = LANGUAGES.index(language)
    target, element = raw['a'][2], raw['a'][1]
    ailments = [value.strip() for value in raw['c'][0].split(',')]

    def replace(match):
        tag = match[1]
        if tag == 'skill_tgt':
            return TARGETS[target][index]
        if tag == 'skill_elm 0':
            return ELEMENTS[element][index]
        if tag == 'skill_minhit':
            return str(raw['b'][3])
        if tag == 'skill_maxhit':
            return str(raw['b'][4])
        if tag.startswith('skill_bst '):
            return AILMENTS[ailments[int(tag.split()[1])]][index]
        raise ValueError(f'Unresolved effect tag {tag} in {raw["a"][0]}')

    return re.sub(r'<([^>]+)>', replace, message(row, language))


def build(source_dir, output):
    raw = {language: read(source_dir / f'raw-{language}.json') for language in ('zh-Hans', *LANGUAGES)}
    if len({json.dumps(data['source'] | {'language': ''}, sort_keys=True) for data in raw.values()}) != 1:
        raise ValueError('Language exports must come from the same game build and PAK index')
    catalog = planner.catalog()
    profile_map = planner.DEMON_PROFILES.get('demons', {})
    if set(profile_map) != {d['name'] for d in catalog['demons']}:
        raise ValueError('Install the verified demon profile/identity pack before building locales')
    skills_raw = planner.read('skill-data') | planner.read('ven-skill-data')
    names = {s['name'] for s in catalog['skills'] + catalog['innateSkills']}
    names.update(s['name'] for e in catalog['essences'] for s in e['skills'])
    skill_ids = {row['a'][0]: int(key) for key, row in skills_raw.items() if row['a'][0] in names}
    if set(skill_ids) != names:
        raise ValueError('A catalog skill has no canonical game ID')
    tables = {}
    for language, data in raw.items():
        table = data['tables']
        tables[language] = dict(
            demons=by_label(table['demons'], r'CHR_NAME_(\d+)(?:_.*)?'),
            profiles=by_label(table['profiles'], r'DEVIL_ID_(\d+)(?:_.*)?'),
            skills=by_label(table['skills'], r'SKILL_NAME_SKILL_ID_(\d+)'),
            effects=by_label(table['effects'], r'SKILL_ID_(\d+)_HELP'),
            races={row['label']: row for row in table['races'].values() if not row['label'].startswith('NotUsed')},
            items={row['label']: row for row in table['items'].values() if row['label'].startswith('ITEM_UTSUSEMI_')})
    race_ids = {message(row, 'en'): key for key, row in tables['en']['races'].items()}
    race_ids['Qadistu'] = 'GROUP_ID_NYOMA'  # Official English spelling is Qadištu.
    item_ids = {}
    for key, row in tables['en']['items'].items():
        item_ids.setdefault(message(row, 'en'), []).append(key)
    quest_ids = {message(row, 'en'): row['label'] for row in raw['en']['tables']['quests'].values()
                 if row['label'].endswith('_name') and not row['label'].startswith('NotUsed') and any(row['pages'])}
    output.mkdir(parents=True, exist_ok=True)
    reports = []
    for language in LANGUAGES:
        table = tables[language]
        pack = {'language': language, 'source': raw[language]['source'], 'demons': {}, 'skills': {}, 'essences': {}, 'races': {}, 'aliases': {}}
        aliases = pack['aliases']
        quest_rows = {row['label']: row for row in raw[language]['tables']['quests'].values()}
        quests = {name: message(quest_rows[label], language) for name, label in quest_ids.items()}
        for condition in sorted(set(planner.RAW_UNLOCKS.values()) | set(planner.RAW_PREREQS.values())):
            aliases[translate_condition(condition)] = localize_condition(condition, language, quests)
        for demon in catalog['demons']:
            name = demon['name']
            identifier = profile_map[name]['gameId']
            suffix = re.search(r' ([A-HJ-Z])$', name)
            suffix = suffix[0] if suffix else ''
            translated = message(table['demons'][identifier], language) + suffix
            all_names = [message(t['demons'][identifier], lang) + suffix for lang, t in tables.items()]
            pack['demons'][name] = {'name': translated, 'description': message(table['profiles'][identifier], language, True), 'gameId': identifier, 'aliases': all_names,
                                    'raceAliases': [message(t['races'][race_ids[demon['race']]], lang) for lang, t in tables.items()]}
            aliases[demon['label']] = translated
        for race in sorted({d['race'] for d in catalog['demons']}):
            pack['races'][race] = message(table['races'][race_ids[race]], language)
            aliases[planner.label(race, 'race')] = pack['races'][race]
        for name, identifier in sorted(skill_ids.items()):
            translated = message(table['skills'][identifier], language)
            skill = {'name': translated, 'effect': expand_effect(table['effects'][identifier], skills_raw[str(identifier)], language), 'gameId': identifier,
                     'aliases': [message(t['skills'][identifier], lang) for lang, t in tables.items()]}
            pack['skills'][name] = skill
            aliases[planner.label(name, 'skill')] = translated
        for essence in catalog['essences']:
            name = essence['name']
            base = re.sub(r' ([A-HJ-Z])$', '', name)
            if name.startswith('Aogami '):
                expected = name + ' Essence'
            elif name.startswith('Tsukuyomi '):
                expected = "Tsukuyomi's Essence " + name.split(' ', 1)[1]
            else:
                expected = base + "'s Essence"
            expected = {'Qing Long': "Qinglong's Essence", 'Fionn mac Cumhaill': "Fionn's Essence",
                        'Tzitzimitl': "Tzitzimitl's 's Essence"}.get(base, expected)
            candidates = item_ids.get(expected, [])
            if not candidates:
                raise ValueError('No official essence identity for ' + name)
            localized = {message(table['items'][key], language) for key in candidates}
            if len(localized) != 1:
                raise ValueError('Ambiguous official essence identity for ' + name)
            suffix = name[len(base):] if base != name else ''
            translated = next(iter(localized)) + suffix
            pack['essences'][name] = {'name': translated, 'messageLabels': candidates,
                                     'aliases': [message(t['items'][candidates[0]], lang) + suffix for lang, t in tables.items()]}
            aliases[essence['label']] = translated
        aliases.pop('', None)
        path = output / (language + '.json')
        content = (json.dumps(pack, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
        path.write_bytes(content)
        reports.append({'language': language, 'demons': len(pack['demons']), 'skills': len(pack['skills']), 'essences': len(pack['essences']),
                        'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    return reports


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_dir', type=Path, help='Directory containing raw-<language>.json message-table exports')
    parser.add_argument('--output', type=Path, default=ROOT / 'web/assets/locales')
    args = parser.parse_args()
    print(json.dumps(build(args.source_dir, args.output), ensure_ascii=False, indent=2))
