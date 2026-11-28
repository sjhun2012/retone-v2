'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const alice='12345678-1234-4234-8234-123456789abc',bob='22345678-1234-4234-8234-123456789abc',id='32345678-1234-4234-8234-123456789abc';
  const dom=new JSDOM('<main id="app"></main>',{url:'https://retone.test/'}),requests=[],bindings=[],tokens=[];
  dom.window.Notification={permission:'granted'};dom.window.localStorage.setItem('retone-browser-notifications','1');
  dom.window.retoneNativePush={token:()=>new Promise(resolve=>tokens.push({user:context.signedInId,resolve})),installation:async()=>id,bind:(...args)=>bindings.push(args)};
  let enabled=true,fail=false;
  const context={window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,navigator:{userAgent:'ReToneApp/1.2'},MutationObserver:dom.window.MutationObserver,queueMicrotask,crypto,Date,console,signedInId:alice,isAdmin:false,setTimeout:()=>1,clearTimeout(){},api:async(url,options={})=>{
    requests.push({url,options,user:context.signedInId});if(url==='/api/push/config')return{enabled};if(url==='/api/push/devices'){if(fail)throw Error('not-authorized');return{registered:true,delivery_enabled:true,user_id:context.signedInId};}return{};
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/app-push.js'),'utf8'),context);await flush();assert.equal(tokens.length,1);
  context.signedInId=bob;dom.window.retonePush.sync();await flush();assert.equal(tokens.length,2);
  tokens[1].resolve({token:'b'.repeat(60),installation_id:id});await flush();assert.equal(dom.window.retonePush.active(bob),true);
  tokens[0].resolve({token:'a'.repeat(60),installation_id:id});await flush();
  const posts=requests.filter(r=>r.url==='/api/push/devices');assert.equal(posts.length,1);assert.equal(posts[0].user,bob);assert.equal(JSON.parse(posts[0].options.body).token,'b'.repeat(60));assert.equal(dom.window.retonePush.active(alice),false);
  dom.window.localStorage.setItem('retone-browser-notifications','0');dom.window.retonePush.sync();await flush();assert.equal(dom.window.retonePush.active(bob),false);assert.equal(requests.filter(r=>r.options.method==='DELETE').length,1);
  for(let i=0;i<10;i++)dom.window.retonePush.sync();await flush();assert.equal(requests.filter(r=>r.options.method==='DELETE').length,1,'DOM updates must not repeatedly unregister');
  dom.window.localStorage.setItem('retone-browser-notifications','1');fail=true;dom.window.retonePush.sync(true);await flush();tokens[2].resolve({token:'c'.repeat(60),installation_id:id});await flush();assert.equal(dom.window.retonePush.active(bob),false);assert.match(dom.window.retonePush.status(),/다시 시도/);
  fail=false;enabled=false;dom.window.retonePush.sync(true);await flush();assert.equal(tokens.length,3);assert.equal(dom.window.retonePush.active(bob),false);
  context.signedInId='';dom.window.retonePush.sync();await flush();assert.ok(bindings.some(([user,active])=>user===''&&active===false));
  console.log('Push client passed: stale-account isolation, successful enrollment, opt-out, failed-enrollment fallback, unconfigured-server fallback and logout.');
})().catch(error=>{console.error(error);process.exitCode=1});
