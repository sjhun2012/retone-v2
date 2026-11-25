const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const base='http://127.0.0.1:4000';
async function request(path,{session,method='GET',body,expected=200}={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie}:{}),...(session?.admin?{'X-ReTone-Admin':'1'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(response.status,expected,method+' '+path);
 const text=await response.text();return {value:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function account(index){const body={name:'Safety '+index,phone:'0109999010'+index,password:'SafetyTest1!',ai_intervention:'off'};const result=await request('/api/auth/signup',{method:'POST',body});return {...result.value.user,cookie:result.cookie};}
function otp(step){const hash=createHmac('sha1',Buffer.from('12345678901234567890')).update(Buffer.from(BigInt(step).toString(16).padStart(16,'0'),'hex')).digest();const offset=hash[19]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
async function main(){
 const [alice,bob,charlie,outsider]=await Promise.all([1,2,3,4].map(account));
 await request('/api/users',{expected:401});await request('/api/users',{session:alice,expected:401});
 for(const friend of [bob,charlie]){await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:friend.id}});await request('/api/friends/accept',{session:friend,method:'POST',body:{target_id:alice.id}});}
 const room=(await request('/api/rooms',{session:alice,method:'POST',body:{name:'Safety room',invitee_ids:[bob.id,charlie.id]}})).value;
 const empty=(await request('/api/rooms/'+room.id+'/sync',{session:alice})).value;
 const message=(await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'내일 오후 6시에 회의실에서 만나자'}})).value;
 const initialDelta=(await request('/api/rooms/'+room.id+'/sync?after='+empty.cursor,{session:bob})).value;assert.equal(initialDelta.snapshot,false);assert.equal(initialDelta.messages.length,1);
 assert.equal(message.alignment_hint,false,'AI off must not create AI cards');
 await request('/api/rooms/'+room.id+'/ai-preferences',{session:alice,method:'PATCH',body:{mode:'careful',checks:{}},expected:204});
 const check=(await request('/api/ai/check',{session:alice,method:'POST',body:{room_id:room.id,text:'너 때문에 망했어',ai_intervention:'careful',details:{'강한 공격 표현':'민감하게'}}})).value;
 assert.equal(check.verdict,'PASS');assert.equal(check.source,'off');
 assert.equal((await request('/api/rooms/'+room.id+'/messages/'+message.id,{session:alice,method:'POST'})).value.source,'off');
 assert.equal((await request('/api/ai/fact-check',{session:bob,method:'POST',body:{message_id:message.id}})).value.status,'disabled');
 for(const [path,body]of [['rewrite',{text:'안녕'}],['support',{text:'안녕'}],['conversation-analysis',{messages:['안녕']}]])await request('/api/ai/'+path,{session:alice,method:'POST',body:{...body,room_id:room.id},expected:409});
 const agreement=(await request('/api/agreements',{session:alice,method:'POST',body:{room_id:room.id,task:'자료 준비',assignee:'Safety 1',deadline:'내일'}})).value;
 const confirms=await Promise.all(Array.from({length:8},()=>request('/api/agreements/'+agreement.id+'/confirm',{session:bob,method:'POST',body:{}})));
 assert.ok(confirms.every(x=>x.value.confirmations===1),'one person counts once even concurrently');
 assert.equal((await request('/api/agreements/'+agreement.id+'/confirm',{session:charlie,method:'POST',body:{}})).value.confirmations,2);
 const appointment=(await request('/api/appointments',{session:alice,method:'POST',body:{room_id:room.id,title:'시간 확인',date:'2099-11-25T18:00:00+09:00',place:'회의실'}})).value;
 assert.equal(new Date(appointment.date).toISOString(),'2099-11-25T09:00:00.000Z');
 await request('/api/appointments/'+appointment.id,{session:alice,method:'PATCH',body:{title:'동시 동의 확인',date:'2099-11-25T19:00:00+09:00',place:'회의실'}});
 await Promise.all([bob,charlie].map(session=>request('/api/appointments/'+appointment.id+'/approve',{session,method:'POST'})));
 let sync=(await request('/api/rooms/'+room.id+'/sync',{session:alice})).value;
 const saved=sync.appointments.find(a=>a.id===appointment.id);assert.equal(saved.pending_change,null);assert.equal(saved.title,'동시 동의 확인');
 assert.equal(new Date(saved.date).toISOString(),'2099-11-25T10:00:00.000Z');
 const cursor=sync.cursor;
 await Promise.all(Array.from({length:5},()=>request('/api/rooms/'+room.id+'/messages/'+message.id+'/reactions',{session:bob,method:'POST',body:{emoji:'👍',active:true}})));
 sync=(await request('/api/rooms/'+room.id+'/sync?after='+cursor,{session:alice})).value;
 assert.equal(sync.messages.length,1);assert.equal(sync.messages[0].reactions[0].count,1);
 assert.equal((await request('/api/rooms/'+room.id+'/sync?after='+sync.cursor,{session:alice})).value.messages.length,0,'unchanged sync sends no history');
 await request('/api/rooms/'+room.id+'/messages/'+message.id+'/reactions',{session:outsider,method:'POST',body:{emoji:'👍',active:true},expected:403});
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGAAAAABJRU5ErkJggg==';
 const photo=(await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'',image_url:png}})).value;
 assert.ok(photo.image_url.startsWith('/api/media/'));
 const image=await fetch(base+photo.image_url,{headers:{Cookie:bob.cookie}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
 assert.equal((await fetch(base+photo.image_url,{headers:{Cookie:outsider.cookie}})).status,403);
 await request('/api/rooms/'+room.id+'/messages/'+photo.id,{session:alice,method:'DELETE',expected:204});
 assert.equal((await fetch(base+photo.image_url,{headers:{Cookie:bob.cookie}})).status,404);
 const avatar=(await request('/api/users/'+alice.id+'/avatar',{session:alice,method:'POST',body:{data_url:png}})).value;assert.equal(avatar.saved,true);
 for(let i=0;i<65;i++)await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'Pagination '+i}});
 const page=(await request('/api/rooms/'+room.id+'/messages',{session:bob})).value;assert.equal(page.length,50);
 const older=(await request('/api/rooms/'+room.id+'/messages?before='+page[0].id,{session:bob})).value;assert.ok(older.length>0&&older.length<50);assert.ok(!older.some(m=>page.some(n=>m.id===n.id)));
 const password=process.env.RETONE_ADMIN_PASSWORD;
 await request('/api/auth/admin-login',{method:'POST',body:{password:'3612asdf!!',two_factor:'7812'},expected:401});
 const setup=(await request('/api/auth/admin-login',{method:'POST',body:{password}})).value;assert.equal(setup.setup_required,true);
 const code=otp(Math.floor(Date.now()/30000));
 const adminResult=await request('/api/auth/admin-login',{method:'POST',body:{password,two_factor:code}});const admin={cookie:adminResult.cookie,admin:true};
 assert.ok(admin.cookie.startsWith('retone_admin='));await request('/api/auth/admin-me',{session:admin});
 assert.ok((await request('/api/users',{session:admin})).value.some(u=>u.id===alice.id));
 await request('/api/auth/admin-login',{method:'POST',body:{password,two_factor:code},expected:401});
 await request('/api/auth/admin-logout',{session:admin,method:'POST',expected:204});await request('/api/auth/admin-me',{session:admin,expected:401});
 console.log('Safety API checks passed: AI off, admin OTP/session, private users/media, deduplicated votes/reactions, concurrent approvals, timezones and incremental history.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
