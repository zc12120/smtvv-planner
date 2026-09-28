import itertools
import time
import unittest
from functools import lru_cache
from routes import RouteSearch, budgets, BASE_PRICES

# Independent explicit enumeration on a tiny legal subgraph. No DP assignment
# or ranking code is used here; it directly builds and filters every tree.
def brute(search,max_steps):
    @lru_cache(None)
    def trees(name,k):
        if k==0:
            if name==search.target or search.starting is not None and name not in search.starting:return ()
            return ((name,(),search.native[name],search.prices[name],0),)
        out=[]
        def splits(total,n):
            if n==1:yield (total,);return
            for first in range(total+1):
                for rest in splits(total-first,n-1):yield (first,)+rest
        for ingredients in search.reverse[name]:
            for sizes in splits(k-1,len(ingredients)):
                for children in itertools.product(*(trees(n,s) for n,s in zip(ingredients,sizes))):
                    mask=search.native[name]
                    for child in children:mask|=child[2]
                    out.append((name,children,mask,sum(c[3] for c in children),k))
        return tuple(out)
    return [t for k in range(1,max_steps+1) for t in trees(search.target,k) if t[2]&search.full==search.full]

def signature(tree):return (tree.name,tuple(signature(t) for t in tree.children))
def brute_signature(tree):return (tree[0],tuple(brute_signature(t) for t in tree[1]))

class AllRoutesTests(unittest.TestCase):
    def tiny(self,skills):
        s=RouteSearch({'target':'Angel','skills':skills,'maxSteps':3})
        keep={'Angel','Pixie','Mandrake','Slime','Preta','Onmoraki','Daemon','Gremlin','Kodama','Agathion','Apsaras','Sandman'}
        for n in list(s.reverse):s.reverse[n]=[ins for ins in s.reverse[n] if n in keep and all(x in keep for x in ins)]
        return s
    def compare(self,skills):
        s=self.tiny(skills);expected=brute(s,3);self.assertGreater(len(expected),0);s.run();self.assertTrue(s.complete)
        self.assertEqual(sum(n.count for n in s.roots.values()),len(expected))
        actual=[s.ranked('cost',i) for i in range(len(expected))]
        self.assertEqual(sorted((t.cost,t.steps) for t in actual),sorted((t[3],t[4]) for t in expected))
        self.assertEqual({signature(t) for t in actual},{brute_signature(t) for t in expected})
        self.assertEqual(len(actual),len({signature(t) for t in actual}))
        self.assertEqual([(t.cost,t.steps) for t in actual],sorted((t.cost,t.steps) for t in actual))
        for t in actual[:10]:self.assertTrue(s.materialize(t)['validated'])
    def test_all_material_trees_match_bruteforce(self):self.compare([])
    def test_overlapping_skill_sources_not_double_counted(self):self.compare(['Agi','Dia'])
    def test_goal_always_requires_fusion(self):
        s=RouteSearch({'target':'Yoshitsune','skills':[],'maxSteps':1});s.run();r=s.snapshot(limit=5)
        self.assertTrue(r['complete']);self.assertTrue(r['routes']);self.assertTrue(all(x['stepCount']==1 for x in r['routes']))
        self.assertTrue(all(m['name']!='Yoshitsune' for x in r['routes'] for m in x['materials']))
    def test_shortest_and_cheapest_differ(self):
        s=RouteSearch({'target':'Yoshitsune','skills':[],'maxSteps':3});s.run()
        shortest=s.ranked('steps',0);cheapest=s.ranked('cost',0)
        self.assertEqual(shortest.steps,1);self.assertGreater(cheapest.steps,1);self.assertLess(cheapest.cost,shortest.cost)
        r=s.snapshot(order='cost',limit=1);self.assertTrue(r['routes'][0]['cheapest']);self.assertFalse(r['routes'][0]['shortest'])
    def test_custom_costs_and_zero_cost(self):
        s=RouteSearch({'target':'Angel','skills':[],'maxSteps':1,'starting':['Pixie','Mandrake'],'prices':{'Pixie':0,'Mandrake':123}});s.run();r=s.snapshot(limit=10)
        self.assertEqual(r['total'],'1');self.assertEqual(r['minimumCost'],123);self.assertEqual(r['routes'][0]['totalCost'],123)
    def test_page_sort_no_missing_or_duplicate(self):
        s=self.tiny([]);s.run();r1=s.snapshot(limit=5,order='cost');r2=s.snapshot(offset=5,limit=5,order='cost')
        costs=[x['totalCost'] for x in r1['routes']+r2['routes']];self.assertEqual(costs,sorted(costs));self.assertEqual(r2['offset'],'5')
    def test_forced_sources(self):
        s=RouteSearch({'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Metatron'},'maxSteps':3});s.run();r=s.snapshot(limit=5)
        self.assertTrue(r['routes'])
        for route in r['routes']:
            self.assertTrue(any(m['name']=='Metatron' for m in route['materials']) or any(x['result']=='Metatron' for x in route['steps']))
    def test_timeout_not_claimed_complete(self):
        s=RouteSearch({'target':'Yoshitsune','skills':[],'maxSteps':6});s.deadline=time.monotonic()-1;s.run();self.assertFalse(s.complete);self.assertTrue(s.finished)
    def test_invalid_prices(self):
        with self.assertRaises(ValueError):RouteSearch({'target':'Angel','prices':{'Pixie':-1}})
        with self.assertRaises(ValueError):RouteSearch({'target':'Angel','prices':{'Pixie':1.2}})
    def test_invalid_skill_source(self):
        with self.assertRaises(ValueError):RouteSearch({'target':'Alice','skills':['Megidolaon'],'sources':{'Megidolaon':'Pixie'}})

if __name__=='__main__':unittest.main()
