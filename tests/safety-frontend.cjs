const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
async function main(){
 const dom=new JSDOM('<main id="app"></main>',{url:'https://retone.test/'});
 const calls=[];
 const context=vm.createContext({window:dom.window,document:dom.window.document,sessionStorage:dom.window.sessionStorage,localStorage:dom.window.localStorage,setTimeout,clearTimeout,setInterval,clearInterval,crypto,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({ai_intervention:JSON.parse(options.body).ai_intervention})}},alert(){},confirm(){return true},Notification:function(){},FileReader:function(){},console,URL,URLSearchParams,FormData:dom.window.FormData});
 vm.runInContext(fs.readFileSync('public/app.js','utf8').replace(/\nrestoreLogin\(\);\s*$/,'\n'),context);
 const result=await vm.runInContext(`(async()=>{
  signedInId='me';signedIn='나';roomId='room-1';aiIntervention='off';
  await queueFactChecks([{id:'claim',mine:false,body:'오늘 뉴스에서 지원금 100만원을 준다고 발표했대',room_id:'room-1'}]);
  const disabled=activeAiIntervention()==='off'&&Object.values(aiDetails()).every(v=>v==='끄기')&&conversationPulse()==='';
  await setAiIntervention('standard');
  const enabled=aiIntervention==='standard'&&aiDetails()['비꼼·압박 표현']!=='끄기';
  currentRoomMessages=[{id:'one',created:1,body:'이전'},{id:'two',created:2,body:'수정 전'}];
  const merged=mergeRoomUpdate({snapshot:false,messages:[{id:'two',created:2,body:'수정 후'},{id:'three',created:3,body:'새 메시지'}],removed:['one']});
  const delta=merged.length===2&&merged[0].body==='수정 후'&&merged[1].id==='three';
  const reactions=reactionMarkup({id:'m',reactions:[{emoji:'👍',count:2,mine:true}]});
  clearTimeout(aiPreferenceTimer);
  return {disabled,enabled,delta,reactions:reactions.includes('aria-pressed="true"')&&reactions.includes('<small>2</small>')};
 })()`,context);
 assert.ok(result.disabled);assert.ok(result.enabled);assert.ok(result.delta);assert.ok(result.reactions);
 assert.equal(calls.filter(c=>c.url==='/api/ai/fact-check').length,0);
 const write=calls.find(c=>c.url.includes('/preferences'));assert.ok(JSON.parse(write.options.body).ai_settings.details['비꼼·압박 표현']!=='끄기');
 console.log('Safety frontend checks passed: global AI off, re-enable, delta merging and emoji state.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
