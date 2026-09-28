import unittest
from planner import skill_detail,catalog,transferable,plan

class SkillDetailTests(unittest.TestCase):
    def test_slime_skill_details_and_sources(self):
        for name in ['Lunge','Dustoma','Poisma']:
            d=skill_detail(name);self.assertTrue(d['effectZh']);self.assertTrue(any(e['name']=='Slime' for e in d['essences']))
        self.assertIn('物理',skill_detail('Lunge')['effectZh'])
    def test_all_linked_essence_skills_have_details(self):
        names={s['name'] for e in catalog()['essences'] for s in e['skills']}
        self.assertEqual(len(names),377)
        for n in names:self.assertEqual(skill_detail(n)['name'],n)
    def test_protagonist_skill_restriction(self):
        d=skill_detail('Murakumo');self.assertTrue(d['unique']);self.assertIn('创毘专用',d['restriction']);self.assertFalse(d['demons']);self.assertTrue(d['essences'])
    def test_unknown_skill(self):
        with self.assertRaises(ValueError):skill_detail('not a skill')
    def test_variable_hit_skill_not_zero_attacks(self):
        d=skill_detail('Lunar Hurricane');self.assertNotIn('0次',d['effectZh']);self.assertIn('最多9次',d['effectZh'])
    def test_every_demon_has_a_linkable_innate_with_chinese_effect(self):
        data=catalog()
        innates={s['name']:s for s in data['innateSkills']}
        self.assertEqual(len(innates),160)
        self.assertEqual({d['innateId'] for d in data['demons']},set(innates))
        for demon in data['demons']:
            with self.subTest(demon=demon['name']):
                skill=skill_detail(demon['innateId'])
                self.assertEqual(skill['label'],demon['innate'])
                self.assertEqual(skill['effectZh'],innates[skill['name']]['effectZh'])
                self.assertIn(demon['name'],[d['name'] for d in skill['demons']])
                self.assertTrue(skill['effectZh'])
                self.assertNotRegex(skill['effectZh'],r'\$[12]|FMT|[A-Za-z]{3,}')
                self.assertEqual(skill['element'],'innate')
                self.assertIn('非官方',skill['translationNote'])
    def test_innate_conditions_and_shared_holders(self):
        skill=skill_detail('Elec Enhancer')
        self.assertIn('电击技能适合度',skill['effectZh'])
        self.assertIn('低于自身',skill['effectZh'])
        self.assertEqual({d['name'] for d in skill['demons']},{'Erthys','Thor'})
        self.assertIn('5%',skill_detail('Give Me Your Soul!')['effectZh'])
        self.assertIn('每回合限一次',skill_detail('Give Me Your Soul!')['effectZh'])
        self.assertIn('能力弱化',skill_detail('Give Me Your Soul!')['effectZh'])
    def test_innates_cannot_be_selected_or_transferred(self):
        data=catalog()
        selectable={s['name'] for s in data['skills']}
        for skill in data['innateSkills']:
            self.assertNotIn(skill['name'],selectable)
            self.assertFalse(transferable(skill['name']))
            detail=skill_detail(skill['name'])
            self.assertTrue(detail['unique'])
            self.assertFalse(detail['essences'])
            self.assertIn('不可继承',detail['restriction'])
        with self.assertRaisesRegex(ValueError,'不可继承'):
            plan({'target':'Erthys','skills':['Elec Enhancer']})

if __name__=='__main__':unittest.main()
