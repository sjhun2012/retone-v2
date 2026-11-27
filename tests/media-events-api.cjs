const assert=require('node:assert/strict');
const zlib=require('node:zlib');
function chunk(type,data){
  const name=Buffer.from(type);let crc=0xffffffff;
  for(const byte of Buffer.concat([name,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,name,data,checksum]);
}
function png(padding=0){
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),...(padding?[chunk('npAD',Buffer.alloc(padding))]:[]),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
module.exports=async function({base,request,alice,bob,room}){
  const charlieSignup=await request('/api/auth/signup',{method:'POST',body:{name:'Media Charlie',phone:'01099990003',password:'Testpass1!',ai_intervention:'off'}});
  const charlie={...charlieSignup.value.user,cookie:charlieSignup.cookie};
  const received=(await request('/api/notifications?since=0',{session:bob})).value.notifications;
  assert.equal(received.filter(n=>n.kind==='friend_request').length,1);
  assert.equal(received.filter(n=>n.kind==='room_invite').length,1);
  assert.ok(received.find(n=>n.kind==='friend_request').read,'Accepting a request marks its original notification read');
  const acceptance=(await request('/api/notifications?since=0',{session:alice})).value.notifications;
  assert.equal(acceptance.filter(n=>n.kind==='friend_accepted').length,1);
  await request('/api/notifications/'+received[0].id,{session:alice,expected:404});
  assert.equal((await request('/api/notifications/read',{session:alice,method:'POST',body:{ids:[received[0].id]}})).value.read,0);
  await request('/api/notifications',{expected:401});
  await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:bob.id},expected:409});
  await request('/api/friends/accept',{session:bob,method:'POST',body:{target_id:alice.id},expected:404});
  assert.equal((await request('/api/notifications?since=0',{session:alice})).value.notifications.filter(n=>n.kind==='friend_accepted').length,1);

  for(const image of [png(),png(1_700_000)]){
    const message=(await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'Photo persistence test',image_url:'data:image/png;base64,'+image.toString('base64')}})).value;
    assert.equal(message.image_url,'/api/rooms/'+room.id+'/messages/'+message.id+'/image');
    const response=await fetch(base+message.image_url,{headers:{Cookie:bob.cookie}});
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
    assert.match(response.headers.get('cache-control'),/private.*no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),image);
    assert.equal((await fetch(base+message.image_url)).status,401);
    assert.equal((await fetch(base+message.image_url,{headers:{Cookie:charlie.cookie}})).status,403);
  }
  await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'bad',image_url:'data:image/svg+xml;base64,PHN2Zz4='},expected:400});
  const oversized=Buffer.alloc(8*1024*1024+1);png().subarray(0,8).copy(oversized);
  await request('/api/rooms/'+room.id+'/messages',{session:alice,method:'POST',body:{body:'too large',image_url:'data:image/png;base64,'+oversized.toString('base64')},expected:413});

  await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:charlie.id}});
  await request('/api/friends/accept',{session:charlie,method:'POST',body:{target_id:alice.id}});
  const group=(await request('/api/rooms',{session:alice,method:'POST',body:{name:'Notification group',direct:false,invitee_ids:[bob.id]}})).value;
  await request('/api/rooms/'+group.id+'/members',{session:alice,method:'POST',body:{invitee_ids:[charlie.id]}});
  await request('/api/rooms/'+group.id+'/members',{session:alice,method:'POST',body:{invitee_ids:[charlie.id]},expected:409});
  const invited=(await request('/api/notifications?since=0',{session:charlie})).value.notifications.filter(n=>n.kind==='room_invite');
  assert.equal(invited.length,1);assert.equal(invited[0].room_id,group.id);
  await request('/api/notifications/read',{session:charlie,method:'POST',body:{all:true}});
  assert.equal((await request('/api/notifications?since=-1',{session:charlie})).value.unread,0);
  await request('/api/blocks',{session:charlie,method:'POST',body:{target_id:alice.id}});
  assert.equal((await request('/api/notifications?since=0',{session:charlie})).value.notifications.length,0);
  console.log('Media/events API passed: real PNG persistence above the former JSON limit, private image access, size/type rejection, friend/request/accept/invite events, replay prevention, account isolation, read status and block filtering.');
};
