"""Read-only functional checks for an already running Phu Tai server."""

import argparse
import json
import os
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--with-data', action='store_true', help='require imported forest records')
    args = parser.parse_args()
    base = os.environ.get('WEBGIS_URL', 'http://127.0.0.1:8000').rstrip('/')
    token = os.environ.get('WEBGIS_TOKEN', '')
    passed = 0

    def request(path, payload=None):
        headers = {'Accept': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(
            base + path, headers=headers,
            data=None if payload is None else json.dumps(payload).encode(),
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def check(condition, label):
        nonlocal passed
        if not condition:
            raise RuntimeError(f'FAIL {label}')
        passed += 1
        print(f'PASS {label}')

    status, body = request('/')
    check(status == 200 and 'PHÚ TÀI BIOENERGY' in body.decode(), 'original Phu Tai frontend')
    status, body = request('/api/health')
    check(status == 200 and json.loads(body).get('status') == 'ok', 'backend health')
    status, body = request('/api/config')
    config = json.loads(body)
    check(status == 200 and not any(k in config for k in ('google_maps_key', 'planet_api_key', 'password', 'token')), 'public configuration has no credentials')
    status, body = request('/api/provinces/boundaries')
    check(status == 200 and bool(json.loads(body).get('features')), 'public province boundary GeoJSON')
    status, body = request('/data/quangngai_districts_bbox.json')
    check(status == 200 and bool(json.loads(body)), 'public district bounds')
    status, body = request('/api/fonts/Open%20Sans%20Regular/0-255.pbf')
    check(status == 200 and len(body) > 1024, 'local map glyphs')
    private_paths = ['/data/webgis.db', '/data/redbooks_log.json', '/static/data/webgis.db', '/.env']
    check(all(request(path)[0] == 404 for path in private_paths), 'private files are not static downloads')
    status, body = request('/api/layers')
    if status == 401:
        raise RuntimeError('Data API requires login. Supply WEBGIS_TOKEN through your secure environment to check data.')
    layers = json.loads(body)
    check(status == 200 and isinstance(layers, list) and (bool(layers) or not args.with_data), 'layer catalog')
    status, body = request('/api/plots?limit=1')
    plots = json.loads(body)
    check(status == 200 and plots.get('type') == 'FeatureCollection' and (bool(plots.get('features')) or not args.with_data), 'forest record search')
    status, body = request('/api/redbook/parse-coordinates', {
        'province': 'Quảng Ngãi',
        'coordinate_text': '1 1660000.00 500000.00\n2 1660100.00 500000.00\n3 1660100.00 500100.00\n4 1660000.00 500100.00',
    })
    result = json.loads(body)
    ring = result.get('polygon_geojson', {}).get('coordinates', [[]])[0]
    check(status == 200 and len(ring) >= 4 and ring[0] == ring[-1] and all(-180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring), 'VN-2000 coordinate table produces a closed WGS84 polygon')
    print(f'{passed} runtime checks passed.')


if __name__ == '__main__':
    main()
