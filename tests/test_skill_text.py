import re
import unittest
from planner import catalog

class SkillDescriptions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.skills={s['name']:s for s in catalog()['skills']}
    def test_every_skill_has_chinese_description(self):
        self.assertEqual(len(self.skills),349)
        for name,s in self.skills.items():
            self.assertTrue(s['effectZh']);self.assertNotRegex(s['effectZh'],r'\$[12]|FMT|[A-Za-z]{3,}',name)
            self.assertIn('非官方',s['translationNote'],name)
    def test_recovery_power_not_flat_hp(self):
        s=self.skills['Dia'];self.assertIn('基础回复威力',s['detailZh']);self.assertIn('最大HP的15%',s['effectZh']);self.assertNotIn('恢复35点',s['effectZh'])
    def test_conditional_critical_power(self):
        s=self.skills['Akashic Arts'];self.assertIn('会心',s['effectZh']);self.assertIn('350',s['effectZh']);self.assertIn('275',s['detailZh'])
    def test_multi_hit_and_weakness_kill(self):
        s=self.skills['Die For Me!'];self.assertIn('2～6次',s['effectZh']);self.assertIn('命中弱点',s['effectZh']);self.assertIn('咒杀',s['effectZh'])
    def test_passive_survival_not_active_heal(self):
        s=self.skills['Enduring Soul'];self.assertIn('每场战斗限一次',s['effectZh']);self.assertIn('被动',s['costZh']);self.assertIn('全满HP',s['effectZh'])
    def test_damage_tiers_follow_game_wording(self):
        tiers={'Agi':'小','Agilao':'中','Agidyne':'大','Agibarion':'特大','Maragi':'小','Maragion':'中','Maragidyne':'大','Maragibarion':'特大','Megidolaon':'特大','Critical Slash':'小','Beatdown':'大','Ragnarok':'中',"Queen's Decree":'极小'}
        for name,tier in tiers.items():
            s=self.skills[name];self.assertIn(f'{tier}威力的',s['effectZh'],name);self.assertNotIn('1次',s['effectZh'],name)
        self.assertIn('进行4次小威力的物理属性攻击',self.skills['Hellish Slash']['effectZh'])
        self.assertIn('万能属性HP吸收攻击',self.skills['Life Drain']['effectZh'])
        self.assertIn('中～特大威力',self.skills['Megido Ark']['effectZh'])
    def test_base_mp_and_target(self):
        s=self.skills['Megidolaon'];self.assertEqual(s['costZh'],'120 MP');self.assertEqual(s['targetZh'],'敌方全体');self.assertIn('万能',s['effectZh'])

if __name__=='__main__':unittest.main()
