(() => {
  'use strict';
  let account='',generation=0,timer,inFlight=false,unread=0;
  const current=()=>typeof signedInId==='string'&&!(typeof isAdmin!=='undefined'&&isAdmin)?signedInId:'';
  const key=user=>'retone-notification-cursor:'+user;
  const enabled=()=>localStorage.getItem('retone-browser-notifications')==='1';
  const cached=new Map();
  async function show(title,options={}) {
    if(!enabled()||!window.Notification||window.Notification.permission!=='granted')return false;
    const native=/ReToneApp\//.test(navigator.userAgent||'');
    if(!native&&navigator.serviceWorker){
      try {const registration=await navigator.serviceWorker.getRegistration('/');if(registration){await registration.showNotification(title,options);return true;}}catch{}
    }
    try {const notice=new window.Notification(title,options);notice.onclick=()=>{window.focus();if(options.data?.id)openEvent(options.data.id);};return true;}catch{return false;}
  }
  function updateButtons(){
    document.querySelectorAll('[data-retone-notifications]').forEach(button=>{button.textContent=unread?'알림 '+(unread>99?'99+':unread):'알림';button.setAttribute('aria-label',unread?'읽지 않은 알림 '+unread+'개':'알림 목록');});
  }
  async function poll(expected=generation){
    if(expected!==generation||!account||account!==current()||inFlight)return;
    inFlight=true;const user=account;
    try {
      const previous=localStorage.getItem(key(user));
      const cursor=previous===null?-1:Number(previous);
      const result=await api('/api/notifications?since='+(Number.isSafeInteger(cursor)?cursor:-1));
      if(expected!==generation||user!==current())return;
      unread=Number(result.unread)||0;updateButtons();
      for(const event of result.notifications||[]){
        if(expected!==generation||user!==current())return;
        if(!Number.isSafeInteger(event.id)||event.id<=0)continue;
        cached.set(event.id,event);
        const saved=Number(localStorage.getItem(key(user))||0);
        if(event.id<=saved)continue;
        if(!event.read&&!event.muted&&!window.retonePush?.active(user))await show(event.title,{body:event.body,tag:'retone-event-'+event.id,icon:'/icons/app-192.png',data:{id:event.id,url:'/?notice='+event.id}});
        if(user!==current()||expected!==generation)return;
        localStorage.setItem(key(user),String(event.id));
      }
      localStorage.setItem(key(user),String(result.cursor||0));
      if(result.has_more){timer=setTimeout(()=>poll(expected),30);return;}
    }catch{}finally{if(expected===generation)inFlight=false;}
    if(expected===generation&&account)timer=setTimeout(()=>poll(expected),3000);
  }
  async function openEvent(id){
    id=Number(id);const user=current();if(!user||!Number.isSafeInteger(id)||id<=0)return;
    if(account!==user)sync();
    try {
      const event=cached.get(id)||await api('/api/notifications/'+id);
      if(user!==current())return;
      await api('/api/notifications/read',{method:'POST',body:JSON.stringify({ids:[id]})});
      if(user!==current())return;
      closePopup();window.focus();
      if(event.kind==='room_invite'&&/^[a-f0-9-]{36}$/i.test(event.room_id||'')){
        data=await api('/api/bootstrap?user_id='+encodeURIComponent(user));
        if(user===current())await openRoom(event.room_id);
      }else await friends();
      clearTimeout(timer);poll();
    }catch{alert('알림을 열지 못했어요. 요청이 취소되었거나 채팅방을 나왔을 수 있어요.');}
  }
  async function open(){
    const user=current();if(!user)return;
    try {
      const result=await api('/api/notifications');if(user!==current())return;
      const events=result.notifications||[];events.forEach(event=>cached.set(event.id,event));
      popup('<div class="notification-center"><span>Re:tone 알림</span><h2>친구와 채팅 알림</h2><p>친구 요청·수락·채팅방 초대를 확인해 주세요.</p><button class="quiet" id="notice-enable">'+(enabled()?'기기 알림 끄기':'휴대폰·PC 알림 켜기')+'</button><button class="quiet" id="notice-read-all">모두 읽음</button><div class="notice-list">'+(events.length?events.map(event=>'<button class="notice-row '+(event.read?'read':'')+'" data-notice-id="'+event.id+'"><b>'+esc(event.title)+'</b><span>'+esc(event.body)+'</span><small>'+new Date(event.created).toLocaleString()+'</small></button>').join(''):'<p>아직 받은 알림이 없어요.</p>')+'</div><small>기기 알림 권한이 필요합니다. 앱 종료 후 즉시 알림은 푸시 연결 후 지원됩니다.</small></div>');
      document.querySelector('#notice-enable').onclick=async()=>{await toggleBrowserNotifications(false);open();};
      document.querySelector('#notice-read-all').onclick=async()=>{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})});unread=0;updateButtons();open();};
      document.querySelectorAll('[data-notice-id]').forEach(button=>{button.onclick=()=>openEvent(button.dataset.noticeId);});
    }catch{alert('알림 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');}
  }
  function sync(){
    const user=current();
    if(user!==account){account=user;generation++;clearTimeout(timer);cached.clear();inFlight=false;unread=0;if(user)poll();}
    if(!user)return;
    const host=document.querySelector('.page>.head')||document.querySelector('.chat>.head .chat-actions');
    if(host&&!host.querySelector('[data-retone-notifications]')){
      const button=document.createElement('button');button.type='button';button.className='retone-notification-button';button.dataset.retoneNotifications='';button.onclick=open;host.append(button);updateButtons();
    }
    const url=new URL(location.href),id=Number(url.searchParams.get('notice'));
    if(id>0&&Number.isSafeInteger(id)){url.searchParams.delete('notice');history.replaceState(null,'',url.pathname+url.search+url.hash);openEvent(id);}
  }
  let queued=false;
  new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;sync();});}}).observe(document.getElementById('app'),{childList:true,subtree:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){clearTimeout(timer);poll();}});
  if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='retone-notification-click')openEvent(event.data.id);});
  window.retoneNotifications={show,open,refresh:()=>{clearTimeout(timer);poll();},sync};sync();
})();
