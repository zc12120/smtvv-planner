import hashlib
import json
from pathlib import Path
import re
import unittest

from planner import catalog, PLAYABLE

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless((ROOT/'data/demon-profiles.json').is_file() and
                     (ROOT/'web/assets/demons/manifest.json').is_file(),
                     'Optional local game resource pack is not installed')
class OfficialDemonProfiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profiles = json.loads((ROOT / 'data/demon-profiles.json').read_text())
        cls.portraits = json.loads((ROOT / 'web/assets/demons/manifest.json').read_text())
        cls.data = catalog()
        cls.demons = {d['name']: d for d in cls.data['demons']}

    def test_all_playable_demons_have_verified_official_profiles(self):
        self.assertEqual(self.profiles['count'], 275)
        self.assertEqual(set(self.profiles['demons']), set(PLAYABLE))
        self.assertEqual(self.data['demonProfileSource']['kind'], 'official-game-text')
        self.assertEqual(self.data['demonProfileSource']['language'], 'zh-Hans')
        self.assertEqual(self.data['demonProfileSource']['pakIndexSha1'], self.portraits['source']['pakIndexSha1'])
        for name, profile in self.profiles['demons'].items():
            with self.subTest(demon=name):
                portrait = self.portraits['demons'][name]
                self.assertEqual(profile['gameId'], portrait['gameId'])
                self.assertEqual(profile['officialNameEn'], portrait['officialEnglishName'])
                self.assertEqual(int(re.match(r'DEVIL_ID_(\d+)', profile['messageLabel'])[1]), profile['gameId'])
                self.assertTrue(profile['officialNameZh'])
                self.assertEqual(len(profile['pages']), len(profile['localizationKeys']))
                self.assertGreater(len(self.demons[name]['descriptionZh']), 25)
                self.assertIn('官方简体中文原文', self.demons[name]['descriptionSource'])

    def test_display_preserves_every_original_character_except_layout_whitespace(self):
        for name, profile in self.profiles['demons'].items():
            with self.subTest(demon=name):
                raw = ''.join(profile['pages'])
                displayed = self.demons[name]['descriptionZh']
                self.assertEqual(re.sub(r'\s', '', raw), re.sub(r'\s', '', displayed))
                self.assertNotRegex(displayed, r'NOT USED|\ufffd|[<>\x00]')
                digest = hashlib.sha256(json.dumps(profile['pages'], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
                self.assertEqual(digest, profile['textSha256'])

    def test_distinct_forms_and_vengeance_lilith_use_their_own_records(self):
        self.assertIn('力量远不及其真正的实力', self.demons['Nuwa A']['descriptionZh'])
        self.assertNotIn('力量远不及其真正的实力', self.demons['Nuwa']['descriptionZh'])
        self.assertIn('她刻意堕天', self.demons['Abdiel A']['descriptionZh'])
        self.assertNotIn('她刻意堕天', self.demons['Abdiel']['descriptionZh'])
        lilith = self.profiles['demons']['Lilith']
        self.assertEqual(lilith['gameId'], 391)
        self.assertIn('四女魔之首', self.demons['Lilith']['descriptionZh'])
        self.assertIn('达奴神族', self.demons['Dagda']['descriptionZh'])
        self.assertIn('“皮克希捣蛋”', self.demons['Pixie']['descriptionZh'])


if __name__ == '__main__':
    unittest.main()
