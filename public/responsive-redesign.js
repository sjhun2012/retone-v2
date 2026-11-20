// Enhance the existing chat without replacing its message or navigation handlers.
function decorateChatLayout() {
  const layout = document.querySelector('#app > .layout');
  const chat = layout?.querySelector(':scope > .chat');
  if (!chat || layout.classList.contains('redesigned-chat')) return;
  layout.classList.add('redesigned-chat');
  const list = document.createElement('aside');
  list.className = 'redesign-room-list';
  const heading = document.createElement('h2'); heading.textContent = '채팅'; list.append(heading);
  for (const room of accessibleRooms()) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'redesign-room' + (room.id === roomId ? ' selected' : '');
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = roomDisplayName(room).charAt(0);
    const copy = document.createElement('span'); copy.className = 'copy';
    const title = document.createElement('b'); title.textContent = roomDisplayName(room);
    const last = document.createElement('span'); last.textContent = room.last || '';
    copy.append(title, last); button.append(avatar, copy); button.addEventListener('click', () => openRoom(room.id)); list.append(button);
  }
  chat.before(list);
  const room = accessibleRooms().find(item => item.id === roomId);
  const details = document.createElement('aside'); details.className = 'redesign-details';
  const detailsTitle = document.createElement('h2'); detailsTitle.textContent = '채팅방 정보';
  const peopleTitle = document.createElement('h3'); peopleTitle.textContent = '참여자';
  const people = document.createElement('p'); people.textContent = room ? roomPeople(room).join(', ') : '';
  const schedules = document.createElement('button'); schedules.type = 'button'; schedules.textContent = '일정 전체 보기';
  schedules.addEventListener('click', () => { if (roomId) showRoomSchedules(roomId); });
  details.append(detailsTitle, peopleTitle, people, schedules); chat.after(details);
}
new MutationObserver(decorateChatLayout).observe(document.querySelector('#app'), {childList:true});
decorateChatLayout();
