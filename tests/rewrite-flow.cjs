const assert = require('node:assert/strict');

// The local server has no provider key. Exercise its real unavailable response,
// then provide deterministic results at the model-dependent HTTP boundary.
module.exports = async function verifyRewrite({sender, writer, reader, room, base, post, send}) {
  const messagesUrl = new URL(`/api/rooms/${room.id}/messages`, base).href;
  const rewriteUrl = new URL(`/api/rooms/${room.id}/rewrite`, base).href;
  const messages = async () => (await sender.request.get(messagesUrl)).json();
  const input = sender.locator('#text');
  const panel = sender.locator('#rewrite-editor');
  const original = '첫 번째 말고 두 번째로 해 주세요.';
  const reply = '수정할게요. 두 번째 시안은 남색이에요.';
  const first = '두 번째 초록색 시안으로 부탁드려요.';
  const updated = '첫 번째 대신 두 번째 남색 시안으로 부탁드려요.';
  await post(messagesUrl, {sender: reader.name, sender_id: reader.id, body: '첫 번째는 흰색, 두 번째는 초록색이에요.'});
  await input.fill(original);
  const before = (await messages()).length;
  await sender.locator('.sendbar [data-rewrite-draft]').click();
  await panel.getByRole('button', {name:'다시 시도'}).waitFor();
  assert.equal(await input.inputValue(), original);

  const requests = [];
  await sender.route(rewriteUrl, async route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const turns = await messages();
    await route.fulfill({json: {
      source:'ai', suggestion:turns.at(-1).body === reply ? updated : first,
      context_ids:turns.slice(-6).map(m => m.id)
    }});
  });
  await panel.getByRole('button', {name:'다시 시도'}).click();
  await panel.getByText(first, {exact:true}).waitFor();
  await post(messagesUrl, {sender:reader.name, sender_id:reader.id, body:reply});
  await panel.getByText(updated, {exact:true}).waitFor();
  assert.deepEqual(requests, [
    {user_id:writer.id, text:original}, {user_id:writer.id, text:original}
  ]);
  assert.equal((await messages()).length, before + 1);
  await panel.getByRole('button', {name:'입력창에 적용'}).click();
  assert.equal(await input.inputValue(), updated);
  assert.equal((await messages()).length, before + 1);
  const sent = await send(sender, room, updated);
  assert.equal(sent.body, updated);
  assert.equal(sent.sender_id, writer.id);

  // The warning path brings the same original draft back; cancelling a delayed
  // request must not overwrite subsequent edits or send the warning draft.
  await sender.unroute(rewriteUrl);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const requestStarted = new Promise(resolve => { started = resolve; });
  await sender.route(rewriteUrl, async route => {
    started();
    await gate;
    await route.fulfill({json:{suggestion:'늦은 응답',context_ids:[]}}).catch(() => {});
  });
  const warningDraft = '너 진짜 병신이냐?';
  await input.fill(warningDraft);
  await sender.getByRole('button', {name:'보내기',exact:true}).click();
  await sender.locator('.ai-check.warn').getByRole('button', {name:'말 고치기'}).click();
  await requestStarted;
  assert.equal(await panel.locator('[data-original]').innerText(), warningDraft);
  await panel.getByRole('button', {name:'취소'}).click();
  assert.equal(await input.inputValue(), warningDraft);
  await input.fill('다시 쓴 원문');
  release();
  await sender.unrouteAll({behavior:'wait'});
  assert.equal(await input.inputValue(), '다시 쓴 원문');
  assert.equal(await panel.count(), 0);
  assert.equal((await messages()).length, before + 2);
  console.log('Rewrite editor: unavailable, retry, new peer context, draft-only apply, explicit send, warning and late cancellation passed.');
};
