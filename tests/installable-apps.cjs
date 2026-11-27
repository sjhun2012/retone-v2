const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name), 'utf8');

test('all platforms use the same application identity and production origin', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.name,'Re:tone'); assert.equal(manifest.short_name,'Re:tone');
  assert.equal(manifest.display,'standalone'); assert.equal(manifest.scope,'/');
  const html = read('public/index.html');
  assert.match(html, /<title>Re:tone<\/title>/);
  assert.match(html, /href="\/manifest.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  for (const icon of manifest.icons) {
    const buffer = fs.readFileSync(path.join(root,'public',icon.src));
    assert.equal(buffer.toString('hex',0,8),'89504e470d0a1a0a');
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(buffer.readUInt32BE(16),size); assert.equal(buffer.readUInt32BE(20),size);
  }
  assert.match(read('apps/windows/Launcher.cs'),/https:\/\/retone-v2-mygr\.onrender\.com\/\?source=desktop/);
  assert.match(read('apps/android/MainActivity.java'),/https:\/\/retone-v2-mygr\.onrender\.com\/\?source=android/);
  assert.match(read('apps/android/AndroidManifest.xml'),/android:label="Re:tone"/);
});

function worker() {
  const events = {}, requests = [], stored = [], deleted = [];
  let offline = false, revision = 1;
  const context = {URL, Promise, self: {location:{origin:'https://retone.test'},
    addEventListener:(name,handler) => {events[name]=handler;}, skipWaiting:async()=>{}, clients:{claim:async()=>{}}},
    caches:{open:async()=>({add:async url=>stored.push(url)}),keys:async()=>['retone-offline-v0','retone-offline-v1','another-app'],delete:async key=>deleted.push(key),match:async url=>({offline:true,url})},
    fetch:async(request, options)=>{requests.push({request,options});if(offline)throw new Error('disconnected');return {revision:revision++};}};
  vm.runInNewContext(read('public/sw.js'),context);
  function fetchEvent(url, mode='navigate', method='GET') {
    let response;
    events.fetch({request:{url,mode,method},respondWith:value=>{response=value;}});
    return response;
  }
  return {events,requests,stored,deleted,fetchEvent,setOffline:value=>{offline=value;}};
}

test('navigation and assets load new revisions and API traffic is untouched', async () => {
  const w=worker();
  assert.equal((await w.fetchEvent('https://retone.test/')).revision,1);
  assert.equal((await w.fetchEvent('https://retone.test/')).revision,2);
  assert.equal((await w.fetchEvent('https://retone.test/app.js','script')).revision,3);
  assert.equal((await w.fetchEvent('https://retone.test/app.css?v=1','style')).revision,4);
  assert.ok(w.requests.every(r=>r.options.cache==='no-store'));
  assert.equal(w.fetchEvent('https://retone.test/api/bootstrap','cors'),undefined);
  assert.equal(w.fetchEvent('https://retone.test/api/rooms','cors','POST'),undefined);
  assert.equal(w.fetchEvent('https://third-party.test/app.js','script'),undefined);
  assert.equal(w.requests.length,4);
});

test('offline support caches only the notice and preserves unrelated caches', async () => {
  const w=worker(); let pending;
  w.events.install({waitUntil:p=>{pending=p;}}); await pending;
  assert.deepEqual(w.stored,['/offline.html']);
  w.events.activate({waitUntil:p=>{pending=p;}}); await pending;
  assert.deepEqual(w.deleted,['retone-offline-v0']);
  w.setOffline(true);
  const fallback=await w.fetchEvent('https://retone.test/');
  assert.equal(fallback.offline,true); assert.equal(fallback.url,'/offline.html');
  await assert.rejects(w.fetchEvent('https://retone.test/app.js','script'),/disconnected/);
});

test('downloaded installers match their recorded hashes and Android origin binding', () => {
  const checksums=JSON.parse(read('public/downloads/checksums.json'));
  for (const name of ['windows','android']) {
    const record=checksums[name];
    const bytes=fs.readFileSync(path.join(root,'public/downloads',record.file));
    assert.equal(bytes.length,record.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.match(read('public/install.html'),new RegExp(record.file.replace('.','\\.')));
  }
  const exe=fs.readFileSync(path.join(root,'public/downloads/InstallRetone.exe'));
  assert.equal(exe.toString('ascii',0,2),'MZ');
  assert.equal(exe.toString('ascii',exe.readUInt32LE(0x3c),exe.readUInt32LE(0x3c)+4),'PE\0\0');
  const apk=fs.readFileSync(path.join(root,'public/downloads/InstallRetone.apk'));
  assert.equal(apk.toString('hex',0,4),'504b0304');
  const links=JSON.parse(read('public/.well-known/digitalassetlinks.json'));
  assert.equal(links[0].target.package_name,checksums.android.package);
  assert.deepEqual(links[0].target.sha256_cert_fingerprints,[checksums.android.certificate_sha256]);
  assert.match(checksums.android.certificate_sha256,/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test('Windows uninstall only removes the exact marked installation directory', () => {
  const source=read('apps/windows/Uninstall.ps1');
  assert.match(source,/GetFullPath\(\$PSScriptRoot\) -ne \$installDirectory/);
  assert.match(source,/\.retone-install/);
  assert.match(source,/Remove-Item -LiteralPath \$installDirectory -Recurse/);
  assert.doesNotMatch(source,/cmd\s*\/c|Invoke-Expression|iex\s/);
});
