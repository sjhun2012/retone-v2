(() => {
  let prompt;
  const section = document.querySelector('.browser-install');
  const button = document.getElementById('install-pwa');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).catch(() => {});
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); prompt = event; section.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!prompt) return;
    const current = prompt; prompt = null; button.disabled = true;
    try {
      await current.prompt();
      const result = await current.userChoice;
      document.getElementById('install-result').textContent = result.outcome === 'accepted' ? '설치를 진행합니다.' : '설치를 취소했습니다.';
    } finally { section.hidden = true; button.disabled = false; }
  });
  window.addEventListener('appinstalled', () => { prompt = null; section.hidden = true; });
})();
