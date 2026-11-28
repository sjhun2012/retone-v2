(() => {
  'use strict';
  let signature='',generation=0,activeUser='',running=-1,retryTimer,lastAttempt=0,lastSuccess=0;
  let messaging,foregroundAttached=false,installation='';
  let reason='종료 후 알림을 연결하고 있어요.';
  const current=()=>typeof signedInId==='string'&&signedInId&&!(typeof isAdmin!=='undefined'&&isAdmin)?signedInId:'';
  const native=()=>/ReToneApp\//.test(navigator.userAgent||'');
  const optedIn=()=>localStorage.getItem('retone-browser-notifications')==='1'&&window.Notification?.permission==='granted';
  async function foreground(payload){
    const user=current(),id=Number(payload.data?.notice_id);
    if(!user||payload.data?.user_id!==user||!optedIn()||!Number.isSafeInteger(id)||id<=0)return;
    try{
      const notice=await api('/api/notifications/'+id);
      if(user!==current()||notice.read||notice.muted||!optedIn())return;
      await window.retoneNotifications?.show(notice.title,{body:notice.body,tag:'retone-event-'+id,icon:'/icons/app-192.png',data:{id,url:'/?notice='+id}});
      window.retoneNotifications?.refresh();
    }catch{}
  }
  async function disconnect(user){
    activeUser='';window.retoneNativePush?.bind('',false);
    if(!user)return;
    try{
      const id=native()?await window.retoneNativePush?.installation():localStorage.getItem('retone-push-installation');
      if(id&&user===current())await api('/api/push/devices/'+id,{method:'DELETE'});
    }catch{}
  }
  async function setup(user,expected){
    running=expected;lastAttempt=Date.now();
    try{
      const config=await api('/api/push/config',{cache:'no-store'});
      if(expected!==generation||current()!==user)return;
      if(!config.enabled){activeUser='';window.retoneNativePush?.bind('',false);reason='서버 알림 설정을 마무리하고 있어요.';return;}
      let token,platform;
      if(native()){
        if(!window.retoneNativePush){reason='종료 후 알림을 받으려면 Android 앱을 업데이트해 주세요.';return;}
        const result=await window.retoneNativePush.token();
        token=result.token;installation=result.installation_id;platform='android';
      }else{
        if(!/^[A-Za-z0-9_-]{80,120}$/.test(config.vapid_key||'')){reason='PC 알림 연결을 준비하고 있어요.';return;}
        if(!navigator.serviceWorker){reason='이 브라우저에서는 종료 후 알림을 지원하지 않아요.';return;}
        const firebase=await fetch('/firebase-client.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('client-config');return response.json();});
        const [app,sdk]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js')]);
        if(!await sdk.isSupported()){reason='이 브라우저에서는 종료 후 알림을 지원하지 않아요.';return;}
        if(!messaging)messaging=sdk.getMessaging(app.getApps().find(item=>item.name==='retone-push')||app.initializeApp(firebase.web,'retone-push'));
        if(!foregroundAttached){sdk.onMessage(messaging,foreground);foregroundAttached=true;}
        const registration=await navigator.serviceWorker.getRegistration('/');
        if(!registration?.active)throw Error('service-worker-starting');
        token=await sdk.getToken(messaging,{vapidKey:config.vapid_key,serviceWorkerRegistration:registration});
        installation=localStorage.getItem('retone-push-installation')||crypto.randomUUID();
        localStorage.setItem('retone-push-installation',installation);platform='web';
      }
      if(expected!==generation||current()!==user||!optedIn())return;
      if(!token||!installation)throw Error('no-device-token');
      const result=await api('/api/push/devices',{method:'POST',body:JSON.stringify({installation_id:installation,platform,token})});
      if(expected!==generation||current()!==user||!optedIn())return;
      if(result.registered&&result.delivery_enabled&&result.user_id===user){
        activeUser=user;lastSuccess=Date.now();reason='종료 후 알림이 연결됐어요.';window.retoneNativePush?.bind(user,true);
      }else reason='서버 알림 설정을 마무리하고 있어요.';
    }catch{if(expected===generation){activeUser='';reason='종료 후 알림 연결을 다시 시도하고 있어요.';}}
    finally{
      if(expected===generation){running=-1;clearTimeout(retryTimer);if(!activeUser)retryTimer=setTimeout(()=>sync(true),30000);}
    }
  }
  function sync(force=false){
    const user=current(),enabled=!!user&&optedIn(),next=user+'|'+enabled;
    const changed=next!==signature;
    if(changed){signature=next;generation++;running=-1;lastAttempt=0;activeUser='';clearTimeout(retryTimer);window.retoneNativePush?.bind('',false);}
    if(!enabled){reason=user?'기기 알림을 켜면 종료 후에도 알림을 받을 수 있어요.':'로그인 후 알림을 연결할 수 있어요.';if(changed)disconnect(user);return;}
    if(running===generation||(!force&&activeUser===user&&Date.now()-lastSuccess<6*3600000)||(!force&&Date.now()-lastAttempt<1000))return;
    setup(user,generation);
  }
  window.retonePush={sync,active:user=>activeUser===user&&optedIn(),status:()=>reason};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync(true);});
  window.addEventListener('retone-native-ready',()=>sync(true));
  let queued=false;
  new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;sync();});}}).observe(document.getElementById('app'),{childList:true,subtree:true});
  sync();
})();
