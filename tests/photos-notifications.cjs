const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const png='data:image/png;base64,iVBORw0KGgo=';

async function optimizer(){
  let result=png,dimensions=[],attempts=0;
  class Reader{readAsDataURL(){this.result=result;queueMicrotask(()=>this.onload());}}
  class Image{naturalWidth=4032;naturalHeight=3024;set src(value){queueMicrotask(()=>this.onload());}}
  const window={};
  const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(image,x,y,w,h){dimensions.push([w,h]);}}),toDataURL:()=>{attempts++;return 'data:image/jpeg;base64,'+(attempts===1?'A'.repeat(2_000_000):'/9j/AA==');}};
  vm.runInNewContext(read('public/photo-upload.js'),{window,FileReader:Reader,Image,document:{createElement:()=>canvas},Error,Math});
  assert.equal(await window.retonePrepareImage({size:8,type:'image/png'}),png);
  result='data:image/jpeg;base64,/9j/AA==';
  assert.match(await window.retonePrepareImage({size:8*1024*1024,type:'image/jpeg'}),/^data:image\/jpeg;base64,/);
  assert.equal(attempts,2);assert.ok(dimensions.every(([w,h])=>w<=1920&&h<=1920));
  await assert.rejects(window.retonePrepareImage({size:33*1024*1024,type:'image/jpeg'}),/32MB/);
  await assert.rejects(window.retonePrepareImage({size:50,type:'application/pdf'}),/사진 파일/);
}

function frontend(){
  const dom=new JSDOM('<main id="app"></main>',{url:'https://retone.test/'});
  const context=vm.createContext({window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,setTimeout,clearTimeout,setInterval,clearInterval,crypto,fetch:async()=>{throw Error('Unexpected network')},Notification:function(){},FileReader:function(){},alert(){},confirm(){return true},console,URL,URLSearchParams,FormData:dom.window.FormData});
  vm.runInContext(read('public/app.js').replace(/\nrestoreLogin\(\);\s*$/,'\n'),context);
  return{dom,context};
}
async function photos(){
  const{context,dom}=frontend();
  vm.runInContext(`signedInId='alice';signedIn='Alice';roomId='room-a';replyingTo={id:'reply-a'};globalThis.calls=[];globalThis.refreshes=[];api=async(url,options)=>{calls.push({url,options});return{id:'photo'};};refreshRoom=async id=>refreshes.push(id);aiDetails=()=>({'이미지 안전 안내':'끄기'});setAiStatus=()=>{};globalThis.readerResolve=null;readImage=()=>new Promise(resolve=>{readerResolve=resolve;});globalThis.input={files:[{type:'image/jpeg',size:8000000}],value:'selected'};globalThis.sending=sendImage(input);roomId='room-b';readerResolve('${png}');`,context);
  await vm.runInContext('sending',context);
  assert.equal(vm.runInContext('calls[0].url',context),'/api/rooms/room-a/messages');
  assert.equal(JSON.parse(vm.runInContext('calls[0].options.body',context)).reply_to,'reply-a');
  assert.equal(vm.runInContext('refreshes.length',context),0);assert.equal(vm.runInContext('input.value',context),'');
  vm.runInContext(`roomId='room-a';replyingTo=null;calls=[];aiDetails=()=>({'이미지 안전 안내':'켜기'});readImage=async()=> '${png}';api=async(url,options)=>{calls.push({url,options});if(url==='/api/images/check')throw Object.assign(new Error('offline'),{status:503});return{id:'photo'};};popup=html=>{document.getElementById('app').innerHTML=html;};closePopup=()=>{};globalThis.pending=sendImage(input);`,context);
  await vm.runInContext('pending',context);
  assert.ok(dom.window.document.querySelector('#photo-send-unchecked'));
  assert.equal(vm.runInContext('calls.filter(c=>c.url.includes("/messages")).length',context),0);
  dom.window.document.querySelector('#photo-send-unchecked').click();await flush();
  assert.equal(vm.runInContext('calls.filter(c=>c.url.includes("/messages")).length',context),1);
  vm.runInContext(`calls=[];globalThis.pending=sendImage(input);`,context);await vm.runInContext('pending',context);
  vm.runInContext(`signedInId='another-account'`,context);
  dom.window.document.querySelector('#photo-send-unchecked').click();await flush();
  assert.equal(vm.runInContext('calls.filter(c=>c.url.includes("/messages")).length',context),0);
}
async function notices(){
  const{context,dom}=frontend();let feed={notifications:[],cursor:0,unread:0};const shown=[];
  class Notification{static permission='granted';constructor(title,options){shown.push({title,options});}}
  dom.window.Notification=Notification;dom.window.focus=()=>{};
  dom.window.localStorage.setItem('retone-browser-notifications','1');
  context.navigator={userAgent:'ReToneApp/1.1'};context.location=dom.window.location;context.history=dom.window.history;
  context.MutationObserver=dom.window.MutationObserver;context.queueMicrotask=queueMicrotask;
  context.setTimeout=()=>1;context.clearTimeout=()=>{};
  context.mockApi=async url=>url.startsWith('/api/notifications')?feed:{};
  vm.runInContext(`signedInId='alice';roomId='open-room';api=(...args)=>mockApi(...args);document.getElementById('app').innerHTML='<section class="chat"><header class="head"><div class="chat-actions"></div></header></section>';`,context);
  vm.runInContext(read('public/app-notifications.js'),context);await flush();
  assert.equal(dom.window.localStorage.getItem('retone-notification-cursor:alice'),'0');
  feed={notifications:[{id:1,kind:'friend_request',title:'친구 요청',body:'Bob',read:false}],cursor:1,unread:1};
  dom.window.retoneNotifications.refresh();await flush();assert.equal(shown.length,1);
  assert.equal(shown[0].options.tag,'retone-event-1');assert.ok(dom.window.document.querySelector('[data-retone-notifications]'));
  dom.window.retoneNotifications.refresh();await flush();assert.equal(shown.length,1);
  feed={notifications:[{id:2,kind:'friend_accepted',title:'친구 요청 수락',body:'Bob',read:false}],cursor:2,unread:2};
  dom.window.retoneNotifications.refresh();await flush();assert.equal(shown.length,2);
  dom.window.localStorage.setItem('retone-browser-notifications','0');
  feed={notifications:[{id:3,kind:'room_invite',title:'초대',body:'room',read:false}],cursor:3,unread:3};
  dom.window.retoneNotifications.refresh();await flush();assert.equal(shown.length,2);
  assert.equal(dom.window.localStorage.getItem('retone-notification-cursor:alice'),'3');
  vm.runInContext(`signedInId=''`,context);dom.window.retoneNotifications.sync();await flush();
}
(async()=>{await optimizer();await photos();await notices();console.log('Photos and notifications passed: large-photo preparation, room/account isolation, explicit AI-check failure choice, active-room delivery, deduplication and opt-out.');})().catch(error=>{console.error(error);process.exitCode=1;});
