import unittest
from planner import UNLOCKS, PREREQS, RAW_UNLOCKS, RAW_PREREQS, ACCIDENTS, catalog, skill_detail

class UnlockTextTests(unittest.TestCase):
    def test_all_conditions_have_chinese_display(self):
        for text in [*UNLOCKS.values(),*PREREQS.values()]:self.assertNotRegex(text,r'[A-Za-z]')
        self.assertEqual(set(UNLOCKS),set(RAW_UNLOCKS));self.assertEqual(set(PREREQS),set(RAW_PREREQS))
    def test_screenshot_routes_are_alternatives(self):
        text=UNLOCKS['Ishtar'];self.assertIn('创世女神篇：随主线剧情解锁',text);self.assertIn('复仇女神篇：完成任务「特殊战斗训练·混沌军恶魔」',text)
        self.assertEqual(UNLOCKS['Surt'],text)
    def test_accident_mechanism_uses_original_flags(self):
        self.assertEqual(ACCIDENTS,{'Amabie','Hare of Inaba','Kinmamon'})
        self.assertEqual(RAW_PREREQS['Amabie'],'Fusion Accident')
    def test_alignment_not_misrepresented_as_route(self):
        self.assertIn('属性倾向为秩序',UNLOCKS['Maria']);self.assertIn('秩序路线',UNLOCKS['Michael'])
    def test_catalog_and_skill_details_share_translation(self):
        cat=catalog();ishtar=next(d for d in cat['demons'] if d['name']=='Ishtar');self.assertEqual(ishtar['unlock'],UNLOCKS['Ishtar'])
        for d in skill_detail('High Phys Pleroma')['demons']:self.assertNotRegex(d['unlock'],r'[A-Za-z]')

if __name__=='__main__':unittest.main()
