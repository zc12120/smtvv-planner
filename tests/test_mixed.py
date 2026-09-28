import copy
import unittest
from essences import ESSENCES,candidates
from optimal import OptimalSearch
from mixed import problem,validate

BUILD=['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']
class MixedRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.job=OptimalSearch({'objective':'all','target':'Yoshitsune','skills':BUILD});cls.job.run()
        if cls.job.error:raise RuntimeError(cls.job.error)
        cls.route=cls.job.solutions['mixed']
    def test_all_three_and_free_essences(self):
        self.assertEqual(set(self.job.solutions),{'cheapest','mixed','shortest'})
        r=self.route;self.assertTrue(r['allEssencesOwned']);self.assertEqual(r['essenceCost'],0)
        self.assertEqual(r['totalCost'],sum(m['price'] for m in r['materials']))
    def test_joint_search_beats_post_target_only(self):
        masks=[m for m,e in candidates(self.job.skills,{})];full=self.job.full;cost={0:0}
        for state in range(full+1):
            if state in cost:
                for m in masks:cost[state|m]=min(cost.get(state|m,999),cost[state]+1)
        self.assertEqual(cost[full],4)
        self.assertLess(self.route['operationCount'],1+cost[full])
        self.assertEqual(self.route['fusionCount'],1);self.assertEqual(self.route['essenceCount'],3)
        self.assertTrue(any(s['type']=='essence' and s['result']!='Yoshitsune' for s in self.route['steps']))
    def test_unique_skill_not_granted_by_essence(self):
        for e in ESSENCES.values():self.assertNotIn('Hassou Tobi',e['skills'])
        self.assertTrue(all('Hassou Tobi' not in s.get('grant',[]) for s in self.route['steps']))
        self.assertEqual(self.route['skillSources']['Hassou Tobi'][0]['name'],'Yoshitsune')
    def test_essence_original_sources_retained_after_fusion(self):
        sources=self.route['skillSources']['Abyssal Mask'];self.assertTrue(sources)
        self.assertTrue(all(x['kind']=='essence' and '灵体' in x['label'] for x in sources))
        self.assertIn('Abyssal Mask',self.route['steps'][-1]['inherit'])
    def test_corrupt_essence_transfer_rejected(self):
        bad=copy.deepcopy(self.route);step=next(s for s in bad['steps'] if s['type']=='essence');step['grant'].append('Hassou Tobi')
        with self.assertRaises(ValueError):validate(self.job,bad)
    def test_essence_preserves_the_carriers_trained_level(self):
        levels={m['id']:m['level'] for m in self.route['materials']}
        trained=False
        from planner import PLAYABLE
        for step in self.route['steps']:
            if step['type']=='essence':
                self.assertEqual(step['level'],levels[step['sourceId']])
                trained|=step['level']>PLAYABLE[step['result']]['lvl']
            levels[step['id']]=step['level']
        self.assertTrue(trained,'the eight-skill fixture must include a trained essence carrier')
    def test_replay_rejects_an_essence_resetting_the_carriers_level(self):
        from planner import PLAYABLE
        bad=copy.deepcopy(self.route)
        step=next(s for s in bad['steps'] if s['type']=='essence' and s['level']>PLAYABLE[s['result']]['lvl'])
        step['level']=PLAYABLE[step['result']]['lvl']
        with self.assertRaises(ValueError):validate(self.job,bad)
    def test_essence_sources_ignore_material_level_and_lock(self):
        j=OptimalSearch({'target':'Angel','level':10,'locked':['Marici'],'skills':['High Phys Pleroma']});j.run()
        self.assertTrue(j.complete,j.error);self.assertIn('mixed',j.solutions);self.assertTrue(j.solutions['mixed']['validated'])
    def test_reference_relaxation_matches_native_on_small_graph(self):
        j=OptimalSearch({'target':'Angel','skills':['Agi','Dia'],'starting':['Pixie','Mandrake']})
        keep={'Angel','Pixie','Mandrake','Slime','Preta','Onmoraki','Daemon','Gremlin','Kodama','Agathion','Apsaras','Sandman'}
        for n in list(j.reverse):j.reverse[n]=[ins for ins in j.reverse[n] if n in keep and all(x in keep for x in ins)]
        names,count,text=problem(j);lines=text.splitlines();n,real,bits,goal,_=map(int,lines[0].split());native=list(map(int,lines[1].split()));prices=list(map(int,lines[2].split()));arcs=[tuple(map(int,x.split())) for x in lines[3:]]
        dist=[{} for _ in range(n)]
        for i,p in enumerate(prices):
            if p>=0:dist[i][native[i]]=(0,p)
        changed=True
        while changed:
            changed=False
            for a,b,r,weight in arcs:
                for ma,wa in list(dist[a].items()):
                    for mb,wb in list(dist[b].items()):
                        mask=ma|mb|native[r];value=(wa[0]+wb[0]+weight,wa[1]+wb[1])
                        if value<dist[r].get(mask,(float('inf'),float('inf'))):dist[r][mask]=value;changed=True
        expected=dist[goal][(1<<bits)-1];j.run();self.assertFalse(j.error)
        result=j.solutions['mixed'];self.assertEqual((result['operationCount'],result['totalCost']),expected)

if __name__=='__main__':unittest.main()
