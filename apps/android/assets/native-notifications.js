(function(secret, initialPermission) {
  'use strict';
  let port, permission=initialPermission, sequence=0, permissionPromise;
  const pending=new Map();
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
        if (!['default','granted','denied'].includes(data.permission)) return;
        permission=data.permission;
        const resolve=pending.get(data.id);
        if (resolve) {pending.delete(data.id);resolve(permission);}
      } catch {}
    };
    window.Notification=Notification;
  }
  window.addEventListener('message',connect);
})
