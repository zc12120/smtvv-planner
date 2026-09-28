"""Optional offline builds preserve source artwork and its exact full-size pixels."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest


@unittest.skipUnless(importlib.util.find_spec('PIL'), 'install requirements-assets.txt for asset-build tests')
class PortraitBuildTests(unittest.TestCase):
    def test_variants_preserve_alpha_pixels_dimensions_sources_and_shared_identity(self):
        from PIL import Image
        from scripts.optimize_images import optimize

        with tempfile.TemporaryDirectory() as temporary:
            assets = Path(temporary)
            display = assets / 'demons/display'
            display.mkdir(parents=True)
            source = display / 'shared.png'
            pixels = Image.new('RGBA', (256, 320))
            pixels.putdata([(x % 256, (x * 7) % 256, (x * 11) % 256, (x * 13) % 256)
                            for x in range(pixels.width * pixels.height)])
            pixels.save(source)
            original = source.read_bytes()
            record = {'src': '/assets/demons/shared.png', 'width': 512, 'height': 512,
                      'pictureId': 389, 'display': {'src': '/assets/demons/display/shared.png', 'width': 256, 'height': 320}}
            manifest = assets / 'demons/manifest.json'
            manifest.write_text(json.dumps({'demons': {'One': record}, 'essences': {'Two': record}}))
            result = optimize(assets)
            self.assertEqual((result['portraits'], result['uniqueSources']), (2, 1))
            built = json.loads(manifest.read_text())
            self.assertEqual(built['demons']['One'], built['essences']['Two'])
            self.assertEqual(built['demons']['One']['pictureId'], 389)
            variants = built['demons']['One']['optimized']['variants']
            self.assertEqual([item['width'] for item in variants], [96, 192, 256])
            timestamps = []
            for item in variants:
                file = assets / item['src'].removeprefix('/assets/')
                timestamps.append(file.stat().st_mtime_ns)
                with Image.open(file) as decoded:
                    self.assertEqual(decoded.format, 'WEBP')
                    self.assertEqual(decoded.size, (item['width'], item['height']))
                    if item['width'] == pixels.width:
                        self.assertEqual(decoded.convert('RGBA').tobytes(), pixels.tobytes())
            optimize(assets)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(json.loads(manifest.read_text()), built)
            self.assertEqual(timestamps, [(assets / item['src'].removeprefix('/assets/')).stat().st_mtime_ns for item in variants])

    def test_missing_assets_are_optional(self):
        from scripts.optimize_images import optimize

        with tempfile.TemporaryDirectory() as temporary:
            self.assertEqual(optimize(Path(temporary))['portraits'], 0)


@unittest.skipUnless(importlib.util.find_spec('fontTools'), 'install requirements-assets.txt for font-coverage tests')
class FontCoverageTests(unittest.TestCase):
    def test_subsets_and_fallbacks_partition_every_original_glyph(self):
        from fontTools.ttLib import TTFont
        from scripts.build_font_subsets import FACES, ROOT

        web = ROOT / 'web'
        css = (web / 'auth/theme/fonts-optimized.css').read_text()
        rules = re.findall(r'@font-face\s*\{([^}]+)\}', css)
        declarations = [dict(part.strip().split(':', 1) for part in rule.split(';') if ':' in part) for rule in rules]
        for family, _, relative, weight in FACES:
            with self.subTest(family=family, weight=weight):
                covered = set()
                with TTFont(web / relative) as original:
                    available = set(original.getBestCmap())
                matches = [rule for rule in declarations if rule['font-family'].strip(" '\"") == family and rule['font-weight'].strip() == weight]
                self.assertTrue(matches)
                for rule in matches:
                    points = set()
                    for group in rule['unicode-range'].strip().split(','):
                        ends = group.removeprefix('U+').split('-')
                        first, last = int(ends[0], 16), int(ends[-1], 16)
                        points.update(range(first, last + 1))
                    self.assertFalse(points & covered, 'font download ranges must not overlap')
                    covered.update(points)
                    url = re.search(r"url\('/([^']+)'\)", rule['src']).group(1)
                    with TTFont(web / url) as subset:
                        self.assertLessEqual(points, set(subset.getBestCmap()))
                self.assertEqual(covered, available, 'arbitrary original glyphs remain available')


if __name__ == '__main__':
    unittest.main()
