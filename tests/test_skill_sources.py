import unittest
from optimal import OptimalSearch

class SourceCorrespondence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        job=OptimalSearch({'objective':'all','target':'Yoshitsune','skills':['Hassou Tobi','Abyssal Mask','Safeguard','Dragon Eye','High Phys Pleroma','Phys Pleroma','High Restore','Enduring Soul']});job.run()
        if job.error:raise RuntimeError(job.error)
        cls.routes={k:r for k,r in job.solutions.items() if k!='mixed'}
    def test_screenshot_immediate_carriers(self):
        step=self.routes['shortest']['steps'][0]
        self.assertEqual(step['result'],'Marici')
        self.assertEqual(step['inheritSources']['Safeguard'],[{'name':'Siegfried','id':'m2'}])
        self.assertEqual(step['inheritSources']['Enduring Soul'],[{'name':'Siegfried','id':'m2'}])
        self.assertEqual(step['inheritSources']['Dragon Eye'],[{'name':'Yamata-no-Orochi','id':'m3'}])
        self.assertEqual(step['learnSources']['High Phys Pleroma']['name'],'Marici')
        self.assertEqual(step['learnSources']['High Phys Pleroma']['level'],82)
    def test_immediate_and_original_sources_are_distinct(self):
        r=self.routes['shortest'];last=r['steps'][-1]
        self.assertEqual(last['inheritSources']['Dragon Eye'][0]['name'],'Bishamonten')
        self.assertEqual(r['skillSources']['Dragon Eye'][0]['name'],'Yamata-no-Orochi')
        self.assertTrue(r['skillSources']['Hassou Tobi'][0]['initial'])
    def test_every_source_is_a_real_material_instance_holding_skill(self):
        for r in self.routes.values():
            known={m['id']:(m['name'],set(m['learn'])) for m in r['materials']}
            for step in r['steps']:
                self.assertEqual(set(step['inheritSources']),set(step['inherit']))
                self.assertEqual(set(step['learnSources']),set(step['learn']))
                for skill,donors in step['inheritSources'].items():
                    expected={mid for mid in step['materialIds'] if skill in known[mid][1]}
                    self.assertEqual({d['id'] for d in donors},expected)
                    self.assertTrue(expected)
                    for d in donors:self.assertEqual(d['name'],known[d['id']][0])
                known[step['id']]=(step['result'],set(step['keep']))
            self.assertEqual(set(r['skillSources']),set(r['skills']))

if __name__=='__main__':unittest.main()
