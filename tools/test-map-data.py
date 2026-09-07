import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('map_builder', Path(__file__).with_name('build-map-data.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class MapDataTests(unittest.TestCase):
    def test_main_parcel_area_with_hole(self):
        outer = [[0,0],[4,0],[4,4],[0,4],[0,0]]
        hole = [[1,1],[2,1],[2,2],[1,2],[1,1]]
        self.assertEqual(builder.geometry_area({'type':'Polygon','coordinates':[outer,hole]}),15)
        self.assertEqual(builder.geometry_area({'type':'MultiPolygon','coordinates':[[outer],[hole]]}),17)

    def test_cancelled_and_same_day(self):
        rows = {'2026': [[8, 1, 120000, 4], [8, 2, 150000, 5, 2], [8, 1, 100000, 6, 1]]}
        self.assertEqual(builder.latest(rows), [20260801, 120000, 4, 0, 2])
        self.assertIsNone(builder.latest({'2026': [[0, 0, 1, 1], [9, 1, 1, 2, 2]]}))

    def test_identity_parcels_lifecycle_and_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            def write(name, data):
                target = site / 'data' / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(data), encoding='utf-8')
            rows = [dict(i=i, n='동명아파트', r=0, g='도시', d='동', j=str(i), a=59+i, b=2000,
                         **{'as': 'A' if i<2 else 'B'}) for i in range(3)]
            write('index.json', {'meta': {'updated': '2026-09-08'}, 'd': rows})
            write('parcels.json', {'meta': {'indexRows': 3}, 'd': {'0': {'p': ['1'*19]}, '1': {'p': ['2'*19]}}})
            write('building-status.json', {'sites': {}})
            write('redevelopment-relations.json', {'relations': []})
            write('tx/도시.json', {'entries': {'0': {'2026': [[8,1,5000,3]]}}})
            write('monthly/도시.json', {})
            result, unresolved = builder.build(site)
            self.assertEqual(len(result['d']), 2, 'same-name different aptSeq stays separate')
            self.assertEqual(result['d'][0]['pnus'], ['1'*19, '2'*19])
            self.assertIsNone(result['d'][0]['coord'], 'no district centroid fallback')
            self.assertEqual(len(unresolved), 2)
            builder.validate(site)
            write('tx/도시.json', {})
            with self.assertRaisesRegex(ValueError, 'source changed'):
                builder.validate(site)


if __name__ == '__main__':
    unittest.main()
