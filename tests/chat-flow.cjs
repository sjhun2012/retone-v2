const assert = require('node:assert/strict');
const {randomInt, randomUUID} = require('node:crypto');
const {chromium} = require('playwright-core');

const base = new URL(process.env.RETONE_TEST_URL || 'http://127.0.0.1:4000');
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'Run only against a disposable local Re:Tone server');

async function post(path, body) {
  const response = await fetch(new URL(path, base), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body), redirect: 'error'
  });
  assert.ok(response.ok, `Fixture ${path} returned ${response.status}`);
  return response.json();
}

async function signup(prefix) {
  return post('/api/auth/signup', {
    name: prefix + randomUUID().slice(0, 8), phone: '010' + randomInt(10000000, 100000000),
    password: randomUUID(), ai_intervention: 'standard'
  });
}

async function openChat(browser, user, room, errors, mobile = false) {
  const context = await browser.newContext(mobile
    ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}
    : {});
  await context.addInitScript(account => {
    sessionStorage.setItem('retone-v2-name', account.name);
    sessionStorage.setItem('retone-v2-user-id', account.id);
    sessionStorage.setItem('retone-v2-ai-level', 'standard');
    sessionStorage.setItem('retone-v2-ai-consent', 'yes');
  }, user);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm' && dialog.message().includes('메시지를 삭제')) await dialog.accept();
    else { errors.push(`Unexpected dialog: ${dialog.message()}`); await dialog.dismiss(); }
  });
  await page.goto(base.origin, {waitUntil: 'domcontentloaded'});
  await page.locator(`.rooms [data-room-id="${room.id}"]`).click();
  await page.locator(`#messages[data-room-id="${room.id}"]`).waitFor();
  return page;
}

async function send(page, room, text) {
  const sent = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'POST' && new URL(response.url()).pathname === `/api/rooms/${room.id}/messages`
      && request.postDataJSON().body === text;
  });
  const [response] = await Promise.all([sent, (async () => {
    await page.locator('#text').fill(text);
    await page.getByRole('button', {name: '보내기', exact: true}).click();
    const approval = page.locator('.ai-check').getByRole('button', {name: '이대로 보내기'});
    const bubble = page.locator('.bubble.mine[data-message-id]').filter({hasText: text});
    await approval.or(bubble).first().waitFor();
    if (await approval.isVisible()) await approval.click();
  })()]);
  assert.ok(response.ok(), `Failed to send "${text}" (${response.status()})`);
  const message = await response.json();
  await page.locator(`[data-message-id="${message.id}"]`).waitFor();
  return message;
}

function bubble(page, message) { return page.locator(`[data-message-id="${message.id}"]`); }

async function verify() {
  const [writer, reader] = await Promise.all([signup('작성자'), signup('수신자')]);
  const room = await post('/api/rooms', {
    name: '일정과 삭제 회귀 검사', owner: writer.name, owner_id: writer.id,
    members: [reader.name], member_ids: [reader.id]
  });
  const launch = process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: 'chrome'};
  const browser = await chromium.launch({...launch, headless: true});
  try {
    const errors = [];
    const [sender, peer] = await Promise.all([
      openChat(browser, writer, room, errors), openChat(browser, reader, room, errors, true)
    ]);
    // Record even a transient unwanted offer/editor between assertions.
    await peer.evaluate(() => {
      window.unwantedScheduleUi = [];
      const selector = '[data-schedule-offer], #schedule-editor, .schedule-proposal';
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))) {
            window.unwantedScheduleUi.push(node.textContent);
          }
        }
      }).observe(document.body, {childList: true, subtree: true});
    });
    const invite = await send(sender, room, '야 내일 만날래?');
    const offer = bubble(sender, invite).getByRole('button', {name: '일정 카드 쓰기'});
    await offer.waitFor();
    await bubble(peer, invite).waitFor();
    const question = await send(peer, room, '?');
    await bubble(sender, question).waitFor();
    const acknowledgement = await send(peer, room, '그래, 좋아!');
    await bubble(sender, acknowledgement).waitFor();
    assert.equal(await sender.locator('[data-schedule-offer]').count(), 1);
    assert.equal(await bubble(sender, question).locator('[data-schedule-offer]').count(), 0);

    await offer.click();
    const form = sender.locator('#schedule-editor');
    await form.getByLabel('일정 제목').fill('토요일 영화');
    const fillDetail = async (label, value) => {
      const input = form.locator(`[data-field]:has([name=label][value="${label}"]) [name=value]`);
      await input.fill(value);
    };
    await fillDetail('할일', '영화 보기'); await fillDetail('누구', '');
    await fillDetail('언제', '토요일 저녁 7시'); await fillDetail('어디', '역 앞 극장');
    await form.getByRole('button', {name: '항목 추가'}).click();
    const added = form.locator('[data-field]').last();
    await added.locator('[name=label]').fill('준비물');
    await added.locator('[name=value]').fill('예매표 2장');
    await form.getByRole('button', {name: '저장', exact: true}).click();
    await form.waitFor({state: 'detached'});
    await peer.locator('.notice-view').click();
    const card = peer.locator('[data-schedule-list] [data-schedule-id]').filter({hasText: '토요일 영화'});
    await card.waitFor();
    const shown = await card.locator('dt').evaluateAll(labels => Object.fromEntries(
      labels.map(label => [label.textContent, label.nextElementSibling.textContent])
    ));
    assert.deepEqual(shown, {'할일': '영화 보기', '누구': '비어 있음', '언제': '토요일 저녁 7시', '어디': '역 앞 극장', '준비물': '예매표 2장'});
    assert.equal(await card.getByRole('button', {name: '수정'}).count(), 0);
    await peer.getByRole('button', {name: '닫기', exact: true}).click();

    // Block every subsequent message snapshot on the recipient. The open stream
    // must remove the bubble without polling, navigating, or re-opening the room.
    await peer.evaluate(() => clearInterval(inboxPollTimer));
    await peer.waitForFunction(() => !inboxSyncing && messageFeed?.events?.readyState === EventSource.OPEN);
    await peer.route(`**/api/rooms/${room.id}/messages`, route => route.abort());
    const peerDocument = await peer.evaluateHandle(() => document);
    await bubble(peer, invite).waitFor();
    await bubble(sender, invite).hover();
    const beforeDelete = performance.now();
    await bubble(sender, invite).getByTitle('메시지 삭제').click();
    await bubble(peer, invite).waitFor({state: 'detached', timeout: 4000});
    console.log(`Delete click to disappearance on peer: ${Math.round(performance.now() - beforeDelete)} ms`);
    await bubble(sender, invite).waitFor({state: 'detached'});
    assert.equal(await peer.evaluate(previous => document === previous, peerDocument), true);
    assert.equal(await bubble(peer, question).count(), 1);
    assert.equal(await bubble(peer, acknowledgement).count(), 1);
    assert.deepEqual(await peer.evaluate(() => window.unwantedScheduleUi), []);
    await peer.unroute(`**/api/rooms/${room.id}/messages`);
    await bubble(peer, acknowledgement).getByTitle('메시지 삭제').tap();
    await bubble(sender, acknowledgement).waitFor({state: 'detached'});
    // Reopening takes a fresh server snapshot and cannot resurrect either message.
    await peer.locator('.chat .back').tap();
    await peer.locator(`.rooms [data-room-id="${room.id}"]`).tap();
    await bubble(peer, question).waitFor();
    assert.equal(await bubble(peer, invite).count(), 0);
    assert.equal(await bubble(peer, acknowledgement).count(), 0);
    assert.equal(await peer.locator('[data-schedule-offer]').count(), 0);
    assert.deepEqual(errors, []);
    const {verifyScheduleApi} = await import('./schedule-api.mjs');
    const secondInvite = await post(`/api/rooms/${room.id}/messages`, {sender: writer.name, body: '금요일 영화 보자.'});
    await verifyScheduleApi(base, secondInvite);
    await require('./rewrite-flow.cjs')({sender, writer, reader, room, base, post, send});
    assert.deepEqual(errors, []);
    console.log('Two real browser sessions passed: sender-only offer, both replies, edited details in peer view, and push deletion with polling blocked.');
  } finally { await browser.close(); }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
