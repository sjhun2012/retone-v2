const assert = require('node:assert/strict');
const base = process.env.RETONE_TEST_URL || 'http://127.0.0.1:4000';
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),
  'This test creates accounts and must only target a local test server');
async function request(path, {session, method='GET', body, expected=200} = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {'Content-Type':'application/json', ...(session ? {Cookie: session.cookie} : {})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)})
  });
  assert.equal(response.status, expected, method + ' ' + path);
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  return {value, cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function main() {
  const health = await request('/api/health');
  assert.equal(health.value.version, 'v2-combined-20261125');
  assert.equal(health.value.storage, true);
  const credentials = [
    {name:'Deployment Alice',phone:'01099990001',password:'Testpass1!',ai_intervention:'off'},
    {name:'Deployment Bob',phone:'01099990002',password:'Testpass1!',ai_intervention:'off'}
  ];
  const [alice,bob] = await Promise.all(credentials.map(async body => {
    const out=await request('/api/auth/signup',{method:'POST',body});
    assert.ok(out.cookie?.startsWith('retone_session='));
    return {...out.value.user,cookie:out.cookie};
  }));
  assert.equal((await request('/api/auth/me',{session:alice})).value.id,alice.id);
  const identity=(await request('/api/friends/me',{session:alice})).value;
  assert.match(identity.friend_code,/^[A-Z0-9]{6}$/);
  assert.equal(identity.invite_url,'https://retone-v2-mygr.onrender.com/friend.html?code='+identity.friend_code);
  assert.equal(require('./qr-svg-decode.cjs')(identity.qr_svg),identity.invite_url);
  await request('/api/bootstrap',{expected:401});
  await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:bob.id}});
  await request('/api/friends/accept',{session:bob,method:'POST',body:{target_id:alice.id}});
  const room=(await request('/api/rooms',{session:alice,method:'POST',
    body:{name:'Combined deployment smoke',direct:true,invitee_ids:[bob.id]}})).value;
  const message=(await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',
    body:{body:'Hello from the combined release'}})).value;
  const sync=(await request('/api/rooms/'+room.id+'/sync',{session:bob})).value;
  assert.ok(sync.messages.some(item=>item.id===message.id && item.mine===false));
  await request('/api/rooms/'+room.id+'/typing',{session:alice,method:'POST',body:{active:true},expected:204});
  assert.ok((await request('/api/rooms/'+room.id+'/sync',{session:bob})).value.typing.includes(alice.name));
  const appointment=(await request('/api/appointments',{session:alice,method:'POST',
    body:{title:'Release check',room_id:room.id,date:'2099-11-25 18:00',place:'Test room',fields:[]}})).value;
  const proposed=(await request('/api/appointments/'+appointment.id,{session:alice,method:'PATCH',
    body:{title:'Updated release check',date:'2099-11-25 19:00',place:'Test room',fields:[]}})).value;
  assert.ok(proposed.pending_change);
  const approved=(await request('/api/appointments/'+appointment.id+'/approve',{session:bob,method:'POST'})).value;
  assert.equal(approved.pending_change,null);
  assert.equal(approved.title,'Updated release check');
  await request('/api/auth/logout',{session:alice,method:'POST',expected:204});
  await request('/api/auth/me',{session:alice,expected:401});
  assert.ok((await request('/api/auth/login',{method:'POST',body:credentials[0]})).cookie);
  console.log('Deployment smoke passed: migration, auth, real QR URL decoding, friendship, chat, typing, schedule approval, logout and login.');
}
main().catch(error=>{console.error(error);process.exitCode=1});

