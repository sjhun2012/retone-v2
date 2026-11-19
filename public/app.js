const app=document.querySelector('#app');let data=null,roomId=null,nav='chat';let signedIn=sessionStorage.getItem('retone-v2-name')||'';let signedInId=sessionStorage.getItem('retone-v2-user-id')||'';let aiIntervention=sessionStorage.getItem('retone-v2-ai-level')||'standard';let pendingSend=null,pendingReply=null;let aiPrefetch={text:'',result:null,promise:null,timer:null};let aiSavedResults=(()=>{try{return JSON.parse(localStorage.getItem('retone-ai-results-v1')||'{}')}catch{return {}}})();const esc=s=>String(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));const avatarMarkup=(name)=>esc(String(name||'?').trim().charAt(0)||'?');const aiCacheKey=text=>`v3|${aiIntervention}|${text.trim().toLowerCase()}`;function savedAiResult(text){return aiSavedResults[aiCacheKey(text)]||null}function rememberAiResult(text,result){const key=aiCacheKey(text);aiSavedResults[key]={...result,source:'saved'};const keys=Object.keys(aiSavedResults);if(keys.length>180)keys.slice(0,keys.length-180).forEach(k=>delete aiSavedResults[k]);try{localStorage.setItem('retone-ai-results-v1',JSON.stringify(aiSavedResults))}catch{}}
async function api(url,options={}){const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});if(!r.ok)throw new Error();if(r.status===204)return null;return r.json()}
function rail(){return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><p>더 나은 대화를 위한<br>새로운 작업 공간</p><nav><button class="${nav==='chat'?'active':''}" onclick="nav='chat';home()">채팅</button><button class="${nav==='friends'?'active':''}" onclick="nav='friends';friends()">친구</button><button onclick="settings()">설정</button></nav><small>${esc(signedIn||'Re:Tone')} · v2</small></aside>`}
async function home(){data=await api('/api/bootstrap');roomId=null;const rooms=data.rooms.filter(r=>!['science','friends'].includes(r.id));app.innerHTML=`<main class="layout">${rail()}<section class="page"><header class="head"><h1>채팅</h1><button class="new-room" onclick="newRoom()">＋ 새 대화</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 반가워요.</h2><p>친구를 초대해 첫 대화를 시작해 보세요.</p></div><div class="dash"><section class="focus"><b>오늘의 공동 확인</b><span>채팅방에서 함께 확인할 일을 만들어 보세요.</span></section><section class="focus schedule"><b>다음 약속 <button onclick="newAppointment()">＋</button></b><span>친구들과 약속을 정하면 여기에 보여요.</span></section></div><div class="rooms">${rooms.length?rooms.map(r=>`<button class="room" onclick="openRoom('${r.id}')"><span class="avatar">${esc(r.name[0])}</span><span class="copy"><b>${r.pinned?'📌 ':''}${esc(r.name)}</b><span>${esc(r.last)}</span></span>${r.unread?`<span class="badge">${r.unread}</span>`:''}</button>`).join(''):`<button class="empty-chat" onclick="newRoom()"><b>아직 대화가 없어요</b><span>친구를 초대하거나 단체 채팅을 만들어 보세요. ＋</span></button>`}</div></div></section></main>`}
async function openRoom(id){roomId=id;const room=data.rooms.find(r=>r.id===id),messages=await api(`/api/rooms/${id}/messages`);app.innerHTML=`<main class="layout">${rail()}<section class="chat"><header class="head"><button onclick="home()">←</button><div><h1>${esc(room.name)}</h1><span>참여자 ${room.members}명 · 연결됨</span></div><button onclick="newAgreement()">✓</button></header><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(a=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(a.task)}</b><small>담당 ${esc(a.assignee)} · ${esc(a.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button>↑</button></form></section></main>`;document.querySelector('#messages').scrollTop=999999}
async function friends(){const users=await api('/api/users');const list=users.filter(u=>u.id!==signedInId);app.innerHTML=`<main class="layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="home()">채팅 목록</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>이 앱에 가입한 친구를 눌러 바로 대화를 시작해요.</p></div><div class="rooms">${list.length?list.map(u=>`<button class="room" onclick="startDirect('${esc(u.name)}')"><span class="avatar">${esc(u.name[0])}</span><span class="copy"><b>${esc(u.name)}</b><span>눌러서 1:1 대화 시작</span></span><span>›</span></button>`).join(''):`<div class="empty-chat"><b>아직 가입한 친구가 없어요</b><span>친구가 가입하면 이곳에 자동으로 나타나요.</span></div>`}</div></div></section></main>`}
function roomSettings(){popup(`<h2>채팅방 설정</h2><p>대화방 알림과 참여 상태를 관리할 수 있어요.</p><button onclick="localStorage.setItem('retone-muted-'+roomId,'1');closePopup()">이 채팅방 알림 끄기</button><button onclick="if(confirm('채팅방에서 나갈까요?')){closePopup();home()}">채팅방 나가기</button>`)}
async function startDirect(name){const room=await api('/api/rooms',{method:'POST',body:JSON.stringify({name})});data=await api('/api/bootstrap');openRoom(room.id)}
function settings(){nav='settings';const avatar=localStorage.getItem('retone-avatar');const levels={off:['AI 끄기','AI 점검을 사용하지 않아요'],light:['가볍게','강한 욕설만 빠르게 확인해요'],standard:['균형 있게','말투·출처가 중요한 주장만 확인해요'],careful:['꼼꼼하게','중요 정보와 표현을 조금 더 살펴봐요']};app.innerHTML=`<main class="layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님</h2><p>프로필과 앱 사용 환경을 관리해요.</p></div><div class="rooms"><label class="room"><span class="avatar" id="avatarPreview">${avatar?`<img src="${avatar}">`:esc(signedIn[0])}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>사진을 선택하면 이 기기에서 바로 적용돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><section class="ai-preferences"><b>AI 개입 정도</b><p>언제든 내 대화 방식에 맞게 바꿀 수 있어요.</p><div>${Object.entries(levels).map(([key,[title,desc]])=>`<button class="ai-level ${aiIntervention===key?'selected':''}" onclick="setAiIntervention('${key}')"><strong>${title}</strong><span>${desc}</span></button>`).join('')}</div></section><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section></main>`}async function setAiIntervention(level){if(!signedInId)return;const user=await api(`/api/users/${signedInId}/preferences`,{method:'PATCH',body:JSON.stringify({ai_intervention:level})});aiIntervention=user.ai_intervention;sessionStorage.setItem('retone-v2-ai-level',aiIntervention);settings()}function logout(){['retone-v2-name','retone-v2-user-id','retone-v2-ai-level'].forEach(k=>sessionStorage.removeItem(k));signedIn='';signedInId='';start()}function setAvatar(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{localStorage.setItem('retone-avatar',reader.result);settings()};reader.readAsDataURL(file)}
function view(m){return `<article class="bubble ${m.mine?'mine':''}" ${m.mine?'':`onclick="inspectMessage(${JSON.stringify(m.body)})"`}><div class="meta">${esc(m.sender)}</div>${esc(m.body)}${m.mine&&m.unread?`<span class="read">${m.unread}</span>`:''}${m.mine?`<button class="delete-message" title="메시지 삭제" onclick="removeMessage('${m.id}')">×</button>`:''}</article>`}
function inspectMessage(text){popup(`<div class="ai-check info"><span>상대 메시지</span><h2>이 메시지를 함께 살펴볼까요?</h2><p>Re:Tone은 진실·거짓을 판정하지 않고, 확인에 필요한 단서를 제안해요.</p><button onclick="factCheck(${JSON.stringify(text)})">사실여부 확인 도움받기</button></div>`)}async function factCheck(text){const result=await api('/api/ai/check',{method:'POST',body:JSON.stringify({text,ai_intervention:'careful'})});const info=result.info||{};popup(`<div class="ai-check info"><span>확인 제안</span><h2>이렇게 확인해 보면 어때요?</h2><p>${esc(info.note||'원문 출처, 게시 날짜, 신뢰할 수 있는 기관의 자료를 함께 확인해 보세요.')}</p><button onclick="closePopup()">확인</button></div>`)}function openAiHelp(){popup(`<div class="ai-check info"><span>AI 도움받기</span><h2>지금 마음이나 전하고 싶은 말을 적어봐요</h2><textarea id="ai-help-text" placeholder="예: 너무 서운한데 싸우고 싶진 않아"></textarea><button onclick="askAiHelp()">AI와 이야기하기</button></div>`)}async function askAiHelp(){const text=document.querySelector('#ai-help-text')?.value.trim();if(!text)return;const out=await api('/api/ai/support',{method:'POST',body:JSON.stringify({text})});popup(`<div class="ai-check info"><span>AI 도움받기</span><h2>이렇게 말해볼 수도 있어요</h2><p>${esc(out.reply||'지금 느끼는 마음을 차분히 적어보는 것부터 시작해 봐요.').replace(/\n/g,'<br>')}</p><button onclick="closePopup()">확인</button></div>`)}
function setAiStatus(text,working=false){const status=document.querySelector('#ai-status');if(status){status.textContent=text;status.classList.toggle('working',working)}}function queueAiCheck(value){const text=value.trim();clearTimeout(aiPrefetch.timer);if(aiIntervention==='off'||!text){aiPrefetch={text:'',result:null,promise:null,timer:null};setAiStatus('');return}const saved=savedAiResult(text);if(saved){aiPrefetch={text,result:saved,promise:null,timer:null};setAiStatus('이전 확인 결과 사용');return}if(aiPrefetch.text===text&&(aiPrefetch.result||aiPrefetch.promise))return;aiPrefetch={text,result:null,promise:null,timer:setTimeout(()=>runAiCheck(text),120)};setAiStatus('AI 확인 준비 중',true)}async function runAiCheck(text){if(aiPrefetch.text!==text)return;setAiStatus('AI 확인 중',true);const request=api('/api/ai/check',{method:'POST',body:JSON.stringify({text,ai_intervention:aiIntervention})});aiPrefetch.promise=request;try{const result=await request;rememberAiResult(text,result);if(aiPrefetch.text===text){aiPrefetch.result=result;aiPrefetch.promise=null;setAiStatus(result.source==='cache'?'저장된 확인 결과 사용':'AI 확인 완료')}}catch{if(aiPrefetch.text===text){aiPrefetch.promise=null;setAiStatus('')}}}async function checkForSend(body){if(aiIntervention==='off')return {verdict:'PASS',info:{level:'none'}};const saved=savedAiResult(body);if(saved)return saved;if(aiPrefetch.text===body&&aiPrefetch.result)return aiPrefetch.result;if(aiPrefetch.text===body&&aiPrefetch.promise)return aiPrefetch.promise;clearTimeout(aiPrefetch.timer);aiPrefetch={text:body,result:null,promise:null,timer:null};return runAiCheck(body).then(()=>aiPrefetch.result||{verdict:'PASS',info:{level:'none'}})}function addPendingBubble(body){const list=document.querySelector('#messages');if(!list)return;list.insertAdjacentHTML('beforeend',`<article id="ai-pending" class="bubble mine pending"><div class="meta">나 · AI 확인 중</div>${esc(body)}</article>`);list.scrollTop=list.scrollHeight}function removePendingBubble(){document.querySelector('#ai-pending')?.remove()}
async function reportAiResult(){if(!pendingSend)return;await api('/api/ai/reports',{method:'POST',body:JSON.stringify({reporter_name:signedIn,original_text:pendingSend.body,ai_result:JSON.stringify(pendingSend.result||{})})});popup('<div class="ai-check info"><h2>문의가 전달됐어요</h2><p>관리자 계정에서 AI 제안과 원문을 확인할 수 있어요. 보내기 여부는 그대로 선택할 수 있어요.</p><button onclick="closePopup()">확인</button></div>')}
async function removeMessage(id){
  const feed = messageFeed;
  if (!feedIsVisible(feed) || !confirm('이 메시지를 삭제할까요?')) return;
  try {
    await api(`/api/rooms/${feed.room}/messages/${id}`, {method:'DELETE'});
    forgetMessage(feed, id);
  } catch {
    if (feedIsVisible(feed)) {
      await refreshRoomMessages(feed);
      if (roomMessages.some(message => message.id === id)) alert('메시지를 삭제하지 못했어요. 다시 시도해 주세요.');
    }
  }
}
function popup(inner){document.body.insertAdjacentHTML('beforeend',`<div class="modal" onclick="if(event.target===this)this.remove()"><section>${inner}</section></div>`)}function closePopup(){document.querySelector('.modal')?.remove()}function newRoom(){popup(`<h2>새 단체 채팅</h2><p>팀·친구와 함께할 대화 공간을 만들어요.</p><input id="roomName" placeholder="예: 과학 수행평가 조"><button onclick="saveRoom()">채팅방 만들기</button>`) }async function saveRoom(){const name=document.querySelector('#roomName').value.trim();if(!name)return;await api('/api/rooms',{method:'POST',body:JSON.stringify({name})});closePopup();home()}function newAgreement(){popup(`<h2>공동 확인 만들기</h2><p>할 일, 담당자, 기한을 함께 확인해요.</p><input id="task" placeholder="할 일"><input id="assignee" placeholder="담당자"><input id="deadline" placeholder="예: 내일 18:00"><button onclick="saveAgreement()">공동 확인 카드 만들기</button>`) }async function saveAgreement(){const task=document.querySelector('#task').value.trim();if(!task)return;await api('/api/agreements',{method:'POST',body:JSON.stringify({task,assignee:document.querySelector('#assignee').value,deadline:document.querySelector('#deadline').value})});closePopup();openRoom(roomId)}
function popup(inner){document.body.insertAdjacentHTML('beforeend',`<div class="modal" onclick="if(event.target===this)this.remove()"><section>${inner}</section></div>`)}function closePopup(){document.querySelector('.modal')?.remove()}function newRoom(){popup(`<h2>새 단체 채팅</h2><p>팀·친구와 함께할 대화 공간을 만들어요.</p><input id="roomName" placeholder="예: 과학 수행평가 조"><button onclick="saveRoom()">채팅방 만들기</button>`) }async function saveRoom(){const name=document.querySelector('#roomName').value.trim();if(!name)return;await api('/api/rooms',{method:'POST',body:JSON.stringify({name})});closePopup();home()}function newAgreement(){popup(`<h2>공동 확인 만들기</h2><p>할 일, 담당자, 기한을 함께 확인해요.</p><input id="task" placeholder="할 일"><input id="assignee" placeholder="담당자"><input id="deadline" placeholder="예: 내일 18:00"><button onclick="saveAgreement()">공동 확인 카드 만들기</button>`) }async function saveAgreement(){const task=document.querySelector('#task').value.trim();if(!task)return;await api('/api/agreements',{method:'POST',body:JSON.stringify({task,assignee:document.querySelector('#assignee').value,deadline:document.querySelector('#deadline').value})});closePopup();openRoom(roomId)}
function showAiPolicy(){popup(`<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.11</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 욕설·위협 표현, 오해될 수 있는 말투, 출처 확인이 중요한 건강·안전·법·금융·재난·속보성 주장을 알리기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>보내려는 메시지와 같은 채팅방의 최근 메시지 최대 6개(화자 포함)를 필요한 경우 OpenAI API로 보내 점검해요. 입력 중에는 입력한 문장만 미리 점검해요. 다른 채팅방 내용이나 계정의 전화번호·비밀번호·프로필은 별도로 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>사실을 거짓이라고 단정하거나, AI가 대신 전송하거나, 경고만으로 메시지를 막지 않아요. 최종 전송은 항상 내가 선택해요.</p><p><b>내가 조절할 수 있는 것</b><br>AI 끄기, 강한 표현만 확인, 균형 있게 확인, 꼼꼼한 확인을 설정에서 언제든 바꿀 수 있어요.</p><small>AI 점검 결과는 같은 문장을 빠르게 처리하기 위해 보관될 수 있으며, 설정에서 AI를 끄면 이후 점검을 멈춰요.</small><button onclick="closePopup()">확인했어요</button></div>`)}function start(){if(signedIn&&!signedInId){sessionStorage.removeItem('retone-v2-name');signedIn=''}if(signedIn)return home();app.innerHTML=`<main class="auth"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><p class="auth-copy">말하기 전에 한 번,<br>이해한 뒤에 한 번.</p><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"></div><small>더 나은 대화와 함께하는 작업 공간</small></section></main>`;authForm('login')}function authForm(mode){const join=mode==='signup';document.querySelectorAll('.auth-tabs button').forEach((b,i)=>b.classList.toggle('selected',(i===1)===join));document.querySelector('#auth-form').innerHTML=`<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label>${join?'<label>AI 개입 정도<select id="auth-ai-level"><option value="light">가볍게 · 강한 욕설만</option><option value="standard" selected>균형 있게 · 말투와 중요한 정보</option><option value="careful">꼼꼼하게 · 더 세심한 확인</option><option value="off">AI 끄기</option></select></label><button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, 선택한 범위의 점검에 동의해요.</label><p class="auth-hint">동의하지 않아도 AI 끄기를 선택해 가입할 수 있고, 설정에서 언제든 변경할 수 있어요.</p>':''}<button class="auth-submit" onclick="finishAuth('${mode}')">${join?'회원가입하고 시작하기':'로그인'}</button>${join?'<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>':''}`}async function finishAuth(mode){const name=document.querySelector('#auth-name').value.trim(),phone=document.querySelector('#auth-phone').value.replace(/\D/g,''),password=document.querySelector('#auth-password').value,ai=document.querySelector('#auth-ai-level')?.value,consent=document.querySelector('#auth-ai-consent')?.checked;if(!name||!phone||password.length<6)return alert('이름, 전화번호와 6자 이상 비밀번호를 입력해 주세요.');if(mode==='signup'&&ai!=='off'&&!consent)return alert('AI 사용 안내를 확인하고 동의하거나, AI 끄기를 선택해 주세요.');try{const user=await api('/api/auth/'+(mode==='signup'?'signup':'login'),{method:'POST',body:JSON.stringify({name,phone,password,ai_intervention:ai})});signedIn=user.name;signedInId=user.id;aiIntervention=user.ai_intervention||'standard';sessionStorage.setItem('retone-v2-name',user.name);sessionStorage.setItem('retone-v2-user-id',user.id);sessionStorage.setItem('retone-v2-ai-level',aiIntervention);sessionStorage.setItem('retone-v2-ai-consent',consent||aiIntervention==='off'?'yes':'');home()}catch{alert(mode==='signup'?'이미 가입된 전화번호이거나 입력값을 확인해 주세요.':'이름, 전화번호 또는 비밀번호를 다시 확인해 주세요.')}}
function showAiPolicy(){popup(`<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.11</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 욕설·위협 표현, 오해될 수 있는 말투, 출처 확인이 중요한 주장을 알리기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>보내려는 메시지와 같은 채팅방의 최근 메시지 최대 6개(화자 포함)를 필요한 경우 OpenAI API로 보내 점검해요. 부적절한 표현이 발견되면 같은 대화를 참고해 바로 수정안을 만들어요. 다른 채팅방 내용이나 계정의 전화번호·비밀번호·프로필은 별도로 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>AI가 대신 전송하거나 경고만으로 메시지를 막지 않아요. 최종 전송은 항상 내가 선택해요.</p><small>AI 점검 결과는 같은 문장을 빠르게 처리하기 위해 보관될 수 있어요.</small><button onclick="closePopup()">확인했어요</button></div>`)}
function settings(){nav='settings';const avatar=localStorage.getItem('retone-avatar');app.innerHTML=`<main class="layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님</h2><p>프로필과 앱 사용 환경을 관리해요.</p></div><div class="rooms"><label class="room"><span class="avatar" id="avatarPreview">${avatar?`<img src="${avatar}">`:esc(signedIn[0])}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>사진을 선택하면 이 기기에서 바로 적용돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><section class="ai-preferences"><b>AI 대화 도움</b><p>강한 표현과 확인이 필요한 정보에 대해 제안을 보여줘요.</p><button class="ai-policy-link" onclick="showAiPolicy()">AI 사용 안내 보기</button></section><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section></main>`}
function authForm(mode){const join=mode==='signup';document.querySelectorAll('.auth-tabs button').forEach((b,i)=>b.classList.toggle('selected',(i===1)===join));document.querySelector('#auth-form').innerHTML=`<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label>${join?'<button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, AI 대화 도움 사용에 동의해요.</label>':''}<button class="auth-submit" onclick="finishAuth('${mode}')">${join?'회원가입하고 시작하기':'로그인'}</button>${join?'<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>':''}`}
async function finishAuth(mode){const name=document.querySelector('#auth-name').value.trim(),phone=document.querySelector('#auth-phone').value.replace(/\D/g,''),password=document.querySelector('#auth-password').value,consent=document.querySelector('#auth-ai-consent')?.checked;if(!name||!phone||password.length<6)return alert('이름, 전화번호와 6자 이상 비밀번호를 입력해 주세요.');if(mode==='signup'&&!consent)return alert('AI 사용 안내를 확인하고 동의해 주세요.');try{const user=await api('/api/auth/'+(mode==='signup'?'signup':'login'),{method:'POST',body:JSON.stringify({name,phone,password,ai_intervention:'standard'})});signedIn=user.name;signedInId=user.id;aiIntervention='standard';sessionStorage.setItem('retone-v2-name',user.name);sessionStorage.setItem('retone-v2-user-id',user.id);sessionStorage.setItem('retone-v2-ai-level','standard');if(consent)sessionStorage.setItem('retone-v2-ai-consent','yes');home()}catch{alert(mode==='signup'?'이미 가입된 전화번호이거나 입력값을 확인해 주세요.':'이름, 전화번호 또는 비밀번호를 다시 확인해 주세요.')}}
function start(){aiIntervention='standard';sessionStorage.setItem('retone-v2-ai-level','standard');if(signedIn&&!signedInId){sessionStorage.removeItem('retone-v2-name');signedIn=''}if(signedIn)return home();app.innerHTML=`<main class="auth"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><p class="auth-copy">말하기 전에 한 번,<br>이해한 뒤에 한 번.</p><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"></div><small>더 나은 대화와 함께하는 작업 공간</small></section></main>`;authForm('login')}
function androidNav(){return `<nav class="android-nav"><button class="${nav==='chat'?'active':''}" onclick="nav='chat';home()"><span>▣</span>채팅</button><button class="${nav==='friends'?'active':''}" onclick="nav='friends';friends()"><span>♙</span>친구</button><button class="${nav==='settings'?'active':''}" onclick="settings()"><span>⚙</span>설정</button></nav>`}
async function home(){nav='chat';data=await api('/api/bootstrap');roomId=null;const rooms=data.rooms;app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><div><small class="mobile-kicker">Re:Tone</small><h1>채팅</h1></div><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 안녕하세요</h2><p>친구를 골라 대화방을 만들고 초대해 보세요.</p></div><div class="rooms">${rooms.length?rooms.map(r=>`<button class="room" onclick="openRoom('${r.id}')"><span class="avatar">${esc(r.name[0])}</span><span class="copy"><b>${esc(r.name)}</b><span>참여자 ${r.members}명 · ${esc(r.last)}</span></span>${r.unread?`<span class="badge">${r.unread}</span>`:''}</button>`).join(''):`<button class="empty-chat" onclick="newRoom()"><b>친구와 첫 대화를 시작해요</b><span>친구를 선택해 단체 채팅방을 만들 수 있어요. ＋</span></button>`}</div></div></section>${androidNav()}</main>`}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(r=>r.id===id);if(!room)return home();const messages=await api(`/api/rooms/${id}/messages`);const names=['나',...(room.participant_names||[])].join(', ');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button><div class="room-title"><h1>${esc(room.name)}</h1><span>${esc(names)} · ${room.members}명</span></div><div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(a=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(a.task)}</b><small>담당 ${esc(a.assignee)} · ${esc(a.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus()}
async function friends(){nav='friends';const users=await api('/api/users');const list=users.filter(u=>u.id!==signedInId);app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>여러 명을 선택해 단체 채팅방을 만들 수 있어요.</p></div><div class="rooms">${list.length?list.map(u=>`<button class="room" onclick="startDirect(${JSON.stringify(u.name)})"><span class="avatar">${esc(u.name[0])}</span><span class="copy"><b>${esc(u.name)}</b><span>눌러서 1:1 대화 시작</span></span><span>›</span></button>`).join(''):`<div class="empty-chat"><b>아직 가입한 친구가 없어요</b><span>친구가 가입하면 이곳에 나타나요.</span></div>`}</div></div></section>${androidNav()}</main>`}
function friendPicker(users,existing=[]){const choices=users.filter(u=>u.id!==signedInId&&!existing.includes(u.name));return choices.length?`<div class="friend-picker">${choices.map(u=>`<label><input type="checkbox" class="friend-choice" value="${esc(u.name)}"><span>${esc(u.name)}</span></label>`).join('')}</div>`:'<p>초대할 수 있는 친구가 없어요.</p>'}
function chosenFriends(){return [...document.querySelectorAll('.friend-choice:checked')].map(item=>item.value)}
async function newRoom(){const users=await api('/api/users');popup(`<div class="group-modal"><h2>새 단체 채팅</h2><p>방 이름과 함께할 친구를 골라주세요.</p><input id="roomName" placeholder="예: 과학 수행평가 조">${friendPicker(users)}<button onclick="saveRoom()">선택한 친구와 만들기</button></div>`)}
async function saveRoom(){const name=document.querySelector('#roomName')?.value.trim();if(!name)return alert('대화방 이름을 입력해 주세요.');const room=await api('/api/rooms',{method:'POST',body:JSON.stringify({name,members:chosenFriends()})});closePopup();data=await api('/api/bootstrap');openRoom(room.id)}
async function startDirect(name){const room=await api('/api/rooms',{method:'POST',body:JSON.stringify({name,members:[name]})});data=await api('/api/bootstrap');openRoom(room.id)}
async function inviteFriends(){if(!roomId)return;const users=await api('/api/users');const room=data.rooms.find(r=>r.id===roomId);popup(`<div class="group-modal"><h2>친구 초대</h2><p>${esc(room?.name||'대화방')}에 함께할 친구를 고르세요.</p>${friendPicker(users,room?.participant_names||[])}<button onclick="saveInvite()">초대하기</button></div>`)}
async function saveInvite(){const members=chosenFriends();if(!members.length)return alert('초대할 친구를 선택해 주세요.');await api(`/api/rooms/${roomId}/members`,{method:'POST',body:JSON.stringify({members})});closePopup();data=await api('/api/bootstrap');openRoom(roomId)}
function settings(){nav='settings';const avatar=localStorage.getItem('retone-avatar');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님</h2><p>프로필과 앱 사용 환경을 관리해요.</p></div><div class="rooms"><label class="room"><span class="avatar">${avatar?`<img src="${avatar}">`:esc(signedIn[0])}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>이 기기에서만 적용돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><button class="room" onclick="showAiPolicy()"><span class="avatar">✦</span><span class="copy"><b>AI 사용 안내</b><span>대화 도움의 사용 범위를 확인해요.</span></span></button><button class="room danger" onclick="deleteMyAccount()"><span class="avatar">−</span><span class="copy"><b>회원탈퇴</b><span>이 앱의 계정과 데모 데이터를 삭제해요.</span></span></button><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section>${androidNav()}</main>`}
async function deleteMyAccount(){if(!signedInId||!confirm('정말 회원탈퇴할까요? 데모 모드에서는 복구할 수 없어요.'))return;await api(`/api/users/${signedInId}`,{method:'DELETE'});localStorage.removeItem('retone-avatar');logout()}
async function friends(){nav='friends';const users=await api('/api/users');const list=users.filter(u=>u.id!==signedInId);app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>여러 명을 선택해 단체 채팅방을 만들 수 있어요.</p></div><div class="rooms">${list.length?list.map(u=>`<button class="room" data-name="${esc(u.name)}" onclick="startDirect(this.dataset.name)"><span class="avatar">${esc(u.name[0])}</span><span class="copy"><b>${esc(u.name)}</b><span>눌러서 1:1 대화 시작</span></span><span>›</span></button>`).join(''):`<div class="empty-chat"><b>아직 가입한 친구가 없어요</b><span>친구가 가입하면 이곳에 나타나요.</span></div>`}</div></div></section>${androidNav()}</main>`}
function editPendingSend(){
  const original=pendingSend;
  if(!original)return;
  pendingSend=null;
  original.modal?.remove();
  if(!isCurrentSendView(original))return;
  removePendingBubble();
  const input=document.querySelector('#text');
  input.disabled=false;
  input.placeholder='메시지를 입력하세요';
  input.value=original.body;
  updateRewriteButton();
  input.focus();
}
// Per-user inbox state. The demo does not use server-side sessions, so the
// signed-in user's browser tracks which incoming message IDs they have read.
// Polling keeps two independently-open demo windows in sync without a reload.
let inboxPollTimer=null,inboxSyncing=false,unreadCounts={};
const seenMessagesKey=()=>`retone-v2-seen-messages-v1-${signedInId||'guest'}`;
function readSeenMessages(){try{return new Set(JSON.parse(localStorage.getItem(seenMessagesKey())||'[]'))}catch{return new Set()}}
function writeSeenMessages(seen){try{localStorage.setItem(seenMessagesKey(),JSON.stringify([...seen].slice(-2000)))}catch{}}
function isMyMessage(message){return message.sender_id ? message.sender_id===signedInId : Boolean(signedIn)&&message.sender===signedIn}
function markMessagesRead(messages){const seen=readSeenMessages();let changed=false;messages.filter(message=>!isMyMessage(message)).forEach(message=>{if(!seen.has(message.id)){seen.add(message.id);changed=true}});if(changed)writeSeenMessages(seen)}
function chatUnreadTotal(){return Object.values(unreadCounts).reduce((sum,count)=>sum+count,0)}
function updateUnreadUi(){const total=chatUnreadTotal();document.querySelectorAll('[data-chat-unread]').forEach(badge=>{badge.hidden=total===0;badge.textContent=total>99?'99+':String(total)});document.querySelectorAll('[data-room-id]').forEach(row=>{const count=unreadCounts[row.dataset.roomId]||0;const badge=row.querySelector('[data-room-unread]');if(!badge)return;badge.hidden=count===0;badge.textContent=count>99?'99+':String(count)})}
function appendNewMessages(messages){const list=document.querySelector('#messages');if(!list)return;const known=new Set([...list.querySelectorAll('[data-message-id]')].map(item=>item.dataset.messageId));const additions=messages.filter(message=>!known.has(message.id));if(!additions.length)return;const nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<72;list.insertAdjacentHTML('beforeend',additions.map(view).join(''));if(nearBottom)list.scrollTop=list.scrollHeight}
async function refreshInbox(loadRooms=true){if(!signedIn||inboxSyncing)return;inboxSyncing=true;try{if(loadRooms||!data)data=await api('/api/bootstrap');const rooms=data?.rooms||[];const batches=await Promise.all(rooms.map(room=>api(`/api/rooms/${room.id}/messages`)));const seen=readSeenMessages();batches.forEach((messages,index)=>{const room=rooms[index];if(room.id===roomId){messages.filter(message=>!isMyMessage(message)).forEach(message=>seen.add(message.id));appendNewMessages(messages)}unreadCounts[room.id]=messages.filter(message=>!isMyMessage(message)&&!seen.has(message.id)).length});writeSeenMessages(seen);updateUnreadUi()}catch{}finally{inboxSyncing=false}}
function startInboxPolling(){clearInterval(inboxPollTimer);if(signedIn){inboxPollTimer=setInterval(()=>refreshInbox(),2000)}}
function stopInboxPolling(){clearInterval(inboxPollTimer);inboxPollTimer=null;unreadCounts={};stopMessageFeed()}
function rail(){return `<aside class="rail"><div class="brand">Re:<i>Tone</i></div><nav><button class="${nav==='chat'?'active':''}" onclick="nav='chat';home()">채팅 <span class="nav-badge" data-chat-unread hidden></span></button><button class="${nav==='friends'?'active':''}" onclick="nav='friends';friends()">친구 <span class="nav-badge" data-friend-request-count hidden></span></button><button class="${nav==='settings'?'active':''}" onclick="settings()">설정</button></nav><small>${esc(signedIn||'Re:Tone')}</small></aside>`}
function androidNav(){return `<nav class="android-nav"><button class="${nav==='chat'?'active':''}" onclick="nav='chat';home()"><span>▣</span>채팅 <i class="nav-badge" data-chat-unread hidden></i></button><button class="${nav==='friends'?'active':''}" onclick="nav='friends';friends()"><span>♙</span>친구 <i class="nav-badge" data-friend-request-count hidden></i></button><button class="${nav==='settings'?'active':''}" onclick="settings()"><span>⚙</span>설정</button></nav>`}
function view(message){const mine=isMyMessage(message);return `<article class="bubble ${mine?'mine':''}" data-message-id="${esc(message.id)}" ${mine?'':`onclick="inspectMessage(${JSON.stringify(message.body)})"`}><div class="meta">${mine?'나':esc(message.sender)}</div>${esc(message.body)}${mine?`<button class="delete-message" title="메시지 삭제" onclick="removeMessage('${message.id}')">×</button>`:''}</article>`}
async function home(){nav='chat';roomId=null;data=await api('/api/bootstrap');await refreshInbox(false);const rooms=data.rooms;app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><div><small class="mobile-kicker">Re:Tone</small><h1>채팅</h1></div><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 안녕하세요</h2><p>친구를 골라 대화방을 만들고 초대해 보세요.</p></div><div class="rooms">${rooms.length?rooms.map(room=>`<button class="room" data-room-id="${esc(room.id)}" onclick="openRoom('${room.id}')"><span class="avatar">${esc(room.name[0])}</span><span class="copy"><b>${esc(room.name)}</b><span>참여자 ${room.members}명 · ${esc(room.last)}</span></span><span class="badge" data-room-unread hidden></span></button>`).join(''):`<button class="empty-chat" onclick="newRoom()"><b>친구와 첫 대화를 시작해요</b><span>친구를 선택해 단체 채팅방을 만들 수 있어요. ＋</span></button>`}</div></div></section>${androidNav()}</main>`;updateUnreadUi();startInboxPolling()}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room)return home();const messages=await api(`/api/rooms/${id}/messages`);markMessagesRead(messages);unreadCounts[id]=0;const names=['나',...(room.participant_names||[])].join(', ');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button><div class="room-title"><h1>${esc(room.name)}</h1><span>${esc(names)} · ${room.members}명</span></div><div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling()}
function clearStoredSession(){['retone-v2-name','retone-v2-user-id','retone-v2-ai-level','retone-v2-ai-consent'].forEach(key=>sessionStorage.removeItem(key));signedIn='';signedInId='';data=null;roomId=null}
function logout(){stopInboxPolling();clearStoredSession();start()}
// Temporary test shortcuts requested for the two seeded accounts.
function quickTestLogin(name,phone){
  const nameInput=document.querySelector('#auth-name'),phoneInput=document.querySelector('#auth-phone'),passwordInput=document.querySelector('#auth-password');
  if(!nameInput||!phoneInput||!passwordInput)return;
  nameInput.value=name;phoneInput.value=phone;passwordInput.value='111111';
  finishAuth('login');
}
function authForm(mode){
  const join=mode==='signup';
  document.querySelectorAll('.auth-tabs button').forEach((button,index)=>button.classList.toggle('selected',(index===1)===join));
  const shortcuts=join?'':`<div class="test-login-shortcuts"><small>테스트 로그인</small><button type="button" onclick="quickTestLogin('신지훈','01000000000')">신지훈으로 로그인</button><button type="button" onclick="quickTestLogin('바나나','01011111111')">바나나로 로그인</button></div>`;
  document.querySelector('#auth-form').innerHTML=`<label>이름<input id="auth-name" placeholder="이름을 입력하세요"></label><label>전화번호<input id="auth-phone" inputmode="numeric" placeholder="전화번호를 입력하세요"></label><label>비밀번호<input id="auth-password" type="password" placeholder="비밀번호를 입력하세요"></label>${shortcuts}${join?'<button type="button" class="ai-policy-link" onclick="showAiPolicy()">AI가 개입하는 이유와 사용 범위 보기</button><label class="consent"><input id="auth-ai-consent" type="checkbox"> AI 사용 안내를 읽었고, AI 대화 도움 사용에 동의해요.</label>':''}<button class="auth-submit" onclick="finishAuth('${mode}')">${join?'회원가입하고 시작하기':'로그인'}</button>${join?'<p class="auth-hint">같은 전화번호가 있으면 확인 절차가 안내돼요.</p>':''}`;
}
async function start(){aiIntervention='standard';sessionStorage.setItem('retone-v2-ai-level','standard');if(signedIn&&signedInId){try{const users=await api('/api/users');if(users.some(user=>user.id===signedInId))return home();clearStoredSession()}catch{return home()}}else if(signedIn||signedInId){clearStoredSession()}app.innerHTML=`<main class="auth"><section class="auth-card"><div class="auth-brand">Re:<i>Tone</i></div><div class="auth-tabs"><button class="selected" onclick="authForm('login')">로그인</button><button onclick="authForm('signup')">회원가입</button></div><div id="auth-form"></div></section></main>`;authForm('login')}
const hiddenFriendsKey=()=>`retone-v2-hidden-friends-v1-${signedInId||'guest'}`;
function hiddenFriendIds(){try{return new Set(JSON.parse(localStorage.getItem(hiddenFriendsKey())||'[]'))}catch{return new Set()}}
function saveHiddenFriendIds(ids){localStorage.setItem(hiddenFriendsKey(),JSON.stringify([...ids]))}
function hideFriend(id){const ids=hiddenFriendIds();ids.add(id);saveHiddenFriendIds(ids);friends()}
function showFriend(id){const ids=hiddenFriendIds();ids.delete(id);saveHiddenFriendIds(ids);friends()}
async function manageHiddenFriends(){const users=await api('/api/users');const hidden=hiddenFriendIds();const list=users.filter(user=>hidden.has(user.id));popup(`<div class="group-modal"><h2>숨긴 친구 관리</h2><p>이 기기에서만 친구 목록에 보이지 않아요.</p>${list.length?`<div class="hidden-list">${list.map(user=>`<button onclick="showFriend('${user.id}')"><span>${esc(user.name)}</span><b>다시 보이기</b></button>`).join('')}</div>`:'<p>숨긴 친구가 없어요.</p>'}<button onclick="closePopup()">닫기</button></div>`)}
async function friends(){nav='friends';const users=await api('/api/users');const hidden=hiddenFriendIds();const list=users.filter(user=>user.id!==signedInId&&!hidden.has(user.id));const hiddenCount=hidden.size;app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>여러 명을 선택해 단체 채팅방을 만들 수 있어요.</p>${hiddenCount?`<button class="hidden-manage" onclick="manageHiddenFriends()">숨긴 친구 ${hiddenCount}명 관리</button>`:''}</div><div class="rooms">${list.length?list.map(user=>`<div class="friend-row"><button class="room" onclick="startDirect('${esc(user.name)}','${user.id}')"><span class="avatar">${esc(user.name[0])}</span><span class="copy"><b>${esc(user.name)}</b><span>눌러서 1:1 대화 시작</span></span><span>›</span></button><button class="hide-friend" onclick="hideFriend('${user.id}')">숨기기</button></div>`).join(''):`<div class="empty-chat"><b>표시할 친구가 없어요</b><span>친구가 가입하거나 숨긴 친구를 다시 보이게 해주세요.</span></div>`}</div></div></section>${androidNav()}</main>`}
async function startDirect(name,userId){const directKey=[signedInId,userId].sort().join(':');const room=await api('/api/rooms',{method:'POST',body:JSON.stringify({name,members:[name],direct_key:directKey})});data=await api('/api/bootstrap');openRoom(room.id)}
async function saveAgreement(){const task=document.querySelector('#task')?.value.trim();if(!task)return alert('할 일을 입력해 주세요.');await api('/api/agreements',{method:'POST',body:JSON.stringify({task,assignee:document.querySelector('#assignee')?.value||'',deadline:document.querySelector('#deadline')?.value||''})});data=await api('/api/bootstrap');closePopup();await openRoom(roomId)}
async function home(){nav='chat';roomId=null;data=await api('/api/bootstrap');await refreshInbox(false);const rooms=data.rooms;app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><div><small class="mobile-kicker">Re:Tone</small><h1>채팅</h1></div><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님, 안녕하세요</h2><p>친구를 골라 대화방을 만들고 초대해 보세요.</p></div><div class="dash">${scheduleCards()}</div><div class="rooms">${rooms.length?rooms.map(room=>`<button class="room" data-room-id="${esc(room.id)}" onclick="openRoom('${room.id}')"><span class="avatar">${esc(room.name[0])}</span><span class="copy"><b>${esc(room.name)}</b><span>참여자 ${room.members}명 · ${esc(room.last)}</span></span><span class="badge" data-room-unread hidden></span></button>`).join(''):`<button class="empty-chat" onclick="newRoom()"><b>친구와 첫 대화를 시작해요</b><span>친구를 선택해 단체 채팅방을 만들 수 있어요. ＋</span></button>`}</div></div></section>${androidNav()}</main>`;updateUnreadUi();startInboxPolling()}
let roomMessages=[];
function messageContext(){return roomMessages.slice(-6).map(message=>`${message.sender}: ${message.body}`)}
async function runAiCheck(text){if(aiPrefetch.text!==text)return;setAiStatus('AI 확인 중',true);const request=api('/api/ai/check',{method:'POST',body:JSON.stringify({text,ai_intervention:aiIntervention,context:messageContext()})});aiPrefetch.promise=request;try{const result=await request;rememberAiResult(text,result);if(aiPrefetch.text===text){aiPrefetch.result=result;aiPrefetch.promise=null;setAiStatus(result.source==='cache'?'저장된 확인 결과 사용':'AI 확인 완료')}}catch{if(aiPrefetch.text===text){aiPrefetch.promise=null;setAiStatus('')}}}
function view(message){const mine=isMyMessage(message);return `<article class="bubble ${mine?'mine':''}" data-message-id="${esc(message.id)}" ${mine?'':`onclick="inspectMessage(${JSON.stringify(message.body)})"`}><div class="meta">${mine?'나':esc(message.sender)}</div>${esc(message.body)}${mine&&message.unread?`<span class="read">${message.unread}</span>`:''}${mine?`<button class="delete-message" title="메시지 삭제" onclick="removeMessage('${message.id}')">×</button>`:''}</article>`}
function updateReadReceipts(messages){const list=document.querySelector('#messages');if(!list)return;messages.filter(isMyMessage).forEach(message=>{const bubble=list.querySelector(`[data-message-id="${message.id}"]`);if(!bubble)return;const receipt=bubble.querySelector('.read');if(message.unread){if(receipt)receipt.textContent=message.unread;else bubble.insertAdjacentHTML('beforeend',`<span class="read">${message.unread}</span>`)}else receipt?.remove()})}
let messageFeed = null, messageRequest = 0;

function stopMessageFeed() {
  closeRewriteEditor(false);
  pendingSend?.modal?.remove();
  pendingSend=null;
  messageFeed?.events?.close();
  messageFeed = null;
  roomMessages = [];
  pendingReply = null;
}

function feedIsCurrent(feed) {
  return Boolean(feed && feed === messageFeed && roomId === feed.room && signedInId === feed.user && nav === 'chat');
}

function feedIsVisible(feed) {
  return feedIsCurrent(feed) && Boolean(feed.list && document.querySelector('.chat #messages') === feed.list);
}

function forgetMessage(feed, id) {
  if (!feedIsVisible(feed)) return;
  feed.deleted.add(id);
  feed.applied = ++messageRequest;
  feed.list.querySelector(`[data-message-id="${id}"]`)?.remove();
  roomMessages = roomMessages.filter(message => message.id !== id);
  updateRewriteContext(feed.applied);
}

function displaySentMessage(message) {
  const feed = messageFeed;
  if (!feedIsVisible(feed) || message.room_id !== feed.room || feed.deleted.has(message.id)) return null;
  feed.applied = ++messageRequest;
  const selector = `[data-message-id="${message.id}"]`;
  if (!feed.list.querySelector(selector)) {
    feed.list.insertAdjacentHTML('beforeend', view(message));
    roomMessages.push(message);
  }
  feed.list.scrollTop = feed.list.scrollHeight;
  updateRewriteContext(feed.applied);
  return feed.list.querySelector(selector);
}

function reconcileRoomMessages(feed, request, messages) {
  if (!feedIsVisible(feed) || request <= feed.applied) return false;
  feed.applied = request;
  roomMessages = messages.filter(message => !feed.deleted.has(message.id));
  const ids = new Set(roomMessages.map(message => message.id));
  const known = new Set();
  const list = feed.list;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
  for (const bubble of list.querySelectorAll('[data-message-id]')) {
    const id = bubble.dataset.messageId;
    if (ids.has(id)) known.add(id);
    else bubble.remove();
  }
  // Insert any missed older messages before their surviving successors as well.
  let next = null;
  for (let index = roomMessages.length - 1; index >= 0; index--) {
    const message = roomMessages[index];
    if (!known.has(message.id)) {
      if (next) next.insertAdjacentHTML('beforebegin', view(message));
      else list.insertAdjacentHTML('beforeend', view(message));
    }
    next = list.querySelector(`[data-message-id="${message.id}"]`);
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
  updateReadReceipts(roomMessages);
  updateRewriteContext(request);
  return true;
}

async function refreshRoomMessages(feed) {
  if (!feedIsVisible(feed)) return;
  const request = ++messageRequest;
  try {
    const messages = await api(`/api/rooms/${feed.room}/messages`);
    reconcileRoomMessages(feed, request, messages);
  } catch { /* The regular inbox refresh will retry. */ }
}

function watchRoomMessages(feed) {
  if (typeof EventSource === 'undefined') return;
  const events = new EventSource(`/api/rooms/${feed.room}/message-events?user_id=${encodeURIComponent(feed.user)}`);
  feed.events = events;
  events.addEventListener('deleted', event => forgetMessage(feed, event.data));
  events.addEventListener('resync', () => refreshRoomMessages(feed));
  events.onopen = () => refreshRoomMessages(feed);
}
async function refreshInbox(loadRooms=true){if(!signedIn||inboxSyncing)return;inboxSyncing=true;try{if(loadRooms||!data)data=await api('/api/bootstrap');const rooms=data?.rooms||[];const batches=await Promise.all(rooms.map(room=>api(`/api/rooms/${room.id}/messages`)));const reads=[];const seen=readSeenMessages();batches.forEach((messages,index)=>{const room=rooms[index];if(room.id===roomId){const incoming=messages.filter(message=>!isMyMessage(message));incoming.forEach(message=>seen.add(message.id));if(incoming.some(message=>message.unread>0))reads.push(api(`/api/rooms/${room.id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})}));appendNewMessages(messages);updateReadReceipts(messages)}unreadCounts[room.id]=messages.filter(message=>!isMyMessage(message)&&!seen.has(message.id)).length});await Promise.all(reads);writeSeenMessages(seen);updateUnreadUi();updateScheduleUi()}catch{}finally{inboxSyncing=false}}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room)return home();const messages=await api(`/api/rooms/${id}/messages`);roomMessages=messages.slice();await api(`/api/rooms/${id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})});markMessagesRead(messages);unreadCounts[id]=0;const names=['나',...(room.participant_names||[])].join(', ');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button><div class="room-title"><h1>${esc(room.name)}</h1><span>${esc(names)} · ${room.members}명</span></div><div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling()}
async function sendApproved(){
  const next=pendingSend;
  if(!next)return;
  pendingSend=null;
  if(!isCurrentSendView(next))return;
  next.modal?.remove();
  setAiStatus('');
  const sourceQuery=next.result?.info?.queries?.find(query=>String(query||'').trim())||null;
  await sendChatMessage(next.room,next.body,{sourceQuery,replyToId:next.replyToId});
}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room)return home();const messages=await api(`/api/rooms/${id}/messages`);roomMessages=messages.slice();await api(`/api/rooms/${id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})});markMessagesRead(messages);unreadCounts[id]=0;const names=['나',...(room.participant_names||[])].join(', ');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button><div class="room-title"><h1>${esc(room.name)}</h1><span>${esc(names)} · ${room.members}명</span></div><div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><section class="messages" id="messages">${messages.map(view).join('')}${chatScheduleCards(id)}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="queueAiCheck(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling()}
function handleChatInput(value){
  updateRewriteButton();
  queueAiCheck(value);
}

function isCurrentSendView(view){
  return nav==='chat' && view.userId===signedInId && view.room===roomId &&
    view.list && view.list===document.querySelector('.chat #messages');
}

function offerScheduleOnMessage(view,message,proposal){
  if(!proposal?.is_schedule || !isCurrentSendView(view) || message.sender!==signedIn || message.room_id!==roomId)return;
  const bubble=view.list.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if(!bubble || bubble.querySelector('[data-schedule-offer]'))return;
  const offer=document.createElement('button');
  offer.type='button';
  offer.dataset.scheduleOffer='';
  offer.textContent='일정 카드 쓰기';
  offer.addEventListener('click',()=>{
    if(isCurrentSendView(view) && view.list.contains(bubble))showScheduleProposal(message,proposal);
  });
  bubble.append(offer);
}

async function sendChatMessage(room,body,{sourceQuery=null,replyToId=null}={}){
  const view={room,userId:signedInId,list:document.querySelector('.chat #messages')};
  if(!isCurrentSendView(view))return;
  const input=document.querySelector('#text');
  const sender=signedIn;
  // Each result belongs to one outgoing message. A draft, reply, or later room
  // snapshot cannot reuse it. Posting does not wait for classification.
  const decision=/\p{L}/u.test(body)
    ? api('/api/ai/schedule',{method:'POST',body:JSON.stringify({text:body})}).catch(()=>null)
    : Promise.resolve(null);
  try{
    const message=await api(`/api/rooms/${room}/messages`,{method:'POST',body:JSON.stringify({sender,sender_id:view.userId,body,source_query:sourceQuery,reply_to_id:replyToId})});
    if(!isCurrentSendView(view))return;
    removePendingBubble();
    displaySentMessage(message);
    if(pendingReply?.id===replyToId){pendingReply=null;renderPendingReply()}
    void decision.then(proposal=>offerScheduleOnMessage(view,message,proposal));
  }catch{
    if(!isCurrentSendView(view))return;
    removePendingBubble();
    if(input)input.value=body;
    setAiStatus('보내지 못했어요. 다시 보내 주세요.');
  }finally{
    if(input && isCurrentSendView(view)){
      input.disabled=false;
      input.placeholder='메시지를 입력하세요';
      updateRewriteButton();
      input.focus();
    }
  }
}
function strongExpression(text){const compact=String(text||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');return /(시발|씨발|시ㅂ|ㅅㅂ|ㅆㅂ|개새끼|개새|병신|븅신|ㅂㅅ|ㅄ|좆|존나|죽어|죽인다|뒤져|닥쳐|엿먹어|새끼|놈아|년아|지랄|fuck|shit|bitch|asshole)/.test(compact)}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room)return home();await loadUserAvatars();const messages=await api(`/api/rooms/${id}/messages`);roomMessages=messages.slice();await api(`/api/rooms/${id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})});markMessagesRead(messages);unreadCounts[id]=0;const title=roomDisplayName(room),names=roomPeople(room).join(', ');app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button><div class="room-title"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></div><div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><div class="room-notice-host" id="room-schedule-notice">${roomScheduleNotice(id)}</div><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="handleChatInput(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling()}
const avatarStorageKey=()=>`retone-v2-avatar-v2-${signedInId||'guest'}`;
const statusStorageKey=()=>`retone-v2-status-v1-${signedInId||'guest'}`;
async function loadUserAvatars(){const users=await api('/api/users');userAvatarByName=Object.fromEntries(users.map(user=>[user.name,user.avatar_url]));const mine=users.find(user=>user.id===signedInId);localStorage.removeItem('retone-avatar');if(mine?.avatar_url)localStorage.setItem(avatarStorageKey(),mine.avatar_url);else localStorage.removeItem(avatarStorageKey());return users}
async function setAvatar(input){const file=input.files?.[0];if(!file||!signedInId)return;try{const avatar=await resizeAvatar(file);const user=await api(`/api/users/${signedInId}/avatar`,{method:'PATCH',body:JSON.stringify({avatar_url:avatar})});localStorage.removeItem('retone-avatar');if(user.avatar_url)localStorage.setItem(avatarStorageKey(),user.avatar_url);userAvatarByName[signedIn]=user.avatar_url||null;await settings()}catch{alert('프로필 사진을 저장하지 못했어요. 다른 사진으로 다시 시도해 주세요.')}}
function saveStatusMessage(){const input=document.querySelector('#status-message'),status=(input?.value||'').trim().slice(0,60);if(status)localStorage.setItem(statusStorageKey(),status);else localStorage.removeItem(statusStorageKey());settings()}
async function settings(){nav='settings';try{await loadUserAvatars()}catch{}const avatar=userAvatarByName[signedIn]||localStorage.getItem(avatarStorageKey());const status=localStorage.getItem(statusStorageKey())||'';app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="intro"><h2>${esc(signedIn)}님</h2><p>프로필과 앱 사용 환경을 관리해요.</p></div><div class="rooms"><label class="room"><span class="avatar">${avatarMarkup(signedIn,avatar)}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>이 계정의 친구·채팅 화면에 표시돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><section class="profile-status"><b>상태메시지</b><p>친구에게 보여줄 짧은 한마디를 적어 보세요.</p><div><input id="status-message" maxlength="60" value="${proposalInputValue(status)}" placeholder="예: 오늘은 답장이 조금 늦어요"><button onclick="saveStatusMessage()">저장</button></div></section><button class="room" onclick="showAiPolicy()"><span class="avatar">✦</span><span class="copy"><b>AI 사용 안내</b><span>대화 도움의 사용 범위를 확인해요.</span></span></button><button class="room danger" onclick="deleteMyAccount()"><span class="avatar">−</span><span class="copy"><b>회원탈퇴</b><span>이 앱의 계정과 데모 데이터를 삭제해요.</span></span></button><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section>${androidNav()}</main>`}
async function deleteMyAccount(){if(!signedInId||!confirm('정말 회원탈퇴할까요? 데모 모드에서는 복구할 수 없어요.'))return;await api(`/api/users/${signedInId}`,{method:'DELETE'});localStorage.removeItem(avatarStorageKey());localStorage.removeItem(statusStorageKey());localStorage.removeItem('retone-avatar');logout()}
// Older clients used a text-only preview. The final definitions below bind each
// preview to its room snapshot and sender before a result can be reused.
async function runAiCheck(text){
  if(aiPrefetch.text!==text)return null;
  setAiStatus('AI 확인 중',true);
  const request=api('/api/ai/check',{method:'POST',body:JSON.stringify({text,ai_intervention:aiIntervention,sender:signedIn})});
  aiPrefetch.promise=request;
  try{
    const result=await request;
    if(aiPrefetch.text===text){
      aiPrefetch.result=result;
      aiPrefetch.promise=null;
      rememberAiResult(text,result);
      setAiStatus(result.source==='cache'?'저장된 확인 결과 사용':'AI 확인 완료');
    }
    return result;
  }catch{
    if(aiPrefetch.text===text){aiPrefetch.promise=null;setAiStatus('');}
    return null;
  }
}
async function checkForSend(body){
  if(aiIntervention==='off')return {verdict:'PASS',info:{level:'none'}};
  clearTimeout(aiPrefetch.timer);
  aiPrefetch={text:'',result:null,promise:null,timer:null};
  // A send gets a fresh check with the room's recent speakers. Typing previews
  // and text-only saved results cannot stand in for this contextual result.
  const context=roomMessages.slice(-6).map(message=>`${message.sender}: ${message.body}`);
  const result=await api('/api/ai/check',{method:'POST',body:JSON.stringify({text:body,context,ai_intervention:aiIntervention,sender:signedIn})});
  return result||{verdict:'PASS',info:{level:'none'}};
}
function showSendReview(html){
  popup(html);
  const modal=document.querySelector('.modal:last-child .ai-check')?.closest('.modal');
  if(!modal)return;
  pendingSend.modal=modal;
  modal.onclick=event=>{if(event.target===modal)editPendingSend()};
  modal.onkeydown=event=>{if(event.key==='Escape')editPendingSend()};
}
function applyPendingSuggestion(){
  const original=pendingSend,suggestion=original?.result?.suggestion?.trim();
  if(!original||!suggestion)return;
  pendingSend=null;
  original.modal?.remove();
  if(!isCurrentSendView(original))return;
  removePendingBubble();
  const input=document.querySelector('#text');
  input.disabled=false;
  input.placeholder='메시지를 입력하세요';
  input.value=suggestion.replace(/\s*[\r\n]+\s*/g,' ');
  handleChatInput(input.value);
  input.focus();
}
function showCheckResult(result){
  if(!pendingSend)return;
  pendingSend.result=result;
  const info=result.info||{level:'none',queries:[]};
  if(result.error || result.source==='unavailable'){
    removePendingBubble();
    showSendReview(`<div class="ai-check info"><h2>AI 점검을 완료하지 못했어요</h2><p>내용을 직접 확인한 뒤 전송 여부를 선택해 주세요.</p><div class="modal-actions"><button class="quiet" onclick="editPendingSend()">다시 확인하기</button><button onclick="sendApproved()">이대로 보내기</button></div></div>`);
    return;
  }
  if(result.verdict==='WARN'){

    removePendingBubble();
    const suggestion=result.suggestion?.trim();
    showSendReview(suggestion
      ? `<div class="ai-check warn"><h2>이렇게 바꿔볼까요?</h2><p class="ai-suggestion">${esc(suggestion)}</p><div class="modal-actions"><button class="quiet" onclick="editPendingSend()">직접 고치기</button><button onclick="applyPendingSuggestion()">수정안 사용</button></div><button class="send-original" onclick="sendApproved()">원문 그대로 보내기</button></div>`
      : `<div class="ai-check warn"><h2>표현을 다시 볼까요?</h2><p>상대에게 공격적이거나 위협적으로 들릴 수 있어요.</p><div class="modal-actions"><button class="quiet" onclick="editPendingSend()">직접 고치기</button><button onclick="sendApproved()">원문 그대로 보내기</button></div></div>`);
    return;
  }
  if(info.level==='check'){
    // Source checks should enrich a message, not interrupt the conversation.
    // sendApproved stores the suggested query so the collapsed source control
    // can fetch supporting links only when a participant asks to see them.
    sendApproved();
    return;
  }
  sendApproved();
}
async function send(event){
  event.preventDefault();
  if(pendingSend && !isCurrentSendView(pendingSend))pendingSend=null;
  if(pendingSend)return;
  const input=document.querySelector('#text'),body=input?.value.trim();
  if(!body)return;
  const next={body,room:roomId,userId:signedInId,list:document.querySelector('.chat #messages'),replyToId:pendingReply?.id||null};
  pendingSend=next;
  input.value='';input.disabled=true;
  updateRewriteButton();
  input.placeholder='AI가 확인 중이에요…';
  addPendingBubble(body);
  try{
    const result=await checkForSend(body);
    if(pendingSend!==next)return;
    if(!isCurrentSendView(next)){pendingSend=null;return;}
    showCheckResult(result);
  }catch{
    if(pendingSend!==next)return;
    if(!isCurrentSendView(next)){pendingSend=null;return;}
    showCheckResult({error:'AI_CHECK_UNAVAILABLE',source:'unavailable'});
  }
}
// A preview belongs to one sender and one six-message room snapshot. A reply in
// the room changes the key, so a previous speaker's result cannot carry forward.
function aiContextKey(){
  return JSON.stringify([roomId,signedIn,roomMessages.slice(-6).map(message=>message.id||[message.sender,message.body])]);
}
function aiResultKeyV4(text,contextKey=aiContextKey()){return `v7|${aiIntervention}|${contextKey}|${String(text||'').trim().toLowerCase()}`}
function savedAiResult(text,contextKey=aiContextKey()){return aiSavedResults[aiResultKeyV4(text,contextKey)]||null}
function rememberAiResult(text,result,contextKey=aiContextKey()){
  if(!result || result.error || ["unavailable","fallback"].includes(result.source))return;
  const key=aiResultKeyV4(text,contextKey);
  aiSavedResults[key]={...result,source:'saved'};
  const keys=Object.keys(aiSavedResults);
  if(keys.length>180)keys.slice(0,keys.length-180).forEach(key=>delete aiSavedResults[key]);
  try{localStorage.setItem('retone-ai-results-v1',JSON.stringify(aiSavedResults))}catch{}
}
function queueAiCheck(value){
  const text=value.trim(),key=aiContextKey();
  clearTimeout(aiPrefetch.timer);
  if(aiIntervention==='off'||!text){aiPrefetch={text:'',key:'',result:null,promise:null,timer:null};setAiStatus('');return}
  const saved=savedAiResult(text,key);
  if(saved){aiPrefetch={text,key,result:saved,promise:null,timer:null};setAiStatus('AI 확인 완료');return}
  if(aiPrefetch.text===text&&aiPrefetch.key===key&&(aiPrefetch.result||aiPrefetch.promise))return;
  aiPrefetch={text,key,result:null,promise:null,timer:setTimeout(()=>runAiCheck(text,key),120)};
  setAiStatus('AI 확인 준비 중',true);
}
async function runAiCheck(text,key=aiContextKey()){
  if(aiPrefetch.text!==text||aiPrefetch.key!==key)return null;
  setAiStatus('AI 확인 중',true);
  const request=api('/api/ai/check',{method:'POST',body:JSON.stringify({text,context:messageContext(),ai_intervention:aiIntervention,sender:signedIn})});
  aiPrefetch.promise=request;
  try{
    const result=await request;
    if(aiPrefetch.text===text&&aiPrefetch.key===key){
      aiPrefetch.result=result;aiPrefetch.promise=null;rememberAiResult(text,result,key);setAiStatus('AI 확인 완료');
    }
    return result;
  }catch{
    if(aiPrefetch.text===text&&aiPrefetch.key===key){aiPrefetch.promise=null;setAiStatus('')}
    return null;
  }
}
async function checkForSend(body){
  if(aiIntervention==='off')return {verdict:'PASS',info:{level:'none'}};
  const key=aiContextKey(),saved=savedAiResult(body,key);
  if(saved)return saved;
  if(aiPrefetch.text===body&&aiPrefetch.key===key&&aiPrefetch.result)return aiPrefetch.result;
  if(aiPrefetch.text===body&&aiPrefetch.key===key&&aiPrefetch.promise)return (await aiPrefetch.promise)||{verdict:'PASS',source:'unavailable',error:'AI_CHECK_UNAVAILABLE'};
  clearTimeout(aiPrefetch.timer);
  aiPrefetch={text:body,key,result:null,promise:null,timer:null};
  return (await runAiCheck(body,key))||{verdict:'PASS',source:'unavailable',error:'AI_CHECK_UNAVAILABLE'};
}
let userProfilesById={},userProfilesByName={};
async function loadUserAvatars(){
  const users=await api('/api/users');
  userProfilesById=Object.fromEntries(users.map(user=>[user.id,user]));
  userProfilesByName=Object.fromEntries(users.map(user=>[user.name,user]));
  userAvatarByName=Object.fromEntries(users.map(user=>[user.name,user.avatar_url]));
  const mine=userProfilesById[signedInId];
  localStorage.removeItem('retone-avatar');
  if(mine?.avatar_url)localStorage.setItem(avatarStorageKey(),mine.avatar_url);
  else localStorage.removeItem(avatarStorageKey());
  return users;
}
function messageTime(created){
  const date=new Date(Number(created));
  if(Number.isNaN(date.getTime()))return '';
  return new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit',hour12:true}).format(date);
}
function renderPendingReply(){
  const host=document.querySelector('#reply-compose');
  if(!host)return;
  host.hidden=!pendingReply;
  host.innerHTML=pendingReply?`<span><b>${esc(pendingReply.sender)}에게 답장</b><small>${esc(pendingReply.body)}</small></span><button type="button" aria-label="답장 취소" onclick="cancelReply()">×</button>`:'';
}
function startReply(messageId){
  const message=roomMessages.find(item=>item.id===messageId);
  if(!message)return;
  pendingReply={id:message.id,sender:isMyMessage(message)?'나':message.sender,body:message.body};
  renderPendingReply();
  document.querySelector('#text')?.focus();
}
function cancelReply(){pendingReply=null;renderPendingReply()}
async function toggleSources(button,messageId){
  const panel=button.closest('.bubble')?.querySelector('.source-panel');
  if(!panel)return;
  if(!panel.hidden){panel.hidden=true;button.textContent='⌄';button.setAttribute('aria-expanded','false');return}
  panel.hidden=false;button.textContent='⌃';button.setAttribute('aria-expanded','true');
  if(panel.dataset.loaded)return;
  panel.textContent='출처를 찾고 있어요…';
  try{
    const result=await api(`/api/messages/${messageId}/sources`,{method:'POST',body:JSON.stringify({requester_id:signedInId})});
    panel.replaceChildren();
    const label=document.createElement('b');label.textContent='출처에서 확인한 내용';panel.append(label);
    const summary=document.createElement('p');summary.textContent=result.summary;panel.append(summary);
    const links=document.createElement('div');links.className='source-links';
    for(const source of result.sources||[]){const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title||'원문 보기';links.append(link)}
    panel.append(links);panel.dataset.loaded='true';
  }catch{panel.textContent='지금은 출처를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.'}
}
function showUserProfile(userId){
  const user=userProfilesById[userId]||userProfilesByName[userId];
  if(!user)return;
  const status=user.status_message?.trim()||'등록한 상태메시지가 없어요.';
  popup(`<div class="user-profile-modal"><div class="user-profile-avatar">${avatarMarkup(user.name,user.avatar_url)}</div><h2>${esc(user.name)}</h2><p>${esc(status)}</p><button onclick="closePopup()">닫기</button></div>`);
}
function view(message){
  const mine=isMyMessage(message),user=userProfilesByName[message.sender],avatar=user?.avatar_url||userAvatarByName[message.sender],profileButton=!mine&&user?`<button class="message-avatar profile-trigger" aria-label="${esc(message.sender)} 프로필 보기" onclick="event.stopPropagation();showUserProfile('${user.id}')">${avatarMarkup(message.sender,avatar)}</button>`:'';
  const reply=message.reply_to?`<div class="reply-quote"><b>↩ ${esc(message.reply_to.sender)}</b><span>${esc(message.reply_to.body)}</span></div>`:'';
  const source=message.has_sources?`<button type="button" class="source-toggle" aria-label="출처 보기" aria-expanded="false" onclick="event.stopPropagation();toggleSources(this,'${message.id}')">⌄</button><div class="source-panel" hidden onclick="event.stopPropagation()"></div>`:'';
  return `<article class="bubble ${mine?'mine':'peer'}" data-message-id="${esc(message.id)}" ${mine?'':`onclick="inspectMessage(${JSON.stringify(message.body)})"`}>${profileButton}<div class="meta"><span>${mine?'나':esc(message.sender)}</span><time>${messageTime(message.created)}</time></div>${reply}<div class="message-body">${esc(message.body)}</div>${mine&&message.unread?`<span class="read">${message.unread}</span>`:''}<div class="message-tools">${source}<button type="button" class="reply-message" aria-label="답장" title="답장" onclick="event.stopPropagation();startReply('${message.id}')">↩</button></div>${mine?`<button class="delete-message" title="메시지 삭제" onclick="event.stopPropagation();removeMessage('${message.id}')">×</button>`:''}</article>`;
}
async function friends(){
  nav='friends';
  const users=await loadUserAvatars();
  const hidden=hiddenFriendIds(),list=users.filter(user=>user.id!==signedInId&&!hidden.has(user.id)),hiddenCount=hidden.size;
  app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><button class="new-room" onclick="newRoom()">＋ 단톡방</button></header><div class="content"><div class="intro"><h2>Re:Tone 친구</h2><p>프로필 사진을 누르면 친구의 상태메시지를 볼 수 있어요.</p>${hiddenCount?`<button class="hidden-manage" onclick="manageHiddenFriends()">숨긴 친구 ${hiddenCount}명 관리</button>`:''}</div><div class="rooms">${list.length?list.map(user=>`<div class="friend-row"><button class="friend-profile-button" aria-label="${esc(user.name)} 프로필 보기" onclick="showUserProfile('${user.id}')">${avatarMarkup(user.name,user.avatar_url)}</button><button class="room" onclick="startDirect('${esc(user.name)}','${user.id}')"><span class="copy"><b>${esc(user.name)}</b><span>${esc(user.status_message?.trim()||'눌러서 1:1 대화 시작')}</span></span><span>›</span></button><button class="hide-friend" onclick="hideFriend('${user.id}')">숨기기</button></div>`).join(''):`<div class="empty-chat"><b>표시할 친구가 없어요</b><span>친구가 가입하거나 숨긴 친구를 다시 보이게 해주세요.</span></div>`}</div></div></section>${androidNav()}</main>`;
}
async function saveStatusMessage(){
  const input=document.querySelector('#status-message'),status=(input?.value||'').trim().slice(0,60);
  if(!signedInId)return;
  try{
    const user=await api(`/api/users/${signedInId}/status`,{method:'PATCH',body:JSON.stringify({status_message:status})});
    userProfilesById[user.id]=user;userProfilesByName[user.name]=user;userAvatarByName[user.name]=user.avatar_url||null;
    localStorage.removeItem(statusStorageKey());
    await settings();
  }catch{alert('상태메시지를 저장하지 못했어요. 다시 시도해 주세요.')}
}
async function settings(){
  nav='settings';
  roomId=null;
  stopMessageFeed();
  try{await loadUserAvatars()}catch{}
  const mine=userProfilesById[signedInId]||{},avatar=mine.avatar_url||localStorage.getItem(avatarStorageKey()),status=mine.status_message?.trim()||'';
  app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>설정</h1></header><div class="content"><div class="rooms"><label class="room"><span class="avatar">${avatarMarkup(signedIn,avatar)}</span><span class="copy"><b>프로필 사진 바꾸기</b><span>이 계정의 친구·채팅 화면에 표시돼요.</span></span><input hidden type="file" accept="image/*" onchange="setAvatar(this)"></label><section class="profile-status"><b>상태메시지</b><p>${status?`현재 상태: ${esc(status)}`:'친구에게 보여줄 짧은 한마디를 적어 보세요.'}</p><div><input id="status-message" maxlength="60" value="" placeholder="${status?'새 상태메시지 입력':'예: 오늘은 답장이 조금 늦어요'}"><button onclick="saveStatusMessage()">저장</button></div></section><button class="room" onclick="showAiPolicy()"><span class="avatar">✦</span><span class="copy"><b>AI 사용 안내</b><span>대화 도움의 사용 범위를 확인해요.</span></span></button><button class="room danger" onclick="deleteMyAccount()"><span class="avatar">−</span><span class="copy"><b>회원탈퇴</b><span>이 앱의 계정과 데모 데이터를 삭제해요.</span></span></button><button class="room" onclick="logout()"><span class="avatar">↪</span><span class="copy"><b>로그아웃</b><span>이 기기에서 안전하게 로그아웃해요.</span></span></button></div></div></section>${androidNav()}</main>`;
}
async function openRoom(id){
  roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room)return home();
  await loadUserAvatars();const messages=await api(`/api/rooms/${id}/messages`);roomMessages=messages.slice();await api(`/api/rooms/${id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})});markMessagesRead(messages);unreadCounts[id]=0;
  const title=roomDisplayName(room),names=roomPeople(room).join(', '),profile=userProfilesByName[title],titleMarkup=profile?`<button class="chat-profile-trigger" onclick="showUserProfile('${profile.id}')"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></button>`:`<div class="room-title"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></div>`;
  app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button>${titleMarkup}<div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><div class="room-notice-host" id="room-schedule-notice">${roomScheduleNotice(id)}</div><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="handleChatInput(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;
  const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling();
}
let friendRequestIds=new Set(),friendRequestTimer=null;
function accessibleRooms(){return (data?.rooms||[]).filter(room=>(room.participant_ids||[]).includes(signedInId))}
function showFriendRequestToast(count){
  let toast=document.querySelector('#friend-request-toast');
  if(!toast){document.body.insertAdjacentHTML('beforeend','<button id="friend-request-toast" onclick="showFriendRequests()"></button>');toast=document.querySelector('#friend-request-toast')}
  toast.textContent=`친구 요청이 도착했어요! ${count>1?`(${count})`:''}`;toast.hidden=false;
}
async function refreshFriendRequests(notify=true){
  if(!signedInId)return [];
  try{
    const requests=await api(`/api/friends/${signedInId}/requests`),ids=new Set(requests.map(request=>request.id));
    const added=[...ids].filter(id=>!friendRequestIds.has(id));
    friendRequestIds=ids;
    if(notify&&added.length)showFriendRequestToast(requests.length);
    document.querySelectorAll('[data-friend-request-count]').forEach(badge=>{badge.hidden=!requests.length;badge.textContent=requests.length>9?'9+':String(requests.length)});
    return requests;
  }catch{return []}
}
function startFriendRequestPolling(){clearInterval(friendRequestTimer);if(signedInId){refreshFriendRequests(false);friendRequestTimer=setInterval(()=>refreshFriendRequests(true),2000)}}
function stopFriendRequestPolling(){clearInterval(friendRequestTimer);friendRequestTimer=null;friendRequestIds.clear();document.querySelector('#friend-request-toast')?.remove()}
function addFriend(){popup(`<div class="friend-request-modal"><h2>전화번호로 친구 추가</h2><p>친구의 가입 전화번호를 입력하면 요청을 보낼 수 있어요.</p><input id="friend-phone" inputmode="numeric" placeholder="전화번호 입력"><button onclick="sendFriendRequest()">친구 요청 보내기</button></div>`)}
async function sendFriendRequest(){const phone=document.querySelector('#friend-phone')?.value.trim();if(!phone)return alert('전화번호를 입력해 주세요.');try{await api('/api/friend-requests',{method:'POST',body:JSON.stringify({sender_id:signedInId,phone})});closePopup();alert('친구 요청을 보냈어요.')}catch{alert('가입하지 않은 번호이거나 이미 친구 요청을 보냈어요.')}}
async function showFriendRequests(){const requests=await refreshFriendRequests(false);popup(`<div class="group-modal friend-requests"><h2>친구 요청</h2>${requests.length?requests.map(request=>`<div class="friend-request-row"><span class="avatar">${avatarMarkup(request.user.name,request.user.avatar_url)}</span><span><b>${esc(request.user.name)}</b><small>${esc(request.user.status_message?.trim()||'상태메시지가 없어요.')}<br>친구가 되고 싶어요!</small></span><button class="friend-accept" title="수락" onclick="respondFriendRequest('${request.id}',true)">✓</button><button class="friend-decline" title="삭제" onclick="respondFriendRequest('${request.id}',false)">×</button></div>`).join(''):'<p>새 친구 요청이 없어요.</p>'}<button class="quiet schedule-list-close" onclick="closePopup()">닫기</button></div>`)}
async function respondFriendRequest(id,accept){try{await api(`/api/friend-requests/${id}/${accept?'accept':'decline'}/${signedInId}`,{method:accept?'POST':'DELETE'});await refreshFriendRequests(false);closePopup();if(nav==='friends')await friends();alert(accept?'친구가 되었어요!':'친구 요청을 삭제했어요.')}catch{alert('친구 요청을 처리하지 못했어요.')}}
async function friends(){nav='friends';const list=await api(`/api/friends/${signedInId}`),requests=await refreshFriendRequests(false);list.forEach(user=>{userProfilesById[user.id]=user;userProfilesByName[user.name]=user;userAvatarByName[user.name]=user.avatar_url||null});app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><div class="friend-head-actions"><button type="button" class="friend-request-bell" aria-label="친구 요청 알림" title="친구 요청" onclick="void showFriendRequests()">🔔 <span>요청</span><i data-friend-request-count ${requests.length?'':'hidden'}>${requests.length>9?'9+':requests.length}</i></button><button class="new-room" onclick="addFriend()">＋ 친구 추가</button></div></header><div class="content"><div class="intro"><h2>내 친구</h2><p>${list.length?'친구를 눌러 1:1 대화를 시작하세요.':'아직 친구가 없어요. 전화번호로 친구 요청을 보내 보세요.'}</p></div><div class="rooms">${list.length?list.map(user=>`<div class="friend-row"><button class="friend-profile-button" aria-label="${esc(user.name)} 프로필 보기" onclick="showUserProfile('${user.id}')">${avatarMarkup(user.name,user.avatar_url)}</button><button class="room" onclick="startDirect('${esc(user.name)}','${user.id}')"><span class="copy"><b>${esc(user.name)}</b><span>${esc(user.status_message?.trim()||'눌러서 1:1 대화 시작')}</span></span><span>›</span></button></div>`).join(''):`<div class="empty-chat"><b>친구가 없어요</b><span>오른쪽 위 ‘친구 추가’에서 전화번호로 요청을 보내세요.</span></div>`}</div></div></section>${androidNav()}</main>`;startFriendRequestPolling()}
async function startDirect(name,userId){const directKey=[signedInId,userId].sort().join(':');const room=await api('/api/rooms',{method:'POST',body:JSON.stringify({name,members:[name],member_ids:[userId],direct_key:directKey,owner:signedIn,owner_id:signedInId})});data=await api('/api/bootstrap');openRoom(room.id)}
async function refreshInbox(loadRooms=true){if(!signedIn||inboxSyncing)return;inboxSyncing=true;try{if(loadRooms||!data)data=await api('/api/bootstrap');const rooms=accessibleRooms();const batches=await Promise.all(rooms.map(room=>api(`/api/rooms/${room.id}/messages`)));const reads=[],seen=readSeenMessages();batches.forEach((messages,index)=>{const room=rooms[index];if(room.id===roomId){const incoming=messages.filter(message=>!isMyMessage(message));incoming.forEach(message=>seen.add(message.id));if(incoming.some(message=>message.unread>0))reads.push(api(`/api/rooms/${room.id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})}));appendNewMessages(messages);updateReadReceipts(messages)}unreadCounts[room.id]=messages.filter(message=>!isMyMessage(message)&&!seen.has(message.id)).length});await Promise.all(reads);writeSeenMessages(seen);updateUnreadUi();updateScheduleUi()}catch{}finally{inboxSyncing=false}}
async function home(){nav='chat';roomId=null;stopMessageFeed();data=await api('/api/bootstrap');await refreshInbox(false);if(roomId||nav!=='chat')return;const rooms=accessibleRooms();app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><div><small class="mobile-kicker">Re:Tone</small><h1>채팅</h1></div></header><div class="content"><div class="rooms">${rooms.length?rooms.map(room=>{const name=roomDisplayName(room);return `<button class="room" data-room-id="${esc(room.id)}" onclick="openRoom('${room.id}')"><span class="avatar">${esc(name[0])}</span><span class="copy"><b>${esc(name)}</b><span>${esc(room.last)}</span></span><span class="badge" data-room-unread hidden></span></button>`}).join(''):`<button class="empty-chat" onclick="friends()"><b>대화가 없습니다</b><span>친구를 추가해 대화를 시작하세요.</span></button>`}</div><div class="dash">${scheduleCards()}</div></div></section>${androidNav()}</main>`;updateUnreadUi();startInboxPolling();startFriendRequestPolling()}
async function openRoom(id){roomId=id;if(!data)data=await api('/api/bootstrap');const room=data.rooms.find(item=>item.id===id);if(!room||!accessibleRooms().some(item=>item.id===id))return home();await loadUserAvatars();const messages=await api(`/api/rooms/${id}/messages`);roomMessages=messages.slice();await api(`/api/rooms/${id}/read`,{method:'POST',body:JSON.stringify({reader:signedIn})});markMessagesRead(messages);unreadCounts[id]=0;const title=roomDisplayName(room),names=roomPeople(room).join(', '),profile=userProfilesByName[title],titleMarkup=profile?`<button class="chat-profile-trigger" onclick="showUserProfile('${profile.id}')"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></button>`:`<div class="room-title"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></div>`;app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button>${titleMarkup}<div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button></div></header><div class="room-notice-host" id="room-schedule-notice">${roomScheduleNotice(id)}</div><section class="messages" id="messages">${messages.map(view).join('')}${data.agreements.slice(0,1).map(agreement=>`<article class="agreement"><b>✓ 공동 확인 · ${esc(agreement.task)}</b><small>담당 ${esc(agreement.assignee)} · ${esc(agreement.deadline)}</small></article>`).join('')}</section><form class="sendbar" onsubmit="send(event)"><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="handleChatInput(this.value)"><span id="ai-status" class="ai-status"></span><button aria-label="보내기">↑</button></form></section></main>`;const list=document.querySelector('#messages');list.scrollTop=list.scrollHeight;document.querySelector('#text')?.focus();updateUnreadUi();startInboxPolling();startFriendRequestPolling()}
function logout(){stopInboxPolling();stopFriendRequestPolling();clearStoredSession();start()}

// Friend and room controls added here so they supersede the early prototype UI.
var friendshipIds=new Set(),friendshipReady=false;
function roomMuteKey(id){return `retone-room-muted-${signedInId}-${id}`}
function roomIsMuted(id){return localStorage.getItem(roomMuteKey(id))==='1'}
function showSocialToast(text,onClick){document.querySelector('#friend-request-toast')?.remove();document.body.insertAdjacentHTML('beforeend',`<button id="friend-request-toast">${esc(text)}</button>`);const toast=document.querySelector('#friend-request-toast');toast.onclick=()=>{toast.remove();onClick?.()};setTimeout(()=>toast?.remove(),5500)}
function showFriendRequestToast(count){showSocialToast(`친구 요청이 도착했어요! (${count})`,()=>showFriendRequests())}
async function refreshFriendshipState(notify=true){if(!signedInId)return [];try{const list=await api(`/api/friends/${signedInId}`),next=new Set(list.map(user=>user.id)),added=[...next].filter(id=>!friendshipIds.has(id));list.forEach(user=>{userProfilesById[user.id]=user;userProfilesByName[user.name]=user;userAvatarByName[user.name]=user.avatar_url||null});friendshipIds=next;if(friendshipReady&&notify&&added.length){const user=list.find(item=>item.id===added[0]);showSocialToast(`${user?.name||'새 친구'}님과 친구가 되었어요!`,()=>friends());if(nav==='friends')await friends()}friendshipReady=true;return list}catch{return []}}
function startFriendRequestPolling(){clearInterval(friendRequestTimer);if(signedInId){refreshFriendRequests(false);refreshFriendshipState(false);friendRequestTimer=setInterval(()=>{refreshFriendRequests(true);refreshFriendshipState(true)},2000)}}
function stopFriendRequestPolling(){clearInterval(friendRequestTimer);friendRequestTimer=null;friendRequestIds.clear();friendshipIds.clear();friendshipReady=false;document.querySelector('#friend-request-toast')?.remove()}
function showUserProfile(userId){const user=userProfilesById[userId]||userProfilesByName[userId];if(!user)return;const status=user.status_message?.trim()||'등록한 상태메시지가 없어요.',remove=friendshipIds.has(user.id)&&user.id!==signedInId?`<button class="profile-unfriend" onclick="deleteFriend('${user.id}','${esc(user.name)}')">친구 삭제</button>`:'';popup(`<div class="user-profile-modal"><div class="user-profile-avatar">${avatarMarkup(user.name,user.avatar_url)}</div><h2>${esc(user.name)}</h2><p>${esc(status)}</p>${remove}<button onclick="closePopup()">닫기</button></div>`)}
async function deleteFriend(friendId,name){if(!confirm(`${name}님을 친구에서 삭제할까요? 1:1 채팅방도 함께 사라집니다.`))return;try{await api(`/api/friends/${signedInId}/remove/${friendId}`,{method:'DELETE'});friendshipIds.delete(friendId);closePopup();alert('친구를 삭제했어요.');if(nav==='friends')friends();else home()}catch{alert('친구 삭제를 하지 못했어요.')}}
async function friends(){nav='friends';roomId=null;stopMessageFeed();const list=await refreshFriendshipState(false),requests=await refreshFriendRequests(false);app.innerHTML=`<main class="layout android-layout">${rail()}<section class="page"><header class="head"><h1>친구</h1><div class="friend-head-actions"><button type="button" class="friend-request-bell" aria-label="친구 요청 알림" title="친구 요청" onclick="void showFriendRequests()">🔔 <span>요청</span><i data-friend-request-count ${requests.length?'':'hidden'}>${requests.length>9?'9+':requests.length}</i></button><button class="new-room" onclick="addFriend()">＋ 친구 추가</button></div></header><div class="content"><div class="rooms">${list.length?list.map(user=>`<div class="friend-row"><button class="friend-profile-button" aria-label="${esc(user.name)} 프로필 보기" onclick="showUserProfile('${user.id}')">${avatarMarkup(user.name,user.avatar_url)}</button><button class="room" onclick="startDirect('${esc(user.name)}','${user.id}')"><span class="copy"><b>${esc(user.name)}</b><span>${esc(user.status_message?.trim()||'')}</span></span><span>›</span></button><button class="unfriend-square" title="친구 삭제" onclick="deleteFriend('${user.id}','${esc(user.name)}')">×</button></div>`).join(''):`<div class="empty-chat"><b>친구가 없습니다</b></div>`}</div></div></section>${androidNav()}</main>`;startFriendRequestPolling()}
async function refreshInbox(loadRooms=true) {
  if (!signedIn || inboxSyncing) return;
  inboxSyncing = true;
  const user = signedInId;
  try {
    if (loadRooms || !data) {
      const latest = await api('/api/bootstrap');
      if (user !== signedInId) return;
      data = latest;
    }
    const rooms = accessibleRooms(), feed = messageFeed, request = ++messageRequest;
    const batches = await Promise.all(rooms.map(room => api(`/api/rooms/${room.id}/messages`)));
    if (user !== signedInId) return;
    const reads = [], seen = readSeenMessages();
    batches.forEach((snapshot, index) => {
      const room = rooms[index];
      let messages = snapshot;
      if (room.id === feed?.room && feedIsVisible(feed)) {
        if (!reconcileRoomMessages(feed, request, snapshot)) return;
        messages = roomMessages;
        const incoming = messages.filter(message => !isMyMessage(message));
        incoming.forEach(message => seen.add(message.id));
        if (incoming.some(message => message.unread > 0)) {
          reads.push(api(`/api/rooms/${room.id}/read`, {method:'POST', body:JSON.stringify({reader:signedIn})}));
        }
      }
      unreadCounts[room.id] = roomIsMuted(room.id) ? 0 : messages.filter(message => !isMyMessage(message) && !seen.has(message.id)).length;
      const preview = document.querySelector(`.rooms [data-room-id="${room.id}"] .copy > span`);
      if (preview) preview.textContent = messages.at(-1)?.body || '새 대화를 시작해 보세요.';
    });
    await Promise.all(reads);
    if (user !== signedInId) return;
    writeSeenMessages(seen);
    updateUnreadUi();
    updateScheduleUi();
  } catch {} finally { inboxSyncing = false; }
}
function roomMenu(){const room=data?.rooms.find(item=>item.id===roomId);if(!room)return;popup(`<div class="room-menu"><h2>채팅방 메뉴</h2><button onclick="closePopup();newAppointment()">일정 카드 만들기</button><button onclick="closePopup();showRoomSchedules('${room.id}')">일정 전체 보기</button><button onclick="toggleRoomMute()">${roomIsMuted(room.id)?'알림 켜기':'채팅방 알림 끄기'}</button><button class="room-leave" onclick="leaveCurrentRoom()">채팅방 나가기</button><button class="quiet" onclick="closePopup()">닫기</button></div>`)}
function toggleRoomMute(){if(!roomId)return;if(roomIsMuted(roomId))localStorage.removeItem(roomMuteKey(roomId));else localStorage.setItem(roomMuteKey(roomId),'1');closePopup();updateUnreadUi();alert(roomIsMuted(roomId)?'이 채팅방 알림을 켰어요.':'이 채팅방 알림을 껐어요.')}
async function leaveCurrentRoom(){if(!roomId||!confirm('이 채팅방에서 나갈까요? 나간 뒤에는 이전 대화를 볼 수 없어요.'))return;const leavingRoom=roomId;roomId=null;try{await api(`/api/rooms/${leavingRoom}/leave/${signedInId}`,{method:'DELETE'});closePopup();data=await api('/api/bootstrap');home()}catch{alert('채팅방에서 나가지 못했어요.')}}
async function openRoom(id) {
  stopMessageFeed();
  roomId = id;
  nav = 'chat';
  const feed = {room:id, user:signedInId, list:null, events:null, applied:0, deleted:new Set()};
  messageFeed = feed;
  if (!data) {
    const latest = await api('/api/bootstrap');
    if (!feedIsCurrent(feed)) return;
    data = latest;
  }
  const room = accessibleRooms().find(item => item.id === id);
  if (!room) return home();
  await loadUserAvatars();
  if (!feedIsCurrent(feed)) return;
  const request = ++messageRequest;
  const messages = await api(`/api/rooms/${id}/messages`);
  if (!feedIsCurrent(feed)) return;
  roomMessages = messages.slice();
  feed.applied = request;
  const title=roomDisplayName(room),names=roomPeople(room).join(', '),profile=userProfilesByName[title],titleMarkup=profile?`<button class="chat-profile-trigger" onclick="showUserProfile('${profile.id}')"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></button>`:`<div class="room-title"><h1>${esc(title)}</h1><span>${esc(names)} · ${room.members}명</span></div>`;
  app.innerHTML=`<main class="layout android-layout">${rail()}<section class="chat"><header class="head chat-head"><button class="back" onclick="home()">‹</button>${titleMarkup}<div class="chat-actions"><button onclick="inviteFriends()">＋ 초대</button><button onclick="newAgreement()">✓</button><button class="room-more" aria-label="채팅방 메뉴" onclick="roomMenu()">⋯</button></div></header><div class="room-notice-host" id="room-schedule-notice">${roomScheduleNotice(id)}</div><section class="messages" id="messages" data-room-id="${esc(id)}">${messages.map(view).join('')}</section><form class="sendbar" onsubmit="send(event)"><div id="reply-compose" class="reply-compose" hidden></div><input id="text" placeholder="메시지를 입력하세요" autocomplete="off" oninput="handleChatInput(this.value)"><span id="ai-status" class="ai-status"></span><button type="submit" aria-label="보내기">↑</button></form></section></main>`;
  feed.list = document.querySelector('#messages');
  feed.list.scrollTop = feed.list.scrollHeight;
  document.querySelector('#text')?.focus();
  watchRoomMessages(feed);
  markMessagesRead(messages);
  unreadCounts[id] = 0;
  updateUnreadUi();
  startInboxPolling();
  startFriendRequestPolling();
  if (messages.some(message => !isMyMessage(message) && message.unread > 0)) {
    await api(`/api/rooms/${id}/read`, {method:'POST', body:JSON.stringify({reader:signedIn})});
  }
}
let userAvatarByName={};
function roomPeople(room){return (room.participant_names||[]).filter(Boolean)}
function avatarSource(url){return url||''}
function roomDisplayName(room){const names=room.direct_member_names||room.participant_names||[];return room.direct_key?(names.find(name=>name!==signedIn)||room.name||'채팅'):room.name||'채팅'}
function showAiPolicy(){popup(`<div class="ai-policy"><span>Re:Tone AI 안내 · 2026.11</span><h2>내 대화를 돕기 위한 AI 사용</h2><p><b>왜 개입하나요?</b><br>강한 표현을 부드럽게 다듬고, 외부 자료로 확인할 수 있는 정보성 문장에는 접힌 출처 버튼을 붙이기 위해서예요.</p><p><b>무엇을 보내나요?</b><br>보내려는 메시지와 같은 채팅방의 최근 메시지 최대 6개를 필요한 경우 OpenAI API로 보내 점검해요. 출처 화살표를 누르면 해당 문장과 짧은 검색어만 웹 검색에 사용하며, 다른 채팅방 내용·전화번호·비밀번호·프로필은 보내지 않아요.</p><p><b>무엇을 하지 않나요?</b><br>출처 요약을 절대적인 진실로 단정하지 않고, AI가 대신 메시지를 보내지 않아요. 링크의 원문과 작성 날짜를 함께 확인해 주세요.</p><small>AI 점검 결과와 이미 찾은 출처는 같은 요청을 빠르게 처리하기 위해 보관될 수 있어요.</small><button onclick="closePopup()">확인했어요</button></div>`)}
start();

