const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function main(){
  const dom=new JSDOM('<main id="app"></main><button data-room-mute></button><small data-room-muted-indicator="room-a" hidden>🔕</small>',{url:'https://retone.test/'});
  const requests=[],alerts=[];let fail=false,resolveRequest;
  const context=vm.createContext({window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,
    setTimeout,clearTimeout,setInterval,clearInterval,crypto,URL,URLSearchParams,console,alert:message=>alerts.push(message),confirm:()=>true});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').replace(/\nrestoreLogin\(\);\s*$/,'\n'),context);
  context.savePreference=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});if(fail)throw Error('offline');return new Promise(resolve=>{resolveRequest=()=>resolve(JSON.parse(options.body));});};
  vm.runInContext("roomId='room-a';signedInId='alice';data={rooms:[{id:'room-a'},{id:'room-b'}],muted_rooms:[]};api=savePreference;closePopup=()=>{};",context);
  const first=vm.runInContext('toggleRoomMute()',context);
  assert.equal(dom.window.document.querySelector('[data-room-mute]').disabled,true);
  await vm.runInContext('toggleRoomMute()',context);assert.equal(requests.length,1,'double taps must not send conflicting writes');
  resolveRequest();await first;
  assert.equal(vm.runInContext("isRoomMuted('room-a')",context),true);
  assert.equal(vm.runInContext("isRoomMuted('room-b')",context),false);
  assert.equal(dom.window.document.querySelector('small').hidden,false);
  assert.match(dom.window.document.querySelector('button').textContent,/켜기/);
  fail=true;await vm.runInContext('toggleRoomMute()',context);
  assert.equal(vm.runInContext("isRoomMuted('room-a')",context),true,'failed saves must preserve the active mute');assert.equal(alerts.length,1);
  fail=false;const unmute=vm.runInContext('toggleRoomMute()',context);resolveRequest();await unmute;
  assert.equal(vm.runInContext("isRoomMuted('room-a')",context),false);
  assert.equal(dom.window.document.querySelector('small').hidden,true);
  const stale=vm.runInContext('toggleRoomMute()',context);
  vm.runInContext("signedInId='bob';data={rooms:[],muted_rooms:[]};",context);resolveRequest();await stale;
  assert.equal(vm.runInContext('data.muted_rooms.length',context),0,'a late save must not modify another account');
  assert.equal(dom.window.localStorage.getItem('retone-muted-bob-room-a'),null);
  dom.window.close();console.log('Room mute UI passed: per-room state, double taps, failed saves, unmute and account-switch isolation.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
