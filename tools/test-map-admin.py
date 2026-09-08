import gzip
import json
import tempfile
import unittest
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import box, mapping
from map_admin_data import build_admin, validate_admin


class AdminTests(unittest.TestCase):
    def fixture(self, root, overlap=False):
        x, y = Transformer.from_crs(4326, 5179, always_xy=True).transform(127, 37.5)
        outer = box(x-100, y-100, x+100, y+100)
        shapes = [('11','서울특별시',outer), ('11110','서울특별시 시험구',outer),
                  ('11110510','서울특별시 시험구 시험1동',outer),
                  ('11110520','서울특별시 시험구 시험2동',outer if overlap else box(x+200,y+200,x+300,y+300))]
        features = [{'type':'Feature','properties':{'adm_cd':code,'adm_nm':name,'x':str(x),'y':str(y)},'geometry':mapping(g)} for code,name,g in shapes]
        path = root / 'source.gz'
        path.write_bytes(gzip.compress(json.dumps({'meta':{'source':'SGIS','year':2025,'crs':'EPSG:5179'},'features':features}).encode()))
        return path

    def test_hierarchy_missing_coordinates_and_same_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            rows=[{'id':s,'n':s,'r':1,'g':'시험구','coord':coord} for s,coord in [('A',[37.5,127]),('B',[37.5,127]),('missing',None)]]
            meta,sources,missing=build_admin(root,rows,self.fixture(root))
            self.assertEqual(rows[0]['admin'],['11','11110','11110510'])
            self.assertEqual(rows[1]['admin'],rows[0]['admin'])
            self.assertEqual(rows[2]['admin'],['11','11110'])
            self.assertEqual([r['id'] for r in missing],['missing'])
            payload={'d':rows,'admin':meta,'meta':{'sources':sources}}
            validate_admin(payload)
            rows[0]['admin']=['11','11110510','11110520']
            with self.assertRaisesRegex(ValueError,'hierarchy'):
                validate_admin(payload)

    def test_overlapping_dong_is_not_arbitrarily_assigned(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            rows=[{'id':'A','n':'A','r':1,'g':'시험구','coord':[37.5,127]}]
            _,_,missing=build_admin(root,rows,self.fixture(root,overlap=True))
            self.assertEqual(rows[0]['admin'],['11','11110'])
            self.assertEqual(len(missing),1)


if __name__ == '__main__':
    unittest.main()
