'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../apps/setup-firebase.cjs'),'utf8');
const crash='Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 94';
const project='retone-push-sjhun-20261128';
let response;
const context={require:name=>name==='node:fs'?fs:name==='node:path'?path:name==='node:child_process'?{spawnSync:()=>response}:null,module:{},__dirname:path.join(__dirname,'../apps'),console:{log(){}},process:{platform:'win32'}};
vm.runInNewContext(source,context);
// Actual projects.searchApps response uses namespace, not packageName.
assert.equal(context.androidApp([{platform:'ANDROID',namespace:'com.retone.app',appId:'existing-android'}]).appId,'existing-android');
assert.equal(context.androidApp([{platform:'ANDROID',packageName:'com.retone.app',appId:'typed-endpoint'}]).appId,'typed-endpoint');
assert.equal(context.androidApp([{platform:'ANDROID',namespace:'different.package',appId:'wrong'}]),undefined);
assert.equal(context.androidApp([{platform:'ANDROID',namespace:'com.retone.app',state:'DELETED',appId:'deleted'}]),undefined);
assert.throws(()=>context.appId(undefined,'ANDROID'),/ANDROID app ID/);
assert.throws(()=>context.appId({appId:'1:123:web:abc'},'ANDROID'),/platform does not match/);
response={status:0,stdout:JSON.stringify({status:'success',result:[]}),stderr:''};
assert.equal(context.cli(['apps:list']).length,0);
response={status:127,stdout:JSON.stringify({status:'success',result:[]}),stderr:crash};
assert.equal(context.cli(['apps:list']).length,0);
for(const stdout of ['','{"status":"success","result":',JSON.stringify({status:'error',error:'Permission denied'}),JSON.stringify({status:'success'})]){
  response={status:127,stdout,stderr:crash};assert.throws(()=>context.cli(['apps:list']),/Firebase command failed/);
}
response={status:1,stdout:JSON.stringify({status:'success',result:[]}),stderr:'A different fatal error'};
assert.throws(()=>context.cli(['apps:list']),/different fatal error/);
response={status:1,stdout:'',stderr:'Permission denied. Bearer secret-token'};
assert.throws(()=>context.cli(['apps:list']),error=>error.message.includes('[REDACTED]')&&!error.message.includes('secret-token'));

// Complete setup, including a WEB creation that succeeds remotely but aborts
// locally; the following list must confirm its ID before config is saved.
let android=false,web=false,created=0,saved;
const androidId='1:123456:android:abc123',webId='1:123456:web:def456';
const fakeFs={mkdirSync(){},writeFileSync(p,value){saved=JSON.parse(value)},renameSync(){}};
const mainModule={};
const loader=name=>name==='node:fs'?fakeFs:name==='node:path'?path:name==='node:child_process'?{spawnSync(executable,args,options){
  assert.equal(options.windowsVerbatimArguments,true);const command=args[3];let result;
  if(command.includes('"apps:list"'))result=[...(android?[{platform:'ANDROID',namespace:'com.retone.app',displayName:'RetoneAndroid',appId:androidId,state:'ACTIVE'}]:[]),...(web?[{platform:'WEB',displayName:'RetoneWeb',appId:webId,state:'ACTIVE'}]:[])];
  else if(command.includes('"apps:create"')){created++;if(command.includes('"ANDROID"'))android=true;else{web=true;return{status:127,stdout:null,stderr:null};}result={appId:androidId};}
  else if(command.includes('"apps:sdkconfig"'))result=command.includes('"ANDROID"')?{fileContents:JSON.stringify({project_info:{project_id:project},client:[{client_info:{mobilesdk_app_id:androidId,android_client_info:{package_name:'com.retone.app'}}}]})}:{sdkConfig:{projectId:project,appId:webId,apiKey:'public-test-client-key',messagingSenderId:'123456'}};
  else throw Error('Unexpected command');return{status:127,stdout:JSON.stringify({status:'success',result}),stderr:crash};
}}:null;
loader.main=mainModule;
const execute=()=>vm.runInNewContext(source,{require:loader,module:mainModule,__dirname:path.join(__dirname,'../apps'),console:{log(){},error(message){throw Error(message)}},process:{platform:'win32'}});
execute();assert.equal(created,2);assert.equal(saved.projectId,project);assert.equal(saved.web.appId,webId);execute();assert.equal(created,2);
// Match the user's current state: both apps exist before setup starts.
created=0;saved=undefined;execute();assert.equal(created,0);assert.equal(saved.android.appId,androidId);assert.equal(saved.web.appId,webId);
console.log('Firebase setup passed: real namespace summaries, existing-app reuse without creation, correct platform IDs, shutdown-crash recovery, API-error rejection, credential redaction and client configuration save.');
