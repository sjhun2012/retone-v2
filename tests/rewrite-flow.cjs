const assert = require('node:assert/strict');

module.exports = async function verifyRewrite({sender, peer, writer, room, base, send}) {
  const checkUrl = new URL('/api/ai/check', base).href;
  const rewriteUrl = new URL(`/api/rooms/${room.id}/rewrite`, base).href;
  const messagesUrl = new URL(`/api/rooms/${room.id}/messages`, base).href;
  const messages = async () => (await sender.request.get(messagesUrl)).json();
  const original = '씨발, 네가 이것도 제대로 못 해?';
  const improved = '이 부분이 제대로 되지 않아서 답답해. 다시 확인해 줄래?';
  const checks = [];
  let manualRewriteRequests = 0;

  await sender.route(rewriteUrl, async route => {
    manualRewriteRequests++;
    await route.abort();
  });
  await sender.route(checkUrl, async route => {
    const request = route.request().postDataJSON();
    checks.push(request);
    await route.fulfill({json: request.text === original
      ? {verdict:'WARN', trigger:'씨발', suggestion:improved, info:{level:'none',note:null,queries:[]}, source:'ai'}
      : {verdict:'PASS', trigger:null, suggestion:null, info:{level:'none',note:null,queries:[]}, source:'ai'}});
  });

  assert.equal(await sender.locator('[data-rewrite-draft]').count(), 0);
  const before = (await messages()).length;
  await sender.locator('#text').fill(original);
  await sender.getByRole('button', {name:'보내기', exact:true}).click();
  const warning = sender.locator('.ai-check.warn');
  await warning.getByText(improved, {exact:true}).waitFor();
  assert.equal((await messages()).length, before);
  assert.equal(await warning.getByRole('button', {name:'말 고치기'}).count(), 0);
  await warning.getByRole('button', {name:'수정안 사용'}).click();
  assert.equal(await sender.locator('#text').inputValue(), improved);
  assert.equal((await messages()).length, before);

  const sent = await send(sender, room, improved);
  assert.equal(sent.body, improved);
  assert.equal(sent.sender_id, writer.id);
  assert.equal(manualRewriteRequests, 0);
  assert.ok(checks.some(request => request.text === original && request.sender === writer.name));
  assert.ok(checks.some(request => request.text === improved));

  await peer.route(checkUrl, route => route.fulfill({json:{
    verdict:'PASS', trigger:null, suggestion:null, info:{level:'none',note:null,queries:[]}, source:'ai'
  }}));
  const reply = await send(peer, room, '알겠어. 다시 확인해 볼게.');
  assert.equal(reply.body, '알겠어. 다시 확인해 볼게.');
  assert.equal(await peer.locator('.ai-check.warn').count(), 0);
  await sender.unrouteAll({behavior:'wait'});
  await peer.unrouteAll({behavior:'wait'});
  console.log('Automatic rewrite: no manual button, contextual suggestion, explicit apply and send, no warning carried to the next speaker.');
};
