"""Build the Windows installer and signed Android WebView app without Gradle.

Requirements: Windows .NET Framework C# compiler; Python; JDK 21;
Android SDK platform/build tools 36.0.0. Reuses local Maven cache if available.
Release signing material lives only in .local/ and MUST stay out of Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
OUT = ROOT / 'public' / 'downloads'
LOCAL = ROOT / '.local'


def run(args, *, env=None):
    result = subprocess.run([str(a) for a in args], cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError('Build tool failed: ' + str(args[0]) + '\n' + result.stdout[-12000:] + result.stderr[-12000:])
    return result.stdout + result.stderr


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def icons():
    run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ROOT/'apps/windows/BuildIcons.ps1'])


def windows():
    csc = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Microsoft.NET' / 'Framework64' / 'v4.0.30319' / 'csc.exe'
    launcher = BUILD / 'Retone.exe'
    common = ['/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/win32icon:' + str(BUILD / 'app.ico')]
    policy = ROOT/'apps/windows/AppLinkPolicy.cs'
    run([csc, *common, '/out:' + str(launcher), ROOT / 'apps/windows/Launcher.cs', policy])
    policy_test=BUILD/'WindowsLinkPolicyTests.exe'
    run([csc,'/nologo','/target:exe','/out:'+str(policy_test),policy,ROOT/'tests/WindowsLinkPolicyTests.cs'])
    run([policy_test])
    readme = BUILD / 'README.txt'
    readme.write_text('Re:tone 1.1.0\n\n인터넷 연결과 Microsoft Edge 또는 Google Chrome이 필요합니다.\n기존 Re:tone 웹사이트를 전용 앱 창으로 엽니다.\n웹 기능 변경은 배포 후 앱을 다시 열거나 새로고침할 때 반영됩니다.\n초대 링크를 앱으로 열도록 retone URL 연결을 등록합니다.\n\n공식 사이트: https://retone-v2-mygr.onrender.com/\n설치 파일: InstallRetone.exe\n표시 이름: Re:tone (파일/바로가기는 Retone)\n현재 아이콘은 기본 임시 아이콘이며 로고 제작은 보류했습니다.\n\nWindows 설정 > 앱에서 Re:tone을 제거할 수 있습니다.\n제거 후에도 서버 계정과 대화 및 별도 브라우저 프로필은 보존됩니다.\n', encoding='utf-8-sig')
    payloads = {'Retone.exe':launcher, 'app.ico':BUILD/'app.ico', 'Uninstall.ps1':ROOT/'apps/windows/Uninstall.ps1', 'README.txt':readme}
    uninstall = BUILD / 'Uninstall.ps1'
    uninstall.write_text(payloads['Uninstall.ps1'].read_text(encoding='utf-8'), encoding='utf-8-sig')
    payloads['Uninstall.ps1'] = uninstall
    target = OUT / 'InstallRetone.exe'
    run([csc, *common, '/define:INSTALLER', '/main:Installer', '/out:' + str(target),
         *['/resource:' + str(path) + ',payload.' + name for name,path in payloads.items()],
         ROOT/'apps/windows/Installer.cs', ROOT/'apps/windows/Launcher.cs', policy])
    run([target, '/verify'])
    # Extract to a build-only directory: do not install onto the user's desktop during checks.
    extracted = BUILD / 'installer-verification'
    run([target, '/extract', extracted])
    for name, source in payloads.items():
        assert sha(extracted/name) == sha(source), 'Installer payload mismatch: ' + name
    run([target, '/verify-shortcut', extracted/'Retone.lnk'])
    assert (extracted/'Retone.lnk').stat().st_size > 0, 'Windows shortcut creation failed'
    run([extracted/'Retone.exe', '/verify'])
    return {'file':target.name, 'bytes':target.stat().st_size, 'sha256':sha(target), 'version':'1.1.0', 'signed':False, 'protocol':'retone://friend?code=ABC123'}


def dependency(group, artifact, version):
    target = BUILD / 'deps' / (artifact + '-' + version + '.jar')
    if target.exists(): return target
    target.parent.mkdir(parents=True, exist_ok=True)
    cached = Path.home()/'.gradle/caches/modules-2/files-2.1'/group/artifact/version
    candidates = list(cached.glob('*/*.aar')) if cached.exists() else []
    if candidates:
        archive = candidates[0]
    else:
        archive = target.with_suffix('.aar')
        url = 'https://dl.google.com/dl/android/maven2/' + group.replace('.', '/') + '/' + artifact + '/' + version + '/' + artifact + '-' + version + '.aar'
        urllib.request.urlretrieve(url, archive)
    with zipfile.ZipFile(archive) as z:
        target.write_bytes(z.read('classes.jar'))
    return target


def android():
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or str(Path(os.environ['LOCALAPPDATA'])/'Android/Sdk'))
    java_home = Path(os.environ.get('RETONE_JAVA_HOME', 'C:/Program Files/Java/jdk-21'))
    java = java_home/'bin/java.exe'
    tools = sdk/'build-tools/36.0.0'
    platform = BUILD/'deps/android.jar'
    platform.parent.mkdir(parents=True, exist_ok=True)
    if not platform.exists(): shutil.copyfile(sdk/'platforms/android-36/android.jar', platform)
    work = BUILD / 'android'
    work.mkdir(parents=True, exist_ok=True)
    classes = work/'classes'
    if not classes.resolve().is_relative_to(BUILD.resolve()): raise RuntimeError('Unsafe classes directory')
    if classes.exists(): shutil.rmtree(classes)
    classes.mkdir()
    policy_classes=BUILD/'policy-tests'; policy_classes.mkdir(exist_ok=True)
    run([java_home/'bin/javac.exe','-encoding','UTF-8','-d',policy_classes,ROOT/'apps/android/AppPolicy.java',ROOT/'tests/AndroidPolicyTests.java'])
    run([java,'-cp',policy_classes,'com.retone.app.AndroidPolicyTests'])
    resources = work/'resources.zip'
    run([tools/'aapt2.exe', 'compile', '--dir', ROOT/'apps/android/res', '-o', resources])
    unsigned = work/'unsigned.apk'
    run([tools/'aapt2.exe', 'link', '-o', unsigned, '--manifest', ROOT/'apps/android/AndroidManifest.xml', '-I', platform, '--auto-add-overlay', resources])
    run([java_home/'bin/javac.exe', '-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', platform,
         '-d', classes, *sorted((ROOT/'apps/android').glob('*.java'))])
    class_jar = work/'app.jar'
    with zipfile.ZipFile(class_jar, 'w') as z:
        for path in classes.rglob('*.class'): z.write(path, path.relative_to(classes).as_posix())
    dex = work/'dex'
    if not dex.resolve().is_relative_to(BUILD.resolve()): raise RuntimeError('Unsafe dex directory')
    if dex.exists(): shutil.rmtree(dex)
    dex.mkdir()
    run([java, '-cp', tools/'lib/d8.jar', 'com.android.tools.r8.R8', '--release', '--min-api', '26', '--lib', platform,
         '--pg-conf', ROOT/'apps/android/shrink-rules.pro', '--output', dex, class_jar])
    with zipfile.ZipFile(unsigned, 'a') as z:
        for path in dex.glob('classes*.dex'): z.write(path, path.name)
        for path in (ROOT/'apps/android/assets').rglob('*'):
            if path.is_file(): z.write(path,'assets/'+path.relative_to(ROOT/'apps/android/assets').as_posix())
        z.write(ROOT/'apps/THIRD_PARTY_LICENSES.txt', 'assets/THIRD_PARTY_LICENSES.txt')
    aligned = work/'aligned.apk'
    run([tools/'zipalign.exe', '-f', '-p', '4', unsigned, aligned])
    LOCAL.mkdir(exist_ok=True)
    config = LOCAL/'android-signing.json'
    keystore = LOCAL/'retone-release.jks'
    if (OUT/'checksums.json').exists() and 'android' in json.loads((OUT/'checksums.json').read_text(encoding='utf-8')) and not keystore.exists():
        raise RuntimeError('Restore the original release signing key before rebuilding an existing Android release.')
    if not config.exists():
        if keystore.exists(): raise RuntimeError('Signing key exists but its configuration is missing; restore the original configuration.')
        config.write_text(json.dumps({'alias':'retone', 'password':secrets.token_urlsafe(36)}), encoding='utf-8')
    signing = json.loads(config.read_text(encoding='utf-8'))
    environment = dict(os.environ, RETONE_STORE_PASSWORD=signing['password'])
    if not keystore.exists():
        run([java_home/'bin/keytool.exe', '-genkeypair', '-keystore', keystore, '-storetype', 'JKS', '-alias', signing['alias'],
             '-keyalg','RSA','-keysize','3072','-validity','10000','-storepass:env','RETONE_STORE_PASSWORD','-keypass:env','RETONE_STORE_PASSWORD',
             '-dname','CN=ReTone, OU=Application, O=ReTone, C=KR', '-noprompt'], env=environment)
    target = OUT/'InstallRetone.apk'
    signer = [java, '-jar', tools/'lib/apksigner.jar']
    run([*signer, 'sign', '--v4-signing-enabled', 'false', '--ks', keystore, '--ks-key-alias', signing['alias'], '--ks-pass', 'env:RETONE_STORE_PASSWORD',
         '--key-pass','env:RETONE_STORE_PASSWORD','--out', target, aligned], env=environment)
    verified = run([*signer, 'verify', '--verbose', '--print-certs', target])
    import re
    digest = re.search(r'certificate SHA-256 digest: ([0-9a-f]+)', verified).group(1).upper()
    fingerprint = ':'.join(digest[i:i+2] for i in range(0,len(digest),2))
    links = [{'relation':['delegate_permission/common.handle_all_urls'], 'target':{'namespace':'android_app','package_name':'com.retone.app','sha256_cert_fingerprints':[fingerprint]}}]
    well_known = ROOT/'public/.well-known'; well_known.mkdir(parents=True, exist_ok=True)
    for name in ['assetlinks.json','digitalassetlinks.json']:
        (well_known/name).write_text(json.dumps(links, indent=2)+'\n', encoding='utf-8')
    run([tools/'zipalign.exe','-c','4',target])
    badging = run([tools/'aapt.exe','dump','badging',target])
    assert "application-label:'Re:tone'" in badging, 'Android label is incorrect'
    assert "package: name='com.retone.app'" in badging
    assert "targetSdkVersion:'36'" in badging
    assert "versionCode='2'" in badging and "versionName='1.1.0'" in badging
    return {'file':target.name,'bytes':target.stat().st_size,'sha256':sha(target),'version':'1.1.0','version_code':2,'engine':'Android System WebView','package':'com.retone.app','certificate_sha256':fingerprint}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--only', choices=['windows','android'])
    args=parser.parse_args()
    BUILD.mkdir(exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
    icons()
    manifest=OUT/'checksums.json'
    results=json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {'app_name':'Re:tone','web_url':'https://retone-v2-mygr.onrender.com/','update_mode':'live-web; reopen or refresh after deployment'}
    for name,builder in [('windows', windows), ('android', android)]:
        if args.only and args.only != name: continue
        results[name]=builder()
        print(name + ': build and package verification passed')
    manifest.write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')


if __name__=='__main__': main()
