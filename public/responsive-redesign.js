rail = function () {
  return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><nav aria-label="주 메뉴"><button class="${nav==='chat'?'active':''}" onclick="home()" aria-label="채팅"><span class="rail-icon">◌</span><span class="rail-label">채팅</span><i class="nav-badge" data-chat-unread hidden></i></button><button class="${nav==='friends'?'active':''}" onclick="friends()" aria-label="친구"><span class="rail-icon">♙</span><span class="rail-label">친구</span><i class="nav-badge" data-friend-request-count hidden></i></button><button class="${nav==='settings'?'active':''}" onclick="settings()" aria-label="설정"><span class="rail-icon">⚙</span><span class="rail-label">설정</span></button></nav><small>${esc(signedIn||'Re:Tone')}</small></aside>`;
};
authForm = function(mode) {
  const join=mode==='signup';
  document.querySelectorAll('.auth-tabs button').forEach((button,index)=>button.classList.toggle('selected',(index===1)===join));
  document.querySelector('#auth-form').innerHTML=`<form class="new-auth-form" onsubmit="event.preventDefault();finishAuth('${mode}')"><h1>${join?'계정 만들기':'로그인'}</h1><label>이름<input id="auth-name" autocomplete="name" placeholder="이름"></label><label>전화번호<input id="auth-phone" inputmode="tel" autocomplete="tel" placeholder="전화번호"></label><label>비밀번호<input id="auth-password" type="password" autocomplete="${join?'new-password':'current-password'}" placeholder="비밀번호"></label>${join?'<button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI 사용 안내 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽고 동의해요.</label>':''}<button class="auth-submit" type="submit">${join?'가입하기':'로그인'}</button>${join?'':`<div class="test-login-shortcuts"><small>테스트 로그인</small><button type="button" onclick="quickTestLogin('신지훈','01000000000')">신지훈으로 로그인</button><button type="button" onclick="quickTestLogin('바나나','01011111111')">바나나로 로그인</button></div>`}</form>`;
};
function decorateChatLayout() {
  const auth=document.querySelector('#app > .auth');
  if(auth&&!auth.classList.contains('new-auth')) { auth.classList.add('new-auth'); authForm('login'); }
  const layout=document.querySelector('#app > .layout');
  if(!layout||layout.classList.contains('redesigned'))return;
  layout.classList.add('redesigned');
  const chat=layout.querySelector(':scope > .chat');
  if(!chat) {
    if(nav==='chat') { const empty=document.createElement('section'); empty.className='desktop-welcome'; empty.innerHTML='<div class="welcome-mark">◌</div><h2>대화를 선택해 주세요</h2>'; layout.append(empty); }
    return;
  }
  layout.classList.add('redesigned-chat');
  const list=document.createElement('aside'); list.className='redesign-room-list';
  const heading=document.createElement('div'); heading.className='list-heading'; heading.innerHTML='<h2>채팅</h2>'; list.append(heading);
  const search=document.createElement('input'); search.className='room-search'; search.placeholder='대화 검색'; search.setAttribute('aria-label','대화 검색'); list.append(search);
  const items=document.createElement('div'); items.className='redesign-rooms'; list.append(items);
  for(const room of accessibleRooms()) {
    const button=document.createElement('button'); button.type='button'; button.className='redesign-room'+(room.id===roomId?' selected':'');
    const name=roomDisplayName(room); button.dataset.search=name.toLowerCase();
    const avatar=document.createElement('span'); avatar.className='avatar'; avatar.textContent=name.charAt(0);
    const copy=document.createElement('span'); copy.className='copy'; const title=document.createElement('b'); title.textContent=name;
    const last=document.createElement('span'); last.textContent=room.last||''; copy.append(title,last); button.append(avatar,copy);
    button.addEventListener('click',()=>openRoom(room.id)); items.append(button);
  }
  search.addEventListener('input',()=>{ for(const item of items.children)item.hidden=!item.dataset.search.includes(search.value.trim().toLowerCase()); });
  chat.before(list);
  const room=accessibleRooms().find(item=>item.id===roomId), details=document.createElement('aside'); details.className='redesign-details';
  const title=document.createElement('h2'); title.textContent='채팅방 정보'; const sub=document.createElement('h3'); sub.textContent='참여자';
  const people=document.createElement('p'); people.textContent=room?roomPeople(room).join(', '):'';
  const schedules=document.createElement('button'); schedules.type='button'; schedules.textContent='일정 전체 보기'; schedules.addEventListener('click',()=>{if(roomId)showRoomSchedules(roomId)});
  details.append(title,sub,people,schedules); chat.after(details);
}
new MutationObserver(decorateChatLayout).observe(document.querySelector('#app'),{childList:true});
decorateChatLayout();
