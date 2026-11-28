/* Run by the signed-in project owner. Retrieves client configuration only.
 * Never reads, copies, prints or uploads Firebase login credentials or server keys.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const PROJECT='retone-push-sjhun-20261128';
const PACKAGE='com.retone.app';
const ROOT=path.resolve(__dirname,'..');

function cli(args,interactive=false){
  for(const arg of args)if(!/^[A-Za-z0-9_:./ -]+$/.test(arg))throw new Error('Unexpected Firebase argument.');
  const command='npx --cache "%TEMP%\\retone-firebase-login" -y firebase-tools@latest '+args.map(arg=>'"'+arg+'"').join(' ');
  // cmd.exe parses this complete command line. Node's normal argv quoting would
  // escape its embedded quotes and pass literal quotes to npx/Firebase.
  const result=spawnSync('cmd.exe',['/d','/s','/c',command],{cwd:ROOT,encoding:'utf8',stdio:interactive?'inherit':'pipe',windowsHide:false,windowsVerbatimArguments:true});
  if(result.error)throw result.error;
  let parsed;
  if(!interactive){try{parsed=JSON.parse((result.stdout||'').replace(/^\uFEFF/,''));}catch{}}
  // firebase/firebase-tools#11099: Windows can abort during process.exit AFTER
  // emitting a complete successful JSON result. Accept only that exact case;
  // API errors, incomplete output and all other nonzero exits remain failures.
  const shutdownCrash=!interactive&&parsed?.status==='success'&&Object.hasOwn(parsed,'result')&&/Assertion failed:\s*!\(handle->flags & UV_HANDLE_CLOSING\), file [^\r\n]*async\.c, line \d+/.test(result.stderr||'');
  if(result.status!==0&&shutdownCrash){
    console.log('Firebase returned a complete result; recovering from its Windows shutdown crash.');
    return parsed.result;
  }
  if(result.status!==0){
    let detail='';
    try{const response=JSON.parse(result.stdout||'{}');detail=typeof response.error==='string'?response.error:response.error?.message||'';}catch{}
    if(!detail)detail=(result.stderr||result.stdout||'').trim();
    detail=detail.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/ya29\.[^\s"']+/g,'[REDACTED]').replace(/"(?:access_token|refresh_token|id_token|private_key|client_secret)"\s*:\s*"[^"]*"/gi,'"credential":"[REDACTED]"').replace(/([?&](?:code|token|access_token|refresh_token|client_secret)=)[^&\s]+/gi,'$1[REDACTED]').slice(0,1600);
    throw new Error('Firebase command failed: '+args[0]+' (exit '+result.status+(result.signal?', signal '+result.signal:'')+'). '+(detail||'The command returned no diagnostic output.'));
  }
  if(interactive)return;
  if(!parsed)throw new Error('Firebase returned an unexpected response for '+args[0]);
  if(parsed.status!=='success')throw new Error('Firebase did not report success for '+args[0]);
  return parsed.result;
}
function apps(){
  const result=cli(['apps:list','--project',PROJECT,'--json','--non-interactive']);
  if(!Array.isArray(result))throw new Error('Unexpected Firebase app list.');
  return result;
}
function androidApp(registered){
  // apps:list searches all platforms and returns FirebaseAppInfo.namespace.
  // The platform-specific Android endpoint instead calls it packageName.
  return registered.find(app=>app.platform==='ANDROID'&&app.state!=='DELETED'&&(app.packageName||app.namespace)===PACKAGE);
}
function appId(app,platform){
  if(!app||!/^1:\d+:(android|web):[a-zA-Z0-9]+$/.test(app.appId||''))throw new Error('Missing or invalid Firebase '+platform+' app ID.');
  if(!app.appId.includes(':'+platform.toLowerCase()+':'))throw new Error('Firebase app platform does not match '+platform+'.');
  return app.appId;
}
function main(){
  if(process.platform!=='win32')throw new Error('Run this setup on the Windows PC where you signed into Firebase.');
  console.log('Re:tone Firebase setup v5: '+PROJECT);
  let registered=apps();
  let android=androidApp(registered);
  if(!android){
    console.log('Registering the existing Android package '+PACKAGE+' ...');
    cli(['apps:create','ANDROID','RetoneAndroid','--package-name',PACKAGE,'--project',PROJECT,'--json','--non-interactive']);
    registered=apps();android=androidApp(registered);
  }
  let web=registered.find(app=>app.platform==='WEB'&&app.displayName==='RetoneWeb');
  if(!web){
    console.log('\nRegistering the web client.');
    console.log('If asked to create a Firebase Hosting site, type n and press Enter.');
    console.log('Re:tone continues to use its existing Render website.\n');
    let creationError;
    try{cli(['apps:create','WEB','RetoneWeb','--project',PROJECT],true);}catch(error){creationError=error;}
    registered=apps();web=registered.find(app=>app.platform==='WEB'&&app.displayName==='RetoneWeb');
    // Interactive output is not JSON. Confirm the app actually exists before
    // proceeding even when the Windows CLI crashed after creating it.
    if(!web&&creationError)throw creationError;
  }
  const androidId=appId(android,'ANDROID'),webId=appId(web,'WEB');
  console.log('Using Android app: '+androidId);console.log('Using web app: '+webId);
  console.log('Retrieving public Android and web client settings ...');
  const androidResult=cli(['apps:sdkconfig','ANDROID',androidId,'--project',PROJECT,'--json','--non-interactive']);
  const webResult=cli(['apps:sdkconfig','WEB',webId,'--project',PROJECT,'--json','--non-interactive']);
  const androidConfig=JSON.parse(androidResult.fileContents);
  const webConfig=webResult.sdkConfig;
  if(androidConfig.project_info?.project_id!==PROJECT||webConfig?.projectId!==PROJECT||webConfig.appId!==webId)throw new Error('Client configuration belongs to a different project.');
  const client=androidConfig.client?.find(item=>item.client_info?.android_client_info?.package_name===PACKAGE);
  if(client?.client_info?.mobilesdk_app_id!==androidId||!webConfig.apiKey||!webConfig.messagingSenderId)throw new Error('Client configuration is incomplete.');
  const bundle={projectId:PROJECT,android:{appId:androidId,packageName:PACKAGE,config:androidConfig},web:{appId:webId,config:webConfig}};
  const output=JSON.stringify(bundle,null,2)+'\n';
  if(/"(?:private_key|refresh_token|access_token|client_secret)"\s*:/.test(output))throw new Error('Refusing to save a server credential in client configuration.');
  const directory=path.join(ROOT,'.local');fs.mkdirSync(directory,{recursive:true});
  const destination=path.join(directory,'firebase-apps.json');
  fs.writeFileSync(destination+'.tmp',output,'utf8');fs.renameSync(destination+'.tmp',destination);
  console.log('\nClient setup complete.');
  console.log('Android app: '+androidId);console.log('Web app: '+webId);
  console.log('Public client settings saved in the project. No server private keys were created.');
  console.log('Return to ChatGPT and say: Firebase app setup complete.');
}
if(require.main===module){try{main();}catch(error){console.error('\nSetup stopped: '+error.message);process.exitCode=1;}}
