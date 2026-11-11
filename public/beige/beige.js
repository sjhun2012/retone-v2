// The original app owns authentication, API calls, AI checks and message actions.
// This file only changes the layout of the separate /beige/ view.
(() => {
  const host = document.getElementById('app');
  const icons = {
    chat: '<svg viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.7-3.1A7.5 7.5 0 1 1 20 11.5Z"/></svg>',
    friends: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19v-1.2A4.8 4.8 0 0 1 8.3 13h1.4a4.8 4.8 0 0 1 4.8 4.8V19H3.5Zm13-13.5a2.8 2.8 0 0 1 0 5.5M17 13.1a4.4 4.4 0 0 1 3.5 4.3V19h-3"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M10.1 3.2h3.8l.5 2.1c.5.2 1 .4 1.4.8l2-.9 2.6 2.6-.9 2c.3.5.6.9.8 1.4l2.1.5v3.7l-2.1.5c-.2.5-.5 1-.8 1.4l.9 2-2.6 2.6-2-.9c-.4.3-.9.6-1.4.8l-.5 2.1h-3.8l-.5-2.1c-.5-.2-1-.5-1.4-.8l-2 .9-2.6-2.6.9-2c-.3-.4-.6-.9-.8-1.4l-2.1-.5v-3.7l2.1-.5c.2-.5.5-.9.8-1.4l-.9-2L6 5.2l2 .9c.4-.4.9-.6 1.4-.8l.7-2.1Z"/><circle cx="12" cy="13" r="3"/></svg>'
  };

  function decorateRail(layout) {
    const rail = layout.querySelector('.rail');
    if (!rail) return;
    rail.querySelector('.brand').innerHTML = 're<span>.</span>';
    [...rail.querySelectorAll('nav button')].forEach((button, index) => {
      const key = ['chat', 'friends', 'settings'][index];
      const badge = button.querySelector('[data-chat-unread]');
      button.innerHTML = `<span class="rail-icon" aria-hidden="true">${icons[key]}</span><span>${['채팅', '친구', '설정'][index]}</span>`;
      if (badge) button.append(badge);
      button.setAttribute('aria-label', ['채팅', '친구', '설정'][index]);
      button.title = button.getAttribute('aria-label');
    });
    const profile = document.createElement('span');
    profile.className = 'beige-profile';
    profile.textContent = (rail.querySelector('small')?.textContent || '나').trim().charAt(0);
    rail.append(profile);
  }

  function decorateMobileNav(layout) {
    const mobile = layout.querySelector('.android-nav');
    if (!mobile) return;
    [...mobile.querySelectorAll('button')].forEach((button, index) => {
      const key = ['chat', 'friends', 'settings'][index];
      const badge = button.querySelector('[data-chat-unread]');
      button.innerHTML = `<span class="beige-mobile-icon" aria-hidden="true">${icons[key]}</span>${['채팅', '친구', '설정'][index]}`;
      if (badge) button.append(badge);
    });
  }

  window.beigeRoomActions = () => popup('<div class="beige-room-menu"><h2>대화 메뉴</h2><button onclick="closePopup();inviteFriends()">친구 초대</button><button onclick="closePopup();newAgreement()">공동 확인</button><button onclick="closePopup();roomMenu()">채팅방 설정</button><button class="quiet" onclick="closePopup()">닫기</button></div>');

  function addListControls(page) {
    const head = page.querySelector('.head');
    const content = page.querySelector('.content');
    const rooms = content?.querySelector('.rooms');
    if (!head || !content || !rooms) return;
    page.classList.add('beige-list');
    const kicker = document.createElement('small');
    kicker.className = 'beige-kicker';
    kicker.textContent = 'RE:TONE';
    head.prepend(kicker);
    if (!head.querySelector('.new-room')) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'new-room beige-add';
      add.textContent = '+';
      add.title = '새 단체 채팅';
      add.setAttribute('aria-label', '새 단체 채팅');
      add.onclick = () => newRoom();
      head.append(add);
    }
    const search = document.createElement('label');
    search.className = 'beige-search';
    search.innerHTML = '<span aria-hidden="true">⌕</span><input type="search" placeholder="대화 검색" aria-label="대화 검색">';
    const filters = document.createElement('div');
    filters.className = 'beige-filters';
    filters.innerHTML = '<button type="button" class="active" data-filter="all">전체</button><button type="button" data-filter="unread">안 읽음</button>';
    content.insertBefore(search, rooms);
    content.insertBefore(filters, rooms);
    let filter = 'all';
    function applyFilter() {
      const query = search.querySelector('input').value.trim().toLocaleLowerCase();
      let visible = 0;
      rooms.querySelectorAll('[data-room-id]').forEach(row => {
        const unread = Number(unreadCounts[row.dataset.roomId] || 0);
        const matches = row.textContent.toLocaleLowerCase().includes(query) && (filter === 'all' || unread > 0);
        row.hidden = !matches;
        if (matches) visible++;
      });
      page.querySelector('.beige-no-results')?.remove();
      if (!visible && rooms.querySelector('[data-room-id]')) {
        const message = document.createElement('p');
        message.className = 'beige-no-results';
        message.textContent = '검색 결과가 없습니다.';
        rooms.after(message);
      }
    }
    search.querySelector('input').addEventListener('input', applyFilter);
    filters.addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      filter = button.dataset.filter;
      filters.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
      applyFilter();
    });
  }

  function makeChatList() {
    const page = document.createElement('section');
    page.className = 'page';
    page.innerHTML = '<header class="head"><div><h1>채팅</h1></div></header><div class="content"><div class="rooms"></div></div>';
    const list = page.querySelector('.rooms');
    const rooms = typeof accessibleRooms === 'function' ? accessibleRooms() : [];
    for (const room of rooms) {
      const name = roomDisplayName(room);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `room${room.id === roomId ? ' selected' : ''}`;
      row.dataset.roomId = room.id;
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = name.charAt(0);
      const copy = document.createElement('span');
      copy.className = 'copy';
      const title = document.createElement('b');
      title.textContent = name;
      const last = document.createElement('span');
      last.textContent = room.last || '';
      copy.append(title, last);
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.dataset.roomUnread = '';
      badge.hidden = !unreadCounts[room.id];
      badge.textContent = unreadCounts[room.id] || '';
      row.append(avatar, copy, badge);
      row.addEventListener('click', () => openRoom(room.id));
      list.append(row);
    }
    addListControls(page);
    return page;
  }

  function decorate() {
    const layout = host.querySelector(':scope > .layout');
    if (!layout || layout.dataset.beigeReady) return;
    layout.dataset.beigeReady = '1';
    decorateRail(layout);
    decorateMobileNav(layout);
    const chat = layout.querySelector(':scope > .chat');
    const page = layout.querySelector(':scope > .page');
    if (chat) {
      layout.classList.add('beige-split', 'beige-room');
      layout.insertBefore(makeChatList(), chat);
      const title = chat.querySelector('.room-title, .chat-profile-trigger');
      if (title) {
        const avatar = document.createElement('span');
        avatar.className = 'avatar beige-chat-avatar';
        avatar.textContent = title.querySelector('h1')?.textContent?.trim().charAt(0) || '대';
        title.before(avatar);
      }
      const menu = chat.querySelector('.room-more');
      if (menu) menu.setAttribute('onclick', 'beigeRoomActions()');
      chat.querySelector('.back')?.setAttribute('aria-label', '대화 목록');
      chat.querySelector('.sendbar input')?.setAttribute('placeholder', '메시지 입력');
    } else if (page && nav === 'chat') {
      layout.classList.add('beige-split', 'beige-home');
      addListControls(page);
      const main = document.createElement('section');
      main.className = 'beige-empty-main';
      main.innerHTML = '<div class="beige-empty-content"><span class="beige-empty-icon" aria-hidden="true">◌</span><h2>대화를 선택하세요</h2></div>';
      const schedules = page.querySelector('.dash');
      if (schedules) main.append(schedules);
      layout.insertBefore(main, layout.querySelector('.android-nav'));
    } else if (page) {
      layout.classList.add('beige-single');
    }
  }

  new MutationObserver(decorate).observe(host, { childList: true });
  decorate();
})();

