"""Resolve missing map points by full lot address into a resumable local JSON cache."""
import argparse
import concurrent.futures
import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path


def resolve(item, key):
    if not item['hasLot']:
        return None
    params = urllib.parse.urlencode({'q': item['address'], 'output': 'json', 'epsg': 'epsg:4326', 'apiKey': key})
    try:
        req = urllib.request.Request('https://apis.vworld.kr/jibun2coord.do?' + params, headers={'Referer': 'https://nodostream.com/', 'User-Agent': 'nodostream-map/1.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.load(response)
        point = [float(data.get('EPSG_4326_Y', 0)), float(data.get('EPSG_4326_X', 0))]
        if 33 < point[0] < 39.5 and 124 < point[1] < 132:
            return {'address': item['address'], 'coord': [round(n, 6) for n in point], 'source': 'vworld-full-lot-address'}
    except urllib.error.URLError as error:
        if getattr(error.reason, 'winerror', None) == 10013:
            raise RuntimeError('Network access is blocked; no address results were saved for this request.') from None
        return None
    except (ValueError, OSError):
        return None
    return None


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--unresolved', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--limit', type=int, default=1000)
    args = parser.parse_args()
    cache = json.loads(args.cache.read_text(encoding='utf-8')) if args.cache.exists() else {}
    script = (Path(__file__).resolve().parents[1] / 'js/map-services.js').read_text(encoding='utf-8')
    key = re.search(r"const key = '([^']+)'", script)[1]
    items = json.loads(args.unresolved.read_text(encoding='utf-8'))
    todo = list({r['address']: r for r in items if r['address'] not in cache and r['hasLot']}.values())[:args.limit]
    found = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for i, result in enumerate(pool.map(lambda row: resolve(row, key), todo), 1):
            if result:
                cache[result['address']] = result
                found += 1
            if i % 25 == 0 or i == len(todo):
                args.cache.parent.mkdir(parents=True, exist_ok=True)
                temp = args.cache.with_suffix('.tmp')
                temp.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding='utf-8')
                temp.replace(args.cache)
                print(json.dumps({'checked': i, 'total': len(todo), 'resolved': found}), flush=True)
    print(json.dumps({'cached': len(cache), 'new': found}))
