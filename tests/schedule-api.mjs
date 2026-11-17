import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Called with a message from the disposable room in the live regression test.
export async function verifyScheduleApi(base, message) {
  const post = (path, method, body) => fetch(new URL(path, base), {
    method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
  });
  const payload = {
    client_id: randomUUID(), creator: message.sender, room_id: message.room_id,
    source_message_id: message.id, title: '금요일 영화',
    fields: [
      {label: '할일', value: '영화 보기'}, {label: '누구', value: ''},
      {label: '언제', value: '저녁 7시'}, {label: '어디', value: '역 앞 극장'},
      {label: '준비물', value: '학생증'}
    ]
  };
  const path = '/api/appointments';
  let response = await post(path, 'POST', {...payload, creator: message.sender + ' (상대)'});
  assert.equal(response.status, 400, 'Peer cannot save a proposal on another author’s source');
  response = await post(path, 'POST', {...payload, room_id: randomUUID()});
  assert.equal(response.status, 400, 'Cannot assign a source message to another room');
  response = await post(path, 'POST', {...payload, source_message_id: randomUUID()});
  assert.equal(response.status, 404, 'Cannot create a card from an absent source');

  response = await post(path, 'POST', payload);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.id, payload.client_id);
  assert.equal(saved.room_id, message.room_id);
  assert.equal(saved.source_message_id, message.id);
  const fields = card => card.fields.map(({label, value}) => ({label, value}));
  assert.deepEqual(fields(saved), payload.fields);
  response = await post(path, 'POST', {...payload, client_id: randomUUID()});
  assert.equal((await response.json()).id, saved.id, 'Duplicate source created a second card');

  const ownerPath = path + '/' + saved.id + '/creator/' + encodeURIComponent(message.sender);
  const edit = {title: '토요일 영화', fields: [{label: '할일', value: '영화 보기'}, {label: '언제', value: '토요일'}, {label: '메모', value: ''}]};
  response = await post(ownerPath, 'PATCH', edit);
  assert.equal(response.status, 200);
  response = await fetch(new URL('/api/bootstrap', base));
  const sameSource = (await response.json()).appointments.filter(card => card.source_message_id === message.id);
  assert.equal(sameSource.length, 1);
  assert.equal(sameSource[0].title, edit.title);
  assert.deepEqual(fields(sameSource[0]), edit.fields, 'Bootstrap returned stale or truncated details');
  assert.equal((await fetch(new URL(ownerPath, base), {method: 'DELETE'})).status, 204);
  console.log('Schedule API: author, room, source, idempotency, saved details and updates passed');
}
