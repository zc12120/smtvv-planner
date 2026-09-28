import unittest
from optimal import OptimalSearch
from test_routes import brute

class UnboundedOptimalTests(unittest.TestCase):
    def tiny(self,skills):
        s=OptimalSearch({'objective':'all','target':'Angel','skills':skills})
        keep={'Angel','Pixie','Mandrake','Slime','Preta','Onmoraki','Daemon','Gremlin','Kodama','Agathion','Apsaras','Sandman'}
        for n in list(s.reverse):s.reverse[n]=[ins for ins in s.reverse[n] if n in keep and all(x in keep for x in ins)]
        return s
    def test_matches_all_trees_in_acyclic_subgraph(self):
        # This graph's longest material tree contains three fusion nodes.
        for selected in [[],['Agi','Dia']]:
            s=self.tiny(selected);all_trees=brute(s,3);self.assertGreater(len(all_trees),0);s.run();self.assertFalse(s.error);self.assertTrue(s.complete)
            shortest=min((t[4],t[3]) for t in all_trees);cheapest=min((t[3],t[4]) for t in all_trees)
            r=s.solutions['shortest'];self.assertEqual((r['stepCount'],r['totalCost']),shortest)
            r=s.solutions['cheapest'];self.assertEqual((r['totalCost'],r['stepCount']),cheapest)
    def test_screenshot_build_without_depth_bound(self):
        s=OptimalSearch({'objective':'all','target':'Yoshitsune','maxSteps':1,'skills':['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']});s.run()
        self.assertTrue(s.complete,s.error);self.assertEqual(set(s.solutions),{'cheapest','shortest','mixed'})
        self.assertEqual(s.solutions['shortest']['stepCount'],4)
        self.assertGreater(s.solutions['cheapest']['stepCount'],6)
        self.assertLess(s.solutions['cheapest']['totalCost'],s.solutions['shortest']['totalCost'])
        for r in s.solutions.values():self.assertTrue(r['validated']);self.assertEqual(len(r['skills']),8)
    def test_zero_prices_and_cycles_terminate(self):
        s=OptimalSearch({'objective':'all','target':'Angel','skills':[],'starting':['Pixie','Mandrake'],'prices':{'Pixie':0,'Mandrake':0}});s.run()
        self.assertTrue(s.complete);self.assertEqual(s.solutions['cheapest']['totalCost'],0);self.assertEqual(s.solutions['cheapest']['stepCount'],1)
    def test_dlc_default_enabled(self):
        s=OptimalSearch({'objective':'all','target':'Dagda','skills':[]});self.assertIn('Dagda',s.graph.demons);self.assertIn('Konohana Sakuya',s.graph.demons);s.run();self.assertTrue(s.solutions['shortest']['stepCount']>=1)
    def test_goal_not_a_leaf(self):
        s=self.tiny([]);s.run()
        for r in s.solutions.values():self.assertTrue(r['steps']);self.assertTrue(all(m['name']!='Angel' for m in r['materials']))
    def test_unreachable_proved(self):
        s=OptimalSearch({'objective':'all','target':'Angel','skills':['Agi'],'starting':[]});s.run();self.assertTrue(s.complete);self.assertEqual(s.solutions,{})
    def test_source_constraints_preserved(self):
        s=OptimalSearch({'objective':'all','target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Metatron'}});s.run()
        self.assertTrue(s.complete)
        for r in s.solutions.values():self.assertTrue(any(m['name']=='Metatron' for m in r['materials']) or any(step['result']=='Metatron' or step.get('essence')=='Metatron' for step in r['steps']))

class OnDemandObjectives(unittest.TestCase):
    def test_default_never_builds_pure_fusion_problem(self):
        from unittest.mock import patch
        with patch.object(OptimalSearch,'problem',side_effect=AssertionError('unrequested pure fusion search')):
            job=OptimalSearch({'target':'Angel','skills':['Agi','Dia']});job.run()
        self.assertTrue(job.complete,job.error)
        self.assertEqual(job.snapshot()['computedObjectives'],['mixed'])
        self.assertEqual(set(job.solutions),{'mixed'})

    def test_requested_results_match_all_without_running_mixed_for_pure_routes(self):
        from unittest.mock import patch
        request={'target':'Angel','skills':['Agi','Dia']}
        all_routes=OptimalSearch({**request,'objective':'all'});all_routes.run()
        for mode,keys in [('shortest',['shortest']),('cheapest',['shortest','cheapest'])]:
            with patch('mixed.solve',side_effect=AssertionError('unrequested mixed search')):
                job=OptimalSearch({**request,'objective':mode});job.run()
            self.assertTrue(job.complete,job.error)
            self.assertEqual(job.computed_objectives,keys)
            for key in keys:self.assertEqual(job.solutions[key],all_routes.solutions[key])

    def test_infeasible_is_marked_computed_and_invalid_objective_rejected(self):
        job=OptimalSearch({'target':'Angel','starting':[]});job.run()
        self.assertTrue(job.complete,job.error)
        self.assertEqual(job.solutions,{})
        self.assertEqual(job.computed_objectives,['mixed'])
        with self.assertRaises(ValueError):OptimalSearch({'target':'Angel','objective':[]})

if __name__=='__main__':unittest.main()
