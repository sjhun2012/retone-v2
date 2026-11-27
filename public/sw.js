/* Only the offline notice is cached. Never cache accounts, API responses or app code. */
const OFFLINE_CACHE = 'retone-offline-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.add('/offline.html'))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('retone-offline-') && key !== OFFLINE_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, {cache: 'no-store'}).catch(() => caches.match('/offline.html')));
  } else if (/\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
  }
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const id=Number(event.notification.data?.id);
  if(!Number.isSafeInteger(id)||id<=0)return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){
      if(new URL(client.url).origin===self.location.origin){client.postMessage({type:'retone-notification-click',id});return client.focus();}
    }
    return self.clients.openWindow('/?notice='+id);
  }));
});
