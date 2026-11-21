const assert = require('node:assert/strict');
const {randomInt, randomUUID} = require('node:crypto');
const {chromium} = require('playwright-core');

const base = new URL(process.env.RETONE_TEST_URL || 'http://127.0.0.1:4000');
assert.ok(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'Run only against a disposable local Re:Tone server');

async function request(path, {method = 'GET', body, user} = {}) {
  const response = await fetch(new URL(path, base), {
    method, headers: {'Content-Type': 'application/json', ...(user ? {Cookie: user.cookie} : {})},
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error'
  });
  return response;
}

async function post(path, body, user) {
  const response = await request(path, {method: 'POST', body, user});
  assert.ok(response.ok, `Fixture ${path} returned ${response.status}`);
  return response.json();
}

async function signup(prefix) {
  const phone = '010' + randomInt(10000000, 100000000);
  const response = await request('/api/auth/signup', {method:'POST', body:{
    name: prefix + randomUUID().slice(0, 8), phone,
    password: randomUUID(), ai_intervention: 'standard'
  }});
  assert.ok(response.ok, `Signup returned ${response.status}`);
  const user = await response.json();
  return {...user, phone, cookie: response.headers.get('set-cookie').split(';')[0]};
}

async function openChat(browser, user, room, errors, mobile = false) {
  const context = await browser.newContext(mobile
    ? {viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true}
    : {});
  const [cookieName, cookieValue] = user.cookie.split('=');
  await context.addCookies([{name:cookieName, value:cookieValue, url:base.origin, httpOnly:true, sameSite:'Strict'}]);
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

async function verifyQuickLogin(browser, label, expectedName) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(base.origin, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: label, exact: true}).click();
  await page.getByRole('heading', {name: '채팅', exact: true}).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('retone-v2-name')), expectedName);
  assert.deepEqual(dialogs, []);
  await context.close();
}

async function send(page, room, text) {
  page.on('console', message => { if (message.type() === 'error') console.log(`[pageconsole] ${message.text()}`); });
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/messages')) console.log(`[request] ${request.url()} ${request.postData()}`); });
  page.on('response', response => { if (response.request().method() === 'POST' && response.url().includes('/messages')) console.log(`[response] ${response.status()} ${response.url()}`); });
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
  assert.equal((await request('/api/users')).status, 401, 'Protected APIs reject anonymous callers');
  const [writer, reader] = await Promise.all([signup('작성자'), signup('수신자')]);
  await post('/api/friend-requests', {sender_id: reader.id, phone: reader.phone}, writer);
  const pending = await (await request(`/api/friends/${reader.id}/requests`, {user:reader})).json();
  await post(`/api/friend-requests/${pending[0].id}/accept/${reader.id}`, {}, reader);
  assert.equal((await request(`/api/friends/${reader.id}`, {user:writer})).status, 403,
    'A valid session cannot read another account by changing the URL');
  const room = await post('/api/rooms', {
    name: '일정과 삭제 회귀 검사', owner: writer.name, owner_id: writer.id,
    members: [reader.name], member_ids: [reader.id]
  }, writer);
  const launch = process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {channel: 'chrome'};
  const browser = await chromium.launch({...launch, headless: true});
  try {
    const errors = [];
    await verifyQuickLogin(browser, '신지훈으로 로그인', '신지훈');
    await verifyQuickLogin(browser, '바나나로 로그인', '바나나');
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
    await bubble(peer, invite).waitFor();
    const peerLike = bubble(peer, invite).getByRole('button', {name:'공감'});
    await peerLike.click();
    await peerLike.getByText('1').waitFor();
    await bubble(sender, invite).getByRole('button', {name:'공감'}).getByText('1').waitFor({timeout: 10000});
    await peerLike.click();
    await peerLike.getByText('0').waitFor();
    await bubble(sender, invite).getByRole('button', {name:'공감'}).getByText('0').waitFor({timeout: 10000});
    const forged = await post(`/api/rooms/${room.id}/messages`, {sender: reader.name, sender_id: reader.id, body: '서버 인증 검사'}, writer);
    assert.equal(forged.sender_id, writer.id);
    assert.equal(forged.sender, writer.name);
    assert.equal((await request(`/api/rooms/${room.id}/messages/${forged.id}`, {method:'DELETE', user:reader})).status, 403,
      'A room member cannot delete another sender’s message');
    const offer = bubble(sender, invite).getByRole('button', {name: '일정 카드 쓰기'});
    await offer.waitFor();
    await bubble(peer, invite).waitFor();
    const question = await send(peer, room, '?');
    await bubble(sender, question).waitFor();
    const acknowledgement = await send(peer, room, '그래, 좋아!');
    await bubble(sender, acknowledgement).waitFor();
    assert.equal(await sender.locator('[data-schedule-offer]').count(), 1);
    assert.equal(await bubble(sender, question).locator('[data-schedule-offer]').count(), 0);

    const claimText = '지구는 태양을 약 365일에 한 번 공전해.';
    await sender.route('**/api/ai/check', async route => {
      const payload = route.request().postDataJSON();
      if (payload.text !== claimText) return route.fallback();
      await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({
        verdict: 'PASS', suggestion: null, info: {level: 'check', note: '출처와 발표 날짜를 확인해 주세요.', queries: ['지구 태양 공전 주기']}, source: 'ai'
      })});
    });
    const claim = await send(sender, room, claimText);
    await sender.unroute('**/api/ai/check');
    assert.equal(await sender.getByRole('heading', {name: '출처 확인'}).count(), 0);
    await bubble(peer, claim).waitFor();
    const sourceToggle = bubble(peer, claim).getByRole('button', {name: '출처 보기'});
    assert.equal(await sourceToggle.textContent(), '⌄');
    assert.equal(await bubble(peer, claim).locator('.source-panel').isHidden(), true);
    await peer.route(`**/api/messages/${claim.id}/sources`, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        summary: 'NASA 자료에서 지구의 공전 주기는 약 365.25일로 확인됩니다.',
        sources: [{title: 'NASA Solar System Exploration', url: 'https://science.nasa.gov/earth/facts/'}]
      })
    }));
    await sourceToggle.click();
    const sourcePanel = bubble(peer, claim).locator('.source-panel');
    await sourcePanel.getByText('NASA 자료에서').waitFor();
    assert.equal(await sourcePanel.getByRole('link', {name: 'NASA Solar System Exploration'}).getAttribute('href'), 'https://science.nasa.gov/earth/facts/');
    await sourceToggle.click();
    assert.equal(await sourcePanel.isHidden(), true);

    await bubble(peer, claim).getByRole('button', {name: '답장'}).click();
    const replyDraft = peer.locator('#reply-compose');
    await replyDraft.getByText(claimText).waitFor();
    const reply = await send(peer, room, '응, 출처 링크도 같이 볼게.');
    assert.equal(reply.reply_to.message_id, claim.id);
    assert.equal(reply.reply_to.body, claimText);
    await bubble(sender, reply).waitFor();
    await bubble(sender, reply).locator('.reply-quote').getByText(claimText).waitFor();
    assert.equal(await replyDraft.isHidden(), true);

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
    assert.equal(await bubble(peer, reply).locator('.reply-quote').getByText(claimText).count(), 1);
    assert.equal(await peer.locator('[data-schedule-offer]').count(), 0);
    assert.deepEqual(errors, []);
    const {verifyScheduleApi} = await import('./schedule-api.mjs');
    const secondInvite = await post(`/api/rooms/${room.id}/messages`, {sender: reader.name, sender_id: reader.id, body: '금요일 영화 보자.'}, writer);
    assert.equal(secondInvite.sender, writer.name);
    await verifyScheduleApi(base, secondInvite, writer, reader);
    await require('./rewrite-flow.cjs')({sender, peer, writer, reader, room, base, post, send});
    assert.deepEqual(errors, []);
    console.log('Two real browser sessions passed: server sessions, anti-impersonation, access control, sender-only offer, replies, details, and push deletion.');
  } finally { await browser.close(); }
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
