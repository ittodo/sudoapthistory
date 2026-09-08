"""Join apartments to a pinned SGIS vintage; publish only display geometries."""
import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely import STRtree, make_valid
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform, unary_union

SIDO = {0: '31', 1: '11', 2: '23'}


def polygon(geometry):
    if geometry.is_valid:
        return geometry
    repaired = make_valid(geometry)
    if repaired.geom_type == 'GeometryCollection':
        repaired = unary_union([g for g in repaired.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
    if repaired.is_empty or repaired.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('Unusable administrative boundary')
    return repaired


def build_admin(site, complexes, source):
    raw = Path(source).read_bytes()
    payload = json.loads(gzip.decompress(raw))
    if payload['meta']['crs'] != 'EPSG:5179' or payload['meta']['source'] != 'SGIS':
        raise ValueError('Unexpected administrative source')
    to_geo = Transformer.from_crs(5179, 4326, always_xy=True).transform
    to_native = Transformer.from_crs(4326, 5179, always_xy=True).transform
    regions, geometries, shards, repairs = {}, {}, defaultdict(list), []
    for feature in payload['features']:
        props = feature['properties']
        code = props['adm_cd']
        if code in regions or len(code) not in (2, 5, 8):
            raise ValueError('Duplicate/invalid administrative code')
        original = shape(feature['geometry'])
        if not original.is_valid:
            repairs.append(code)
        geom = polygon(original)
        geometries[code] = geom
        parent = code[:5] if len(code) == 8 else code[:2] if len(code) == 5 else None
        level = {2: 'sido', 5: 'sigungu', 8: 'dong'}[len(code)]
        anchor = Point(float(props['x']), float(props['y']))
        if not geom.contains(anchor):
            anchor = geom.representative_point()
        lon, lat = to_geo(anchor.x, anchor.y)
        display = transform(to_geo, geom.simplify(4, preserve_topology=True))
        west, south, east, north = display.bounds
        shard = f'data/map/regions/{code[:5] if level == "dong" else level}.json'
        name = props['adm_nm'].split(' ', 1)[-1] if level == 'sigungu' else props['adm_nm'].split()[-1]
        regions[code] = {'id': code, 'parent': parent, 'level': level, 'name': name,
                         'fullName': props['adm_nm'], 'coord': [round(lat, 6), round(lon, 6)],
                         'bounds': [[south, west], [north, east]], 'shard': shard}
        shards[shard].append({'type': 'Feature', 'properties': {'id': code}, 'geometry': mapping(display)})
    if any(r['parent'] and r['parent'] not in regions for r in regions.values()):
        raise ValueError('Orphan administrative region')
    codes = {level: sorted(c for c, r in regions.items() if r['level'] == level) for level in ('sigungu', 'dong')}
    trees = {level: STRtree([geometries[c] for c in ids]) for level, ids in codes.items()}
    # Current address names can identify a parent, but never infer administrative dong from legal dong names.
    parent_names = {r['fullName']: c for c, r in regions.items() if r['level'] == 'sigungu'}
    unresolved = []
    for complex_ in complexes:
        sido = SIDO[complex_['r']]
        parents, dong = [], []
        if complex_['coord']:
            lat, lon = complex_['coord']
            point = Point(*to_native(lon, lat))
            found = {}
            for level in ('sigungu', 'dong'):
                # intersects finds border ties too; none of those ties is assigned arbitrarily.
                found[level] = [codes[level][int(i)] for i in trees[level].query(point, predicate='intersects')]
            if len(found['sigungu']) == 1 and found['sigungu'][0].startswith(sido):
                parents = found['sigungu']
            if len(found['dong']) == 1 and found['dong'][0].startswith(sido):
                candidate = found['dong'][0]
                if geometries[candidate].contains(point) and (not parents or candidate[:5] == parents[0]):
                    dong = [candidate]
                    parents = [candidate[:5]]
        else:
            parent = parent_names.get(regions[sido]['fullName'] + ' ' + complex_['g'])
            if parent:
                parents = [parent]
        complex_['admin'] = [sido] + parents + dong
        if not dong:
            unresolved.append({'id': complex_['id'], 'name': complex_['n'], 'coord': complex_['coord'], 'parents': parents})
    hashes = {}
    for name, features in sorted(shards.items()):
        target = site / name
        target.parent.mkdir(parents=True, exist_ok=True)
        data = json.dumps({'type': 'FeatureCollection', 'year': payload['meta']['year'], 'features': features},
                          ensure_ascii=False, separators=(',', ':')).encode()
        target.write_bytes(data)
        hashes[name] = hashlib.sha256(data).hexdigest()
    meta = {'source': 'SGIS', 'year': payload['meta']['year'], 'sourceHash': hashlib.sha256(raw).hexdigest(),
            'regions': list(regions.values()), 'unassignedDong': len(unresolved), 'repairedGeometries': repairs}
    return meta, hashes, unresolved


def validate_admin(payload):
    admin = payload.get('admin')
    if not admin:
        raise ValueError('Missing administrative data')
    regions = {r['id']: r for r in admin['regions']}
    if len(regions) != len(admin['regions']):
        raise ValueError('Duplicate administrative region')
    if not isinstance(admin['year'], int) or not regions:
        raise ValueError('Missing administrative vintage')
    for r in regions.values():
        if r['level'] != {2:'sido',5:'sigungu',8:'dong'}.get(len(r['id'])):
            raise ValueError('Invalid administrative level')
        if r['parent'] and r['parent'] not in regions or r['shard'] not in payload['meta']['sources']:
            raise ValueError('Missing region parent or source')
    if admin['unassignedDong'] != sum(len(c.get('admin', [])) < 3 for c in payload['d']):
        raise ValueError('Incorrect unassigned administrative count')
    for c in payload['d']:
        ids = c.get('admin', [])
        if not ids or len(ids) != len(set(ids)) or ids[0] != SIDO[c['r']]:
            raise ValueError('Invalid apartment administrative membership')
        for n, code in enumerate(ids):
            if code not in regions or (n and regions[code]['parent'] != ids[n-1]):
                raise ValueError('Broken apartment administrative hierarchy')
