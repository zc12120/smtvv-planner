import hashlib
import json
from pathlib import Path
import struct
import unittest

from planner import PLAYABLE, catalog

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless((ROOT/'data/demon-traits.json').is_file() and
                     (ROOT/'web/assets/ailments/manifest.json').is_file(),
                     'Optional local game verification fixtures are not installed')
class NativeDemonTraits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT/'data/demon-traits.json').read_text())
        cls.demons = {d['name']:d for d in catalog()['demons']}

    def test_all_demons_have_verified_initial_potentials_and_six_ailments(self):
        self.assertEqual(self.data['count'],275)
        self.assertEqual(set(self.data['demons']),set(PLAYABLE))
        self.assertEqual(self.data['affinityOrder'],['phy','fir','ice','ele','for','lig','dar','alm','ail','rec','sup'])
        self.assertEqual(self.data['ailmentOrder'],['cha','sea','pan','poi','sle','mir'])
        for name,raw in self.data['demons'].items():
            with self.subTest(demon=name):
                d=self.demons[name]
                self.assertEqual(len(d['affinities']),11)
                self.assertEqual(d['affinities'],raw['affinities'])
                self.assertEqual(d['ailments'],raw['ailments'])
                self.assertEqual(d['ailments'],PLAYABLE[name].get('ailments','------'))
                self.assertRegex(d['ailments'],r'^[wsn-]{6}$')
                self.assertEqual(len(raw['nativeRowSha256']),2)

    def test_distinct_potential_and_ailment_categories_are_not_swapped(self):
        erthys=self.demons['Erthys']
        self.assertEqual(erthys['affinities'][3:5],[3,-4])
        self.assertEqual(erthys['ailments'],'------')
        self.assertEqual(self.demons['Alice']['affinities'][9:],[-2,0])
        self.assertEqual(self.demons['Pixie']['ailments'],'--w---')
        self.assertEqual(self.demons['Nuwa']['ailments'],'n-----')
        self.assertEqual(self.demons['Abaddon']['ailments'],'-w---s')
        self.assertEqual(self.data['ailmentNativeColumns']['mir'],20)

    def test_all_six_native_ailment_icons_are_distinct_and_intact(self):
        folder=ROOT/'web/assets/ailments'
        # The current lossless atlas builder records both icon groups in the
        # elements manifest. The original ailments manifest describes older crops.
        combined=ROOT/'web/assets/elements/manifest.json'
        manifest=json.loads(combined.read_text()) if combined.exists() else {}
        if manifest.get('schemaVersion')==1 and 'ailments/cha.png' in manifest.get('icons',{}):
            self.assertFalse(manifest['resampled'])
            self.assertTrue(manifest['pngPixelsLossless'])
            icons={Path(name).stem:{**icon,'file':Path(name).name} for name,icon in manifest['icons'].items()
                   if name.startswith('ailments/')}
        else:
            icons=json.loads((folder/'manifest.json').read_text())['icons']
        self.assertEqual(set(icons),set(self.data['ailmentOrder']))
        self.assertEqual(len({d['pixelSha256'] for d in icons.values()}),6)
        for key,icon in icons.items():
            with self.subTest(icon=key):
                png=(folder/icon['file']).read_bytes()
                self.assertEqual(png[:8],b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('>II',png[16:24]),(icon['width'],icon['height']))
                self.assertEqual(hashlib.sha256(png).hexdigest(),icon['sha256'])


if __name__=='__main__':
    unittest.main()
