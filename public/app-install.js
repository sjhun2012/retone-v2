(() => {
  'use strict';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).then(registration => {
      registration.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) registration.update().catch(() => {});
      });
    }).catch(error => console.warn('App registration:', error));
  }
  // No automatic reload: drafts, ongoing calls and the current conversation stay intact.
  if (standalone || /(?:android|desktop)/.test(new URLSearchParams(location.search).get('source') || '')) return;
  let queued = false;
  function attach() {
    queued = false;
    const host = document.querySelector('.auth-card') || document.querySelector('.rail small');
    if (!host || host.querySelector('.retone-install-link')) return;
    const link = document.createElement('a');
    link.className = 'retone-install-link'; link.href = '/install.html'; link.textContent = 'Re:tone 앱 설치';
    host.append(link);
  }
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(attach); } })
    .observe(document.getElementById('app'), {childList: true, subtree: true});
  attach();
})();
