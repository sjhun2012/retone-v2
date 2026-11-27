(() => {
  'use strict';
  const code = new URL(location.href).searchParams.get('code') || '';
  const open = document.getElementById('open-retone');
  const web = document.getElementById('continue-web');
  const remember = document.getElementById('always-open');
  const status = document.getElementById('launch-status');
  const storageKey = 'retone-always-open-app';
  if (!/^[a-z0-9]{6}$/i.test(code)) {
    document.querySelector('h1').textContent = '초대 링크를 확인해 주세요';
    document.getElementById('invite-description').textContent = '올바른 친구 추가 링크가 아닙니다. 친구에게 새 QR을 요청해 주세요.';
    open.disabled = true; remember.disabled = true; return;
  }
  const normalized = code.toUpperCase();
  const webUrl = '/?friend=' + encodeURIComponent(normalized);
  const appUrl = 'retone://friend?code=' + encodeURIComponent(normalized);
  web.href = webUrl;
  document.getElementById('invite-code').textContent = normalized;
  // Verified Android App Links are handled by the OS before this web page loads.
  // Without an app (or if the user chose their browser), continue on the web.
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    location.replace(webUrl); return;
  }
  try { remember.checked = localStorage.getItem(storageKey) === '1'; } catch {}
  remember.addEventListener('change', () => {
    try { if (remember.checked) localStorage.setItem(storageKey,'1'); else localStorage.removeItem(storageKey); } catch {}
  });
  function launch() {
    try { if (remember.checked) localStorage.setItem(storageKey,'1'); else localStorage.removeItem(storageKey); } catch {}
    status.textContent = '브라우저 확인창에서 앱 실행을 허용해 주세요. 앱이 열리지 않으면 웹에서 계속할 수 있습니다.';
    location.href = appUrl;
  }
  open.addEventListener('click', launch);
  if (remember.checked) launch();
})();
