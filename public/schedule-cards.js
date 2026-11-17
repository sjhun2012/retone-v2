// The open form owns its draft. Suggestions are only used to initialize inputs.
function scheduleFields(card) {
  if (Array.isArray(card.fields)) return card.fields;
  return [
    {label: '언제', value: card.date},
    {label: '어디', value: card.place}
  ].filter(field => field.value);
}

function scheduleAttribute(value) {
  return esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function scheduleFieldRow({label, value}) {
  return `<div class="schedule-field-edit" data-field>
    <input name="label" aria-label="항목 이름" maxlength="20" value="${scheduleAttribute(label)}">
    <input name="value" aria-label="항목 내용" maxlength="100" value="${scheduleAttribute(value)}">
    <button type="button" data-remove aria-label="항목 삭제">×</button>
  </div>`;
}

function schedulePayload(form) {
  const title = form.elements.namedItem('title').value.trim();
  if (!title) throw new Error('일정 제목을 입력해 주세요.');
  const fields = [];
  for (const row of form.querySelectorAll('[data-field]')) {
    const label = row.querySelector('[name=label]').value.trim();
    const value = row.querySelector('[name=value]').value.trim();
    if (!label && value) throw new Error('내용을 입력한 항목의 이름을 적어 주세요.');
    if (label) fields.push({label, value});
  }
  return {title, fields};
}

function openScheduleEditor({card, message, proposal} = {}) {
  if (document.querySelector('#schedule-editor')) return;
  const creator = signedIn, accountId = signedInId;
  const room = card?.room_id ?? message?.room_id ?? roomId;
  const initial = card || proposal;
  const fields = initial ? scheduleFields(initial) : ['할일', '누구', '언제', '어디'].map(label => ({label, value: ''}));
  const clientId = card ? undefined : crypto.randomUUID();
  popup(`<form id="schedule-editor" class="group-modal">
    <h2>${card ? '일정 수정' : '일정 카드'}</h2>
    <label>일정 제목<input name="title" maxlength="80" required value="${scheduleAttribute(initial?.title ?? '일정')}"></label>
    <div data-fields>${fields.map(scheduleFieldRow).join('')}</div>
    <button type="button" class="add-schedule-field" data-add>＋ 항목 추가</button>
    <p data-error role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="quiet" data-cancel>취소</button>
    <button type="submit">저장</button></div>
  </form>`);
  const form = document.querySelector('#schedule-editor');
  if (message) form.dataset.sourceMessageId = message.id;
  const modal = form.closest('.modal'), rows = form.querySelector('[data-fields]');
  const error = form.querySelector('[data-error]'), add = form.querySelector('[data-add]');
  const updateLimit = () => { add.disabled = rows.childElementCount >= 12; };
  function warn(text) { error.textContent = text; error.hidden = false; }
  updateLimit();
  form.addEventListener('click', event => {
    if (event.target.closest('[data-cancel]')) modal.remove();
    if (event.target.closest('[data-add]') && rows.childElementCount < 12) {
      rows.insertAdjacentHTML('beforeend', scheduleFieldRow({label: '세부사항', value: ''}));
      rows.lastElementChild.querySelector('[name=value]').focus();
      updateLimit();
    }
    if (event.target.closest('[data-remove]')) {
      event.target.closest('[data-field]').remove();
      updateLimit();
    }
  });
  const submit = form.querySelector('[type=submit]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled || !form.isConnected) return;
    if (signedInId !== accountId || (message && roomId !== room)) { modal.remove(); return; }
    let payload;
    try { payload = schedulePayload(form); }
    catch (failure) { warn(failure.message); return; }
    const url = card ? `/api/appointments/${card.id}/creator/${encodeURIComponent(creator)}` : '/api/appointments';
    if (!card) Object.assign(payload, {creator, room_id: room, source_message_id: message?.id, client_id: clientId});
    submit.disabled = true;
    form.inert = true;
    error.hidden = true;
    try {
      const saved = await api(url, {method: card ? 'PATCH' : 'POST', body: JSON.stringify(payload)});
      if (signedInId === accountId && data) {
        const index = data.appointments.findIndex(item => item.id === saved.id);
        if (index < 0) data.appointments.push(saved);
        else data.appointments[index] = saved;
        if (message) document.querySelector(`[data-message-id="${message.id}"] [data-schedule-offer]`)?.remove();
        updateScheduleUi();
      }
      modal.remove();
    } catch {
      form.inert = false;
      submit.disabled = false;
      warn('일정을 저장하지 못했어요. 입력한 내용으로 다시 시도할 수 있어요.');
    }
  });
}

function newAppointment() { openScheduleEditor(); }

function showScheduleProposal(message, proposal) {
  if (!message.id || message.room_id !== roomId || message.sender !== signedIn) return;
  const saved = data?.appointments.find(item => item.source_message_id === message.id);
  if (saved) { showRoomSchedules(message.room_id); return; }
  openScheduleEditor({message, proposal});
}

function editAppointment(id) {
  const card = visibleAppointments().find(item => item.id === id);
  if (card?.creator === signedIn) openScheduleEditor({card});
}

function scheduleIdSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
  catch { return new Set(); }
}

const seenAppointmentsKey = () => `retone-v2-seen-appointments-v1-${signedInId || 'guest'}`;
const hiddenAppointmentKey = () => `retone-v2-hidden-appointments-v1-${signedInId || 'guest'}`;
const hideSchedulesKey = () => `retone-v2-hide-schedules-v1-${signedInId || 'guest'}`;

function visibleAppointments() {
  const rooms = new Set(accessibleRooms().map(room => room.id));
  const hidden = scheduleIdSet(hiddenAppointmentKey());
  return (data?.appointments || []).filter(item =>
    !hidden.has(item.id) && (item.room_id ? rooms.has(item.room_id) : item.creator === signedIn)
  );
}

function unseenAppointments() {
  const seen = scheduleIdSet(seenAppointmentsKey());
  return visibleAppointments().filter(item => item.creator !== signedIn && !seen.has(item.id));
}

function markSchedulesRead() {
  const seen = scheduleIdSet(seenAppointmentsKey());
  unseenAppointments().forEach(item => seen.add(item.id));
  localStorage.setItem(seenAppointmentsKey(), JSON.stringify([...seen]));
  updateScheduleUi();
}

function hideScheduleCard(id) {
  const hidden = scheduleIdSet(hiddenAppointmentKey());
  hidden.add(id);
  localStorage.setItem(hiddenAppointmentKey(), JSON.stringify([...hidden]));
  updateScheduleUi();
}

async function deleteOwnSchedule(id) {
  const card = visibleAppointments().find(item => item.id === id);
  if (card?.creator !== signedIn || !confirm('이 일정을 모두의 화면에서 삭제할까요?')) return;
  const accountId = signedInId;
  try {
    await api(`/api/appointments/${id}/creator/${encodeURIComponent(card.creator)}`, {method: 'DELETE'});
    if (signedInId === accountId && data) {
      data.appointments = data.appointments.filter(item => item.id !== id);
      updateScheduleUi();
    }
  } catch { alert('일정을 삭제하지 못했어요. 다시 시도해 주세요.'); }
}

function roomAppointments(room) {
  return visibleAppointments().filter(item => item.room_id === room).reverse();
}

function scheduleFieldsMarkup(card) {
  const fields = scheduleFields(card);
  return fields.length ? `<dl class="schedule-details">${fields.map(({label, value}) =>
    `<dt>${esc(label)}</dt><dd>${esc(value) || '비어 있음'}</dd>`
  ).join('')}</dl>` : '<p>입력된 세부사항이 없어요.</p>';
}

function scheduleCard(card, homeCard = false) {
  const edit = card.creator === signedIn;
  return `<article class="schedule-list-row" data-schedule-id="${scheduleAttribute(card.id)}">
    <strong>${esc(card.title)}</strong>${scheduleFieldsMarkup(card)}
    <div class="schedule-card-actions">
      ${edit ? `<button type="button" onclick="this.closest('.modal')?.remove();editAppointment('${card.id}')">수정</button>` : ''}
      ${homeCard && edit ? `<button type="button" onclick="deleteOwnSchedule('${card.id}')">삭제</button>` : ''}
      ${homeCard ? `<button type="button" onclick="hideScheduleCard('${card.id}')">숨기기</button>` : ''}
    </div></article>`;
}

function scheduleListItems(room) {
  const cards = room ? roomAppointments(room) : visibleAppointments().reverse();
  return cards.length ? cards.map(item => scheduleCard(item)).join('') : '<p>표시할 일정이 없어요.</p>';
}

function showScheduleList(room) {
  popup(`<div class="group-modal schedule-list"><h2>${room ? '이 채팅방 일정' : '전체 일정'}</h2>
    <div data-schedule-list="${scheduleAttribute(room)}">${scheduleListItems(room)}</div>
    <button type="button" class="quiet schedule-list-close" onclick="this.closest('.modal').remove()">닫기</button></div>`);
}

function showRoomSchedules(room) { showScheduleList(room); }
function showAllSchedules() { showScheduleList(''); }

function roomScheduleNotice(room) {
  const cards = roomAppointments(room);
  if (!cards.length) return '';
  const latest = cards[0];
  return `<aside class="room-notice"><span class="notice-pin" aria-hidden="true">📌</span>
    <div class="notice-main"><b>${esc(latest.title)}</b></div>
    <button class="notice-view" onclick="showRoomSchedules('${room}')">보기${cards.length > 1 ? ` ${cards.length}` : ''}</button>
    ${latest.creator === signedIn ? `<button class="notice-delete" onclick="deleteOwnSchedule('${latest.id}')">삭제</button>` : ''}
    <button class="notice-close" aria-label="내 화면에서 숨기기" onclick="hideScheduleCard('${latest.id}')">×</button></aside>`;
}

function scheduleCards() {
  const cards = visibleAppointments().reverse();
  if (!cards.length) return '';
  const hidden = localStorage.getItem(hideSchedulesKey()) === '1', count = unseenAppointments().length;
  return `<section class="focus schedule"><b>다음 일정
    ${count ? `<span class="schedule-badge">+${count}</span>` : ''}
    <button onclick="newAppointment()" aria-label="일정 카드 만들기">＋</button>
    <button class="schedule-toggle" onclick="toggleSchedules()">${hidden ? '보기' : '숨기기'}</button></b>
    ${hidden ? '' : scheduleCard(cards[0], true)}
    ${!hidden && cards.length > 1 ? `<button class="all-schedules-button" onclick="showAllSchedules()">전체 일정 ${cards.length}개 보기</button>` : ''}
    ${count ? '<button class="schedule-check" onclick="markSchedulesRead()">일정 확인</button>' : ''}</section>`;
}

function toggleSchedules() {
  localStorage.setItem(hideSchedulesKey(), localStorage.getItem(hideSchedulesKey()) === '1' ? '' : '1');
  updateScheduleUi();
}

function refreshScheduleMarkup(host, markup) {
  if (!host || host.scheduleMarkup === markup) return;
  host.innerHTML = markup;
  host.scheduleMarkup = markup;
}

function updateScheduleUi() {
  const notice = document.querySelector('#room-schedule-notice');
  if (notice && roomId) refreshScheduleMarkup(notice, roomScheduleNotice(roomId));
  const dashboard = document.querySelector('.layout .dash');
  if (dashboard) refreshScheduleMarkup(dashboard, scheduleCards());
  const list = document.querySelector('[data-schedule-list]');
  if (list) refreshScheduleMarkup(list, scheduleListItems(list.dataset.scheduleList));
}
