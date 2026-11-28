(function(secret, initialPermission) {
  'use strict';
  let port, permission=initialPermission, sequence=0, permissionPromise;
  const pending=new Map();
  const pushPending=new Map();
  function pushRequest(action){
    if(!port)return Promise.reject(new Error('native-port-unavailable'));
    return new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pushPending.delete(id);reject(new Error('native-push-timeout'));},20000);pushPending.set(id,{resolve,reject,timer});port.postMessage(JSON.stringify({action,id}));});
  }
  function Notification(title, options={}) {
    if (port && permission==='granted') port.postMessage(JSON.stringify({action:'notify',title:String(title),body:String(options.body||''),tag:String(options.tag||'retone')}));
    this.close=()=>{};
  }
  Object.defineProperty(Notification,'permission',{get:()=>permission});
  Notification.requestPermission=()=>{
    if (!port) return Promise.resolve('default');
    if (!permissionPromise) permissionPromise=new Promise(resolve=>{
      const id=String(++sequence); pending.set(id,resolve); port.postMessage(JSON.stringify({action:'permission',id}));
    }).finally(()=>{permissionPromise=undefined;});
    return permissionPromise;
  };
  function connect(event) {
    if (event.data!==secret || !event.ports?.[0] || port) return;
    port=event.ports[0]; window.removeEventListener('message',connect);
    port.onmessage=event=>{
      try {
        const data=JSON.parse(event.data);
        if(data.push){const request=pushPending.get(data.id);if(!request)return;pushPending.delete(data.id);clearTimeout(request.timer);if(data.push.error)request.reject(new Error(data.push.error));else request.resolve(data.push);return;}
        if (!['default','granted','denied'].includes(data.permission)) return;
        permission=data.permission;
        const resolve=pending.get(data.id);
        if (resolve) {pending.delete(data.id);resolve(permission);}
      } catch {}
    };
    window.Notification=Notification;
    window.retoneNativePush={token:()=>pushRequest('push-token'),installation:()=>pushRequest('push-installation').then(result=>result.installation_id),bind:(user,enabled)=>port.postMessage(JSON.stringify({action:'push-bind',user,enabled}))};
    window.dispatchEvent(new Event('retone-native-ready'));
  }
  window.addEventListener('message',connect);
})
