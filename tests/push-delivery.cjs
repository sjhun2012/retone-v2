'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const PROJECT='retone-push-sjhun-20261128',base='http://127.0.0.1:4001';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let attempt=0;attempt<200;attempt++){const result=await check();if(result)return result;await pause(50);}throw Error('Timed out waiting for actual push delivery');}
async function main(){
  const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const received=[];let tokenCalls=0,failNext=false,invalidToken='',mockFailure,serverLogs='';
  const mock=http.createServer(async(req,res)=>{
    try{
      let body='';for await(const chunk of req)body+=chunk;
      if(req.url==='/token'){
        tokenCalls++;const form=new URLSearchParams(body);assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
        const parts=form.get('assertion').split('.');assert.equal(parts.length,3);
        assert.equal(crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key.publicKey,Buffer.from(parts[2],'base64url')),true);
        const claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.aud,'https://oauth2.googleapis.com/token');assert.equal(claims.exp-claims.iat,3600);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:'test-access',expires_in:3600}));return;
      }
      assert.equal(req.url,'/messages');assert.equal(req.headers.authorization,'Bearer test-access');
      const message=JSON.parse(body).message;received.push(message);assert.equal(message.android.priority,'HIGH');assert.equal(message.android.ttl,'86400s');assert.equal(message.notification,undefined);
      res.setHeader('Content-Type','application/json');
      if(message.token===invalidToken){res.writeHead(404);res.end(JSON.stringify({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}}));return;}
      if(failNext){failNext=false;res.writeHead(503,{'Retry-After':'1'});res.end('{}');return;}
      res.end(JSON.stringify({name:'projects/'+PROJECT+'/messages/test'}));
    }catch(error){mockFailure=error;res.writeHead(500);res.end('{}');}
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const credential=JSON.stringify({type:'service_account',project_id:PROJECT,client_email:'test@'+PROJECT+'.iam.gserviceaccount.com',private_key:key.privateKey});
  const server=spawn('./target/debug/retone-v2',[],{env:{...process.env,PORT:'4001',RETONE_FCM_SERVICE_ACCOUNT_JSON:credential,RETONE_FCM_TEST_ORIGIN:'http://127.0.0.1:'+mock.address().port}});
  server.stdout.on('data',chunk=>{serverLogs+=chunk});server.stderr.on('data',chunk=>{serverLogs+=chunk});
  const sql=query=>execFileSync('psql',[process.env.DATABASE_URL,'-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
  async function request(path,{session,body,method='GET',expected=200}={}){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session.cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,expected,method+' '+path);const text=await response.text();return{value:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const signup=async(name,phone)=>{const result=await request('/api/auth/signup',{method:'POST',body:{name,phone,password:'Testpass1!',ai_intervention:'off'}});return{...result.value.user,cookie:result.cookie}};
  const register=(user,token)=>request('/api/push/devices',{session:user,method:'POST',body:{installation_id:crypto.randomUUID(),platform:'android',token}});
  try{
    await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}});
    assert.equal((await request('/api/push/config')).value.enabled,true);
    const alice=await signup('Push Alice','01088880011'),bob=await signup('Push Bob','01088880012'),charlie=await signup('Push Charlie','01088880013');
    const a='a'.repeat(60),b='b'.repeat(60),c='c'.repeat(60);await register(alice,a);await register(bob,b);
    await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:bob.id}});
    const first=await until(()=>received.find(item=>item.token===b));assert.equal(first.data.user_id,bob.id);
    await until(()=>sql("SELECT outcome FROM retone_v2.push_jobs WHERE notification_id="+Number(first.data.notice_id))==='sent');
    await request('/api/friends/accept',{session:bob,method:'POST',body:{target_id:alice.id}});
    await until(()=>received.some(item=>item.token===a));assert.equal(tokenCalls,1,'OAuth credentials should be reused');

    // Exercise real durable retry without waiting for the production backoff.
    failNext=true;
    await request('/api/rooms',{session:alice,method:'POST',body:{name:'Retry delivery',invitee_ids:[bob.id]}});
    const retry=await until(()=>received.find(item=>item.token===b&&item.data.notice_id!==first.data.notice_id));
    const retryId=Number(retry.data.notice_id);
    await until(()=>sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+retryId)==='retry');
    sql('UPDATE retone_v2.push_jobs SET next_attempt=NOW() WHERE notification_id='+retryId);
    await request('/api/rooms',{session:alice,method:'POST',body:{name:'Wake retry',invitee_ids:[]}});
    await until(()=>received.filter(item=>item.data.notice_id===String(retryId)).length===2);
    await until(()=>sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+retryId)==='sent');

    // Muting a room cancels a durable retry without muting friend notifications.
    failNext=true;
    const muteBefore=new Set(received.map(item=>item.data.notice_id));
    const mutedRoom=(await request('/api/rooms',{session:alice,method:'POST',body:{name:'Muted retry',invitee_ids:[bob.id]}})).value;
    const mutedNotice=await until(()=>received.find(item=>item.token===b&&!muteBefore.has(item.data.notice_id)));
    const mutedId=Number(mutedNotice.data.notice_id);
    await until(()=>sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+mutedId)==='retry');
    await request('/api/rooms/'+mutedRoom.id+'/notifications',{session:bob,method:'PATCH',body:{notifications_muted:true}});
    assert.equal(sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+mutedId),'room-muted');
    assert.equal((await request('/api/notifications/'+mutedId,{session:bob})).value.muted,true);
    await request('/api/rooms/'+mutedRoom.id+'/notifications',{session:bob,method:'PATCH',body:{notifications_muted:false}});
    await request('/api/rooms',{session:alice,method:'POST',body:{name:'Wake after unmute',invitee_ids:[]}});
    await pause(150);
    assert.equal(received.filter(item=>item.data.notice_id===String(mutedId)).length,1,'unmute must not replay old room alerts');
    assert.equal((await request('/api/notifications/'+Number(first.data.notice_id),{session:bob})).value.muted,false);

    // A rejected FCM token must revoke only that device.
    invalidToken=c;await register(charlie,c);
    await request('/api/friends/request',{session:alice,method:'POST',body:{target_id:charlie.id}});
    await until(async()=>(await request('/api/push/status',{session:charlie})).value.registered_devices===0);
    assert.equal((await request('/api/push/status',{session:bob})).value.registered_devices,1);

    // An actor blocked while a job is waiting must not be sent on retry.
    failNext=true;
    const before=new Set(received.map(item=>item.data.notice_id));
    await request('/api/rooms',{session:alice,method:'POST',body:{name:'Blocked retry',invitee_ids:[bob.id]}});
    const blocked=await until(()=>received.find(item=>item.token===b&&!before.has(item.data.notice_id)));
    const blockedId=Number(blocked.data.notice_id);
    await until(()=>sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+blockedId)==='retry');
    await request('/api/blocks',{session:bob,method:'POST',body:{target_id:alice.id}});
    sql('UPDATE retone_v2.push_jobs SET next_attempt=NOW() WHERE notification_id='+blockedId);
    await request('/api/rooms',{session:alice,method:'POST',body:{name:'Wake blocked retry',invitee_ids:[]}});
    await until(()=>sql('SELECT outcome FROM retone_v2.push_jobs WHERE notification_id='+blockedId)==='not-delivered');
    assert.equal(received.filter(item=>item.data.notice_id===String(blockedId)).length,1);
    if(mockFailure)throw mockFailure;
    assert.ok(!serverLogs.includes(key.privateKey));
    console.log('FCM delivery passed: actual worker leases, verified OAuth JWT, token reuse, friend/request acceptance sends, durable retry, invalid-token cleanup and blocked-recipient suppression.');
  }catch(error){if(mockFailure)throw mockFailure;throw error;}
  finally{server.kill();await new Promise(resolve=>mock.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1});
