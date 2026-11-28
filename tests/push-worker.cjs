'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('background push checks the signed-in recipient before showing private text',async()=>{
  const shown=[],requests=[];let status=200,read=false,muted=false,offline=false;
  const user='12345678-1234-4234-8234-123456789abc';
  const self={addEventListener(){},registration:{async showNotification(...args){shown.push(args)}},location:{origin:'https://retone.test'}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/sw.js'),'utf8'),{self,URL,AbortSignal,fetch:async(url,options)=>{requests.push({url,options});if(offline)throw Error('offline');return{ok:status===200,json:async()=>({id:10,title:'Friend request',body:'Private friend name',read,muted})};}});
  const payload={data:{notice_id:'10',user_id:user}};
  await self.retoneHandlePush(payload);assert.equal(shown.length,1);assert.equal(requests[0].options.credentials,'same-origin');assert.equal(requests[0].options.headers['X-ReTone-User'],user);assert.equal(shown[0][1].data.url,'/?notice=10');
  for(const code of [401,403,404]){status=code;await self.retoneHandlePush(payload);}assert.equal(shown.length,1);
  status=200;read=true;await self.retoneHandlePush(payload);assert.equal(shown.length,1);
  read=false;muted=true;await self.retoneHandlePush(payload);assert.equal(shown.length,1);
  muted=false;offline=true;await self.retoneHandlePush(payload);assert.equal(shown.length,1);
  const before=requests.length;await self.retoneHandlePush({data:{notice_id:'1e99',user_id:user}});await self.retoneHandlePush({data:{notice_id:'10',user_id:'wrong'}});assert.equal(requests.length,before);
});
