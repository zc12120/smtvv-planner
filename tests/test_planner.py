import copy
import itertools
import unittest
from planner import *

class RulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.graph=FusionGraph(True)
    def test_all_pairs_are_commutative(self):
        for a,b in itertools.combinations(self.graph.demons,2):
            self.assertEqual(self.graph.calculate(a,b),self.graph.calculate(b,a),(a,b))
    def test_no_self_fusion(self):
        for n in self.graph.demons:self.assertIsNone(self.graph.fuse(n,n))
    def test_basic_reference_fixtures(self):
        fixtures=[('Pixie','Mandrake','Angel'),('Aeros','High Pixie','Pixie'),('Hayataro','Metatron','Garuda'),('Garuda','Sandman','Muu Shuwuu'),('Inugami','Take-Minakata','Hayataro')]
        for a,b,r in fixtures:self.assertEqual(self.graph.fuse(a,b),r)
    def test_special_reference_fixtures(self):
        cases={'Alice':['Muu Shuwuu','Poltergeist','Bugs',"Jack-o'-Lantern"],'Agrat':['Seth','Efreet','Queen Medb'],'Dagda':['Gogmagog','Skadi','Mithras'],'Konohana Sakuya':['Oyamatsumi','Kikuri-Hime','Zhuque']}
        for r,ins in cases.items():self.assertEqual(inspect_fusion({'materials':ins,'dlc':True})['result'],r)
    def test_special_elements_quarantined(self):
        result,reason=self.graph.calculate('Anahita','Aquans')
        self.assertEqual(result,'Parvati');self.assertTrue(reason)
    def test_upper_wrap_is_quarantined(self):
        result,reason=self.graph.calculate('Titania','Erthys')
        self.assertEqual(result,'Pixie');self.assertIn('循环',reason)
    def test_no_lower_wrap(self):self.assertIsNone(self.graph.fuse('Pixie','Aeros'))
    def test_special_result_skipped(self):self.assertEqual(self.graph.fuse('Pixie','Erthys'),"Jack-o'-Lantern")
    def test_dlc_individually_enabled(self):
        g=FusionGraph(['Dagda']);self.assertIn('Dagda',g.demons);self.assertNotIn('Konohana Sakuya',g.demons)
    def test_locked_element_not_produced(self):
        self.assertIsNone(FusionGraph(True,['Aeros']).fuse('Pixie','Jack Frost'))
    def test_accidents_have_no_deterministic_recipe(self):
        for n in ACCIDENTS:self.assertEqual(self.graph.reverse[n],[])
    def test_locked_changes_ranking_excluded_does_not(self):
        locked=FusionGraph(True,['Moloch'])
        pair=next(ins for n,ins in self.graph.recipes if n=='Moloch' and len(ins)==2 and not set(ins)&{'Moloch'})
        self.assertEqual(self.graph.fuse(*pair),'Moloch');self.assertNotEqual(locked.fuse(*pair),'Moloch')
        g,*_=settings({'dlc':True,'excluded':['Moloch']});self.assertEqual(g.fuse(*pair),'Moloch')
    def test_catalog_chinese_complete(self):
        data=catalog()
        for d in data['demons']:self.assertTrue(any('\u4e00'<=c<='\u9fff' for c in d['label']),d['name'])
        for s in data['skills']:self.assertTrue(any('\u4e00'<=c<='\u9fff' for c in s['label']),s['name'])

class RouteTests(unittest.TestCase):
    def test_mixed_unique_and_inherited(self):
        r=plan({'target':'Alice','skills':['Die For Me!','Megidolaon','Enduring Soul']})
        self.assertTrue(r['validated']);self.assertTrue(r['steps']);self.assertEqual(r['steps'][-1]['result'],'Alice');self.assertIn('Die For Me!',r['steps'][-1]['learn'])
    def test_native_skill_learning_level(self):
        r=plan({'target':'Pixie','skills':['Zan']});self.assertEqual(r['materials'][0]['level'],3);self.assertEqual(r['steps'],[])
    def test_unique_rejected_for_other_demon(self):
        with self.assertRaises(ValueError):plan({'target':'Pixie','skills':['Die For Me!']})
    def test_slots(self):
        with self.assertRaises(ValueError):plan({'target':'Alice','slots':1,'skills':['Agi','Bufu']})
    def test_unavailable_source_rejected(self):
        with self.assertRaises(ValueError):plan({'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Metatron'},'level':50})
    def test_source_cannot_lie(self):
        with self.assertRaises(ValueError):plan({'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Pixie'}})
    def test_source_is_carried(self):
        r=plan({'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Metatron'}})
        self.assertTrue(r['validated']);self.assertTrue(any(m['name']=='Metatron' and 'Megidolaon' in m['learn'] for m in r['materials']))
    def test_eight_skills(self):
        r=plan({'target':'Alice','skills':['Agi','Bufu','Zio','Zan','Dia','Tarukaja','Rakukaja','Sukukaja']})
        self.assertTrue(r['found']);self.assertTrue(r['validated']);self.assertEqual(len(r['steps'][-1]['keep']),8)
    def test_no_uncertain_steps_by_default(self):
        r=plan({'target':'Alice','skills':['Megidolaon','Enduring Soul']});self.assertTrue(all(not s['reason'] for s in r['steps']))
    def test_validator_rejects_corruption(self):
        request={'target':'Alice','skills':['Megidolaon','Enduring Soul']};r=plan(request);g,level,slots,excluded,uncertain=settings(request)
        bad=copy.deepcopy(r);bad['steps'][0]['inherit'].append('Die For Me!')
        with self.assertRaises(ValueError):validate_route(bad,g,request['skills'],{},level,slots,excluded,uncertain)
        bad=copy.deepcopy(r);bad['steps'][-1]['materialIds'][0]='missing'
        with self.assertRaises(ValueError):validate_route(bad,g,request['skills'],{},level,slots,excluded,uncertain)
    def test_dlc_explicitly_disabled(self):
        with self.assertRaises(ValueError):plan({'target':'Dagda','skills':[],'dlc':False})
    def test_unknown_and_duplicate_materials(self):
        with self.assertRaises(ValueError):inspect_fusion({'materials':['Pixie','Pixie']})
        with self.assertRaises(ValueError):inspect_fusion({'materials':['Pixie','No such demon']})

if __name__=='__main__':unittest.main()
