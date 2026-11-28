const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function landing({agent='Windows',code='aBc123',remember=false}={}){
  const dom=new JSDOM(read('public/friend.html'),{url:'https://retone-v2-mygr.onrender.com/friend.html?code='+encodeURIComponent(code)});
  if(remember)dom.window.localStorage.setItem('retone-always-open-app','1');
  const location={href:dom.window.location.href,replace(value){this.replaced=value;}};
  vm.runInNewContext(read('public/friend-link.js'),{location,document:dom.window.document,navigator:{userAgent:agent,platform:'',maxTouchPoints:0},localStorage:dom.window.localStorage,URL});
  return {dom,location,document:dom.window.document,storage:dom.window.localStorage};
}
async function main(){
  let page=landing();
  assert.ok(page.location.href.startsWith('https:'));
  assert.equal(page.document.querySelector('#continue-web').getAttribute('href'),'/?friend=ABC123');
  page.document.querySelector('#always-open').checked=true;
  page.document.querySelector('#open-retone').click();
  assert.equal(page.location.href,'retone://friend?code=ABC123');
  assert.equal(page.storage.getItem('retone-always-open-app'),'1');
  page=landing({remember:true});assert.equal(page.location.href,'retone://friend?code=ABC123');
  const checkbox=page.document.querySelector('#always-open');checkbox.checked=false;checkbox.dispatchEvent(new page.dom.window.Event('change'));
  assert.equal(page.storage.getItem('retone-always-open-app'),null);
  for(const agent of ['Android','iPhone']){page=landing({agent,remember:true});assert.equal(page.location.replaced,'/?friend=ABC123');assert.ok(page.location.href.startsWith('https:'));}
  for(const code of ['ABC1234','ABC12','<svg/>','ABC123\n']){page=landing({code});assert.equal(page.document.querySelector('#open-retone').disabled,true);assert.ok(page.location.href.startsWith('https:'));}

  const dom=new JSDOM('<main id="app"></main>',{url:'https://retone-v2-mygr.onrender.com/?friend=abc123&source=android'});
  const context=vm.createContext({window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,setTimeout,clearTimeout,setInterval,clearInterval,crypto,fetch:async()=>{throw Error('unexpected API request');},Notification:function(){},FileReader:function(){},alert(){},confirm(){return true},console,URL,URLSearchParams,FormData:dom.window.FormData});
  const source=read('public/app.js').replace(/\nrestoreLogin\(\);\s*$/,'\n');vm.runInContext(source,context);
  assert.equal(vm.runInContext("friendCodeFromQr('RETONE-FRIEND:abc123')",context),'ABC123');
  assert.equal(vm.runInContext("friendCodeFromQr('https://retone-v2-mygr.onrender.com/friend.html?code=abc123')",context),'ABC123');
  assert.equal(vm.runInContext("friendCodeFromQr('https://evil.test/friend.html?code=ABC123')",context),'');
  assert.equal(vm.runInContext("friendCodeFromQr('https://retone-v2-mygr.onrender.com.evil.test/friend.html?code=ABC123')",context),'');
  vm.runInContext("signedInId='';openPendingFriendInvite()",context);
  assert.equal(new URL(dom.window.location.href).searchParams.get('friend'),'abc123');
  vm.runInContext("globalThis.lookups=[];signedInId='me';openFriendAdd=mode=>{document.getElementById('app').innerHTML='<input id=friend-code>'};lookupFriend=mode=>{lookups.push({mode,code:document.getElementById('friend-code').value})};openPendingFriendInvite();openPendingFriendInvite();",context);
  assert.equal(vm.runInContext('lookups.length',context),1);assert.equal(vm.runInContext('lookups[0].code',context),'ABC123');
  assert.equal(new URL(dom.window.location.href).searchParams.get('friend'),null);assert.equal(new URL(dom.window.location.href).searchParams.get('source'),'android');

  const appDom=new JSDOM('<main id="app"><section class="auth-card"></section></main>',{url:'https://retone.test/'});
  const appContext={window:appDom.window,document:appDom.window.document,navigator:{},location:appDom.window.location,URLSearchParams,matchMedia:()=>({matches:false}),MutationObserver:appDom.window.MutationObserver,queueMicrotask,console};
  vm.runInNewContext(read('public/app-install.js'),appContext);
  assert.equal(appDom.window.document.querySelector('.retone-install-link'),null);
  const app=appDom.window.document.getElementById('app');app.innerHTML='<section class="page"><header class="head"><h1>채팅</h1><button class="new-room">새 대화</button></header></section>';
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(app.querySelector('.page>.head>.retone-install-link').getAttribute('href'),'/install.html');
  app.innerHTML='<section class="chat"><header class="head"><div class="chat-actions"></div></header><input id="draft" value="작성 중"></section>';
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(app.querySelector('.chat-actions>.retone-install-link'));
  app.querySelector('.chat').append(appDom.window.document.createElement('span'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(app.querySelectorAll('.retone-install-link').length,1);assert.equal(app.querySelector('#draft').value,'작성 중');

  let listener;const sent=[];const window={addEventListener:(name,callback)=>{listener=callback;},removeEventListener(){},dispatchEvent(){}};
  const install=vm.runInNewContext(read('apps/android/assets/native-notifications.js'),{window,Map,Promise,JSON,setTimeout,clearTimeout,Event:dom.window.Event});install('secret','default');
  const port={postMessage:value=>sent.push(JSON.parse(value))};listener({data:'forged',ports:[port]});assert.equal(window.Notification,undefined);
  listener({data:'secret',ports:[port]});const permission=window.Notification.requestPermission();assert.equal(window.Notification.requestPermission(),permission);
  assert.equal(sent[0].action,'permission');port.onmessage({data:JSON.stringify({id:sent[0].id,permission:'granted'})});assert.equal(await permission,'granted');
  new window.Notification('Re:tone',{body:'hello',tag:'room-1'});assert.equal(sent[1].action,'notify');assert.equal(sent[1].body,'hello');
  console.log('Invite flows passed: desktop app prompt and preference, mobile web fallback, QR URL parsing, post-login lookup, chat download buttons and native notification port.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
