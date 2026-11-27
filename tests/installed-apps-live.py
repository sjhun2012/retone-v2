"""Read-only production checks; wait for Render to serve this exact release."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://retone-v2-mygr.onrender.com'


def get(path):
    request = urllib.request.Request(BASE + path, headers={'Cache-Control':'no-cache', 'User-Agent':'ReTone-release-check/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        assert response.status == 200, path
        return response.read(), response.headers


def check():
    expected = json.loads((ROOT/'public/downloads/checksums.json').read_text(encoding='utf-8'))
    actual, _ = get('/downloads/checksums.json')
    assert json.loads(actual) == expected, 'Render is still serving a different release'
    health, _ = get('/api/health')
    assert json.loads(health).get('version'), 'Health response is missing the application version'
    for platform in ['windows','android']:
        record=expected[platform]
        data, _ = get('/downloads/' + record['file'])
        assert len(data) == record['bytes'], 'Download length mismatch: ' + platform
        assert hashlib.sha256(data).hexdigest() == record['sha256'], 'Download digest mismatch: ' + platform
    for path in ['/manifest.webmanifest','/.well-known/assetlinks.json','/.well-known/digitalassetlinks.json']:
        data, headers = get(path)
        assert json.loads(data) == json.loads((ROOT/'public'/path.lstrip('/')).read_text(encoding='utf-8')), path
        if path.endswith('.json'): assert 'json' in headers.get('Content-Type','').lower(), 'Origin association must be JSON'
    for path in ['/','/install.html','/sw.js','/app-install.js','/offline.html','/friend.html','/friend-link.js','/friend-link.css','/photo-upload.js','/app-notifications.js','/app-notifications.css']:
        relative = 'index.html' if path=='/' else path.lstrip('/')
        data, _ = get(path)
        assert data.decode('utf-8').strip() == (ROOT/'public'/relative).read_text(encoding='utf-8').strip(), 'Stale or unexpected resource: ' + path
    for path in ['/icons/app-192.png','/icons/app-512.png','/icons/apple-touch-icon.png']:
        data, _ = get(path)
        assert data == (ROOT/'public'/path.lstrip('/')).read_bytes(), 'Icon mismatch: ' + path
    print('Production verified: healthy API, current app/install pages, signed-APK association, shared icons, and exact Windows/Android download hashes.', flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--wait-seconds', type=int, default=0)
    args=parser.parse_args()
    deadline=time.monotonic()+args.wait_seconds
    while True:
        try:
            check(); return
        except (AssertionError, OSError, urllib.error.URLError) as error:
            if time.monotonic()>=deadline: raise
            print('Waiting for the tested release: ' + str(error), flush=True)
            time.sleep(min(10,max(0,deadline-time.monotonic())))


if __name__=='__main__': main()
