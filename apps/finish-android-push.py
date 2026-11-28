"""Fetch official Android signing tools and finish the verified local CI APK."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
VERSION = '36.0.0'
ORIGIN = 'https://dl.google.com/android/repository/'
EXPECTED_UNSIGNED = '9159c7400b0927e97bc842a3bc3dfbbff87c6226337b61522fc880601f93388f'


def digest(path, algorithm='sha256'):
    result = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(part)
    return result.hexdigest()


def toolset(sdk):
    tools = sdk / 'build-tools' / VERSION
    return all((tools / name).is_file() for name in ('zipalign.exe', 'aapt.exe', 'lib/apksigner.jar'))


def install_tools():
    candidates = [LOCAL / 'android-sdk']
    candidates += [Path(os.environ[name]) for name in ('ANDROID_HOME', 'ANDROID_SDK_ROOT') if os.environ.get(name)]
    candidates.append(Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk')
    for sdk in candidates:
        if toolset(sdk):
            return sdk
    sdk = LOCAL / 'android-sdk'
    sdk.mkdir(parents=True, exist_ok=True)
    print('Downloading official Android signing tools...', flush=True)
    with urllib.request.urlopen(ORIGIN + 'repository2-1.xml', timeout=60) as response:
        document = ET.fromstring(response.read())
    package = next((item for item in document.iter('remotePackage') if item.get('path') == 'build-tools;' + VERSION), None)
    if package is None:
        raise RuntimeError('Official build-tools metadata is missing')
    archive = next((item for item in package.findall('./archives/archive') if item.findtext('host-os') == 'windows'), None)
    if archive is None:
        raise RuntimeError('Official Windows build-tools archive is missing')
    complete = archive.find('complete')
    name = complete.findtext('url', '')
    expected = complete.findtext('checksum', '').strip().lower()
    size = int(complete.findtext('size', '0'))
    if '/' in name or '\\' in name or not name.endswith('.zip') or len(expected) != 40 or size <= 0:
        raise RuntimeError('Invalid official build-tools metadata')
    download = sdk / name
    if not download.is_file() or download.stat().st_size != size or digest(download, 'sha1') != expected:
        urllib.request.urlretrieve(ORIGIN + name, download)
    if download.stat().st_size != size or digest(download, 'sha1') != expected:
        raise RuntimeError('Android tools download checksum verification failed')
    staging = sdk / ('staging-' + uuid.uuid4().hex)
    staging.mkdir()
    with zipfile.ZipFile(download) as bundle:
        for item in bundle.infolist():
            if not (staging / item.filename).resolve().is_relative_to(staging.resolve()):
                raise RuntimeError('Unsafe Android archive entry')
        bundle.extractall(staging)
    roots = [item.parent for item in staging.rglob('zipalign.exe') if (item.parent / 'lib/apksigner.jar').is_file()]
    if len(roots) != 1:
        raise RuntimeError('Downloaded signing tools were incomplete')
    target = sdk / 'build-tools' / VERSION
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise RuntimeError('Incomplete existing local tools; no files were overwritten')
    if not roots[0].resolve().is_relative_to(sdk.resolve()) or not target.resolve().is_relative_to(sdk.resolve()):
        raise RuntimeError('Android tools path escaped its project directory')
    shutil.move(str(roots[0]), str(target))
    if not toolset(sdk):
        raise RuntimeError('Android signing tool installation failed')
    return sdk


def main():
    unsigned = ROOT / 'build/firebase-app-release-unsigned.apk'
    if not unsigned.is_file() or digest(unsigned) != EXPECTED_UNSIGNED:
        raise RuntimeError('The verified Firebase push build is missing or changed; return to ChatGPT')
    if not all((LOCAL / name).is_file() for name in ('retone-release.jks', 'android-signing.json')):
        raise RuntimeError('The original release signer is missing; no replacement key was created')
    sdk = install_tools()
    environment = dict(os.environ, ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk))
    subprocess.run([sys.executable, str(ROOT / 'apps/build_apps.py'), '--only', 'android', '--unsigned', str(unsigned)],
                   cwd=ROOT, env=environment, check=True)
    output = json.loads((ROOT / 'public/downloads/checksums.json').read_text(encoding='utf-8'))['android']
    print('Android push package ready. Version: ' + output['version'])
    print('Return to ChatGPT and say: Android signing complete.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Setup stopped: ' + str(error), file=sys.stderr)
        sys.exit(1)
