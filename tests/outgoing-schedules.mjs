import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/\nstart\(\);?\s*$/, '\n');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function roomView() {
  const bubbles = new Map();
  return {
    bubbles,
    querySelector(selector) { return bubbles.get(selector.match(/"([^"]+)"/)?.[1]); },
    contains(bubble) { return [...bubbles.values()].includes(bubble); }
  };
}
const storage = {getItem: () => null};
let list = roomView();
const input = {focus() {}};
const document = {
  querySelector(selector) {
    if (selector === '.chat #messages') return list;
    if (selector === '#text') return input;
    return null;
  },
  createElement() { return {dataset: {}, addEventListener(_type, fn) { this.click = fn; }}; }
};
const checks = [], posts = [], clicked = [];
function request(url, options) {
  const pending = deferred();
  const payload = JSON.parse(options.body);
  if (url === '/api/ai/schedule') {
    assert.deepEqual(Object.keys(payload), ['text']);
    checks.push({...pending, text: payload.text});
  } else {
    assert.match(url, /\/messages$/);
    posts.push({...pending, payload});
  }
  return pending.promise;
}
const context = vm.createContext({
  document, sessionStorage: storage, localStorage: storage, CSS: {escape: x => x},
  request, clicked,
  display(message) {
    const bubble = {
      id: message.id,
      append(button) { this.offer = button; },
      querySelector() { return this.offer; }
    };
    list.bubbles.set(message.id, bubble);
    return bubble;
  }
});
vm.runInContext(source, context);
vm.runInContext(`signedIn='가'; signedInId='A'; roomId='room';
  api=request; displaySentMessage=display; showScheduleProposal=(msg)=>clicked.push(msg.id);`, context);
const send = body => vm.runInContext('sendChatMessage("room", ' + JSON.stringify(body) + ')', context);
function confirmPost(index) {
  const {payload, resolve} = posts[index];
  resolve({...payload, id: 'm' + index, room_id: 'room'});
}

// Results can arrive in the opposite order for two identical texts.
const one = send('내일 만날래?'), two = send('내일 만날래?');
confirmPost(0); confirmPost(1);
await Promise.all([one, two]);
assert.equal(input.disabled, false, 'Sending must finish while the detector is pending');
checks[1].resolve({is_schedule: true}); checks[0].resolve({is_schedule: false});
await turn();
assert.equal(list.bubbles.get('m0').offer, undefined);
list.bubbles.get('m1').offer.click();
assert.deepEqual(clicked, ['m1']);

const reaction = send('?');
confirmPost(2);
await reaction;
assert.equal(checks.length, 2);
assert.equal(list.bubbles.get('m2').offer, undefined);

// Going back into the same room creates a different DOM. A delayed result
// cannot attach an offer to the new view, even if the message is still there.
const leave = send('카페에서 보자.');
confirmPost(3);
await leave;
const old = list;
list = roomView();
list.bubbles.set('m3', old.bubbles.get('m3'));
checks[2].resolve({is_schedule: true});
await turn();
assert.equal(list.bubbles.get('m3').offer, undefined);
old.bubbles.get('m1').offer.click();
assert.deepEqual(clicked, ['m1']);

const deleted = send('내일 보자.');
confirmPost(4);
await deleted;
list.bubbles.delete('m4');
checks[3].resolve({is_schedule: true});
await turn();
assert.equal(list.bubbles.has('m4'), false);

const failed = send('내일 보자.');
checks[4].resolve({is_schedule: true});
posts[5].reject(new Error('offline'));
await failed;
assert.equal(input.value, '내일 보자.');
assert.equal(list.bubbles.has('m5'), false);
console.log('Outgoing schedules: source binding, punctuation, navigation, deletion, failure and out-of-order results passed');
