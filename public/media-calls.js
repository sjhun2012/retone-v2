(() => {
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  let mediaRoomId = null;
  let recorder = null;
  let recorderStream = null;
  let recorderChunks = [];
  let recorderStarted = 0;
  let inviteTimer = null;
  let inviteSince = Date.now();
  let activeCall = null;

  const callUrl = (room, call, suffix = 'signals') => `/api/rooms/${encodeURIComponent(room)}/calls/${encodeURIComponent(call)}/${suffix}`;
  const messageAttachmentUrl = message => `/api/rooms/${encodeURIComponent(message.room_id)}/messages/${encodeURIComponent(message.id)}/attachment`;

  function attachmentMarkup(message) {
    const attachment = message.attachment;
    if (!attachment) return '';
    const url = messageAttachmentUrl(message);
    const label = esc(attachment.name || (attachment.kind === 'audio' ? '음성 메시지' : '첨부 파일'));
    if (attachment.kind === 'audio') {
      const duration = attachment.duration_ms ? ` · ${Math.max(1, Math.round(attachment.duration_ms / 1000))}초` : '';
      return `<div class="message-attachment audio-attachment"><audio controls preload="metadata" src="${url}"></audio><span>${label}${duration}</span></div>`;
    }
    const size = attachment.size ? ` · ${formatBytes(attachment.size)}` : '';
    return `<a class="message-attachment file-attachment" href="${url}" download="${label}">⇩ <span>${label}${size}</span></a>`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value}B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }

  // The base chat renderer calls this helper when it sees an attachment. Keep
  // the renderer itself untouched so media enhancements cannot affect sends.
  window.retoneAttachmentMarkup = attachmentMarkup;

  function currentRoom() { return (data?.rooms || []).find(room => room.id === roomId); }
  function roomTarget(room) { return (room?.participant_ids || []).find(id => id && id !== signedInId) || null; }

  function addMediaControls() {
    const chat = document.querySelector('.chat');
    const actions = chat?.querySelector('.chat-actions');
    if (!chat || !actions || actions.dataset.mediaReady) return;
    actions.dataset.mediaReady = 'true';
    actions.insertAdjacentHTML('beforeend', '<button type="button" class="media-action" title="파일 보내기" onclick="chooseChatFile()">＋ 파일</button><button type="button" class="media-action record-voice" title="음성 녹음" onclick="toggleVoiceRecording()">🎙</button><button type="button" class="media-action" title="보이스톡" onclick="startCall(\'audio\')">☎</button><button type="button" class="media-action" title="화상통화" onclick="startCall(\'video\')">▣</button>');
    const input = document.createElement('input');
    input.type = 'file'; input.id = 'chat-file-input'; input.hidden = true;
    input.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) uploadFile(file); });
    chat.append(input);
    if (typeof renderPendingReply === 'function') renderPendingReply();
  }

  async function uploadFile(file, kind = 'file', durationMs = null) {
    if (file.size > MAX_FILE_BYTES) { alert('파일은 8MB 이하만 보낼 수 있어요.'); return; }
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    try {
      const message = await api(`/api/rooms/${encodeURIComponent(roomId)}/attachments`, { method: 'POST', body: JSON.stringify({ kind, name: file.name || '음성 메시지.webm', mime: file.type || (kind === 'audio' ? 'audio/webm' : 'application/octet-stream'), data_url: dataUrl, duration_ms: durationMs }) });
      roomMessages.push(message);
      displaySentMessage(message);
    } catch { alert('전송하지 못했어요. 파일 크기나 형식을 확인해 주세요.'); }
  }

  function chooseChatFile() { document.querySelector('#chat-file-input')?.click(); }

  async function toggleVoiceRecording() {
    if (recorder) { recorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { alert('이 브라우저에서는 음성 녹음을 지원하지 않아요.'); return; }
    try {
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported?.(type));
      recorder = preferred ? new MediaRecorder(recorderStream, { mimeType: preferred }) : new MediaRecorder(recorderStream);
      recorderChunks = []; recorderStarted = Date.now();
      recorder.ondataavailable = event => { if (event.data.size) recorderChunks.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(recorderChunks, { type: recorder.mimeType || 'audio/webm' });
        const stream = recorderStream; recorder = null; recorderStream = null; recorderChunks = [];
        stream?.getTracks().forEach(track => track.stop());
        const file = new File([blob], '음성 메시지.webm', { type: blob.type || 'audio/webm' });
        await uploadFile(file, 'audio', Date.now() - recorderStarted);
        const button = document.querySelector('.record-voice'); if (button) button.textContent = '🎙';
      };
      recorder.start();
      const button = document.querySelector('.record-voice'); if (button) button.textContent = '■';
    } catch { recorder = null; recorderStream?.getTracks().forEach(track => track.stop()); recorderStream = null; alert('마이크 사용을 허용해야 음성을 녹음할 수 있어요.'); }
  }

  async function sendSignal(call, kind, payload = {}) {
    if (!call) return;
    try { await api(callUrl(call.roomId, call.callId), { method: 'POST', body: JSON.stringify({ target_id: call.targetId, kind, payload }) }); } catch { updateCallStatus('신호를 보내지 못했어요.'); }
  }

  function updateCallStatus(text) { const status = document.querySelector('#call-status'); if (status) status.textContent = text; }
  function callOverlay(kind) {
    if (document.querySelector('#call-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `<div id="call-overlay" class="call-overlay"><section><div class="call-top"><b>${kind === 'video' ? '화상통화' : '보이스톡'}</b><button type="button" onclick="endCall()">×</button></div><div class="call-stage"><video id="call-remote-video" autoplay playsinline></video><audio id="call-remote-audio" autoplay></audio><video id="call-local-video" autoplay muted playsinline></video><div id="call-status">연결 준비 중…</div></div><button class="call-end" type="button" onclick="endCall()">통화 종료</button></section></div>`);
  }

  function closeCallOverlay() { document.querySelector('#call-overlay')?.remove(); }

  async function setupPeer(call) {
    const config = await api('/api/config').catch(() => ({}));
    const iceServers = config.webrtc_stun_url ? [{ urls: config.webrtc_stun_url }] : [];
    const pc = new RTCPeerConnection({ iceServers });
    call.pc = pc; call.pendingCandidates = [];
    pc.onicecandidate = event => { if (event.candidate) void sendSignal(call, 'candidate', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate); };
    pc.ontrack = event => {
      const video = document.querySelector('#call-remote-video'); const audio = document.querySelector('#call-remote-audio');
      const stream = event.streams[0]; if (video) video.srcObject = stream; if (audio) audio.srcObject = stream;
    };
    pc.onconnectionstatechange = () => {
      if (!activeCall || activeCall !== call) return;
      if (pc.connectionState === 'connected') updateCallStatus('연결됨');
      else if (['failed', 'disconnected'].includes(pc.connectionState)) updateCallStatus('연결이 불안정해요. 잠시 기다리거나 다시 시도해 주세요.');
    };
    callOverlay(call.media);
    const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.media === 'video' });
    call.localStream = local; local.getTracks().forEach(track => pc.addTrack(track, local));
    const localVideo = document.querySelector('#call-local-video'); if (localVideo) { localVideo.srcObject = local; localVideo.hidden = call.media !== 'video'; }
  }

  async function processSignal(call, signal) {
    if (!activeCall || activeCall !== call || signal.from_id === signedInId) return;
    if (signal.kind === 'hangup' || signal.kind === 'reject') { updateCallStatus(signal.kind === 'reject' ? '상대가 통화를 거절했어요.' : '상대가 통화를 종료했어요.'); setTimeout(() => endCall(false), 500); return; }
    if (signal.kind === 'offer' && call.role === 'callee') {
      await call.pc.setRemoteDescription(signal.payload);
      for (const candidate of call.pendingCandidates.splice(0)) await call.pc.addIceCandidate(candidate).catch(() => {});
      const answer = await call.pc.createAnswer(); await call.pc.setLocalDescription(answer); await sendSignal(call, 'answer', answer);
      updateCallStatus('상대의 응답을 기다리는 중…'); return;
    }
    if (signal.kind === 'answer' && call.role === 'caller') { await call.pc.setRemoteDescription(signal.payload); updateCallStatus('연결 중…'); return; }
    if (signal.kind === 'candidate') {
      if (call.pc.remoteDescription) await call.pc.addIceCandidate(signal.payload).catch(() => {}); else call.pendingCandidates.push(signal.payload);
    }
  }

  async function pollCallSignals() {
    const call = activeCall; if (!call) return;
    try {
      const signals = await api(`${callUrl(call.roomId, call.callId)}?since=${Math.max(0, call.since - 1)}`);
      for (const signal of signals) { if (call.seen.has(signal.id)) continue; call.seen.add(signal.id); call.since = Math.max(call.since, Number(signal.created) || call.since); await processSignal(call, signal); }
    } catch {}
    if (activeCall === call) call.pollTimer = setTimeout(pollCallSignals, 900);
  }

  async function startCall(media) {
    if (activeCall) { alert('이미 통화 중이에요.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') { alert('이 브라우저에서는 통화를 지원하지 않아요.'); return; }
    const room = currentRoom(), targetId = roomTarget(room);
    if (!room || !targetId) { alert('통화할 상대가 이 채팅방에 없어요.'); return; }
    const call = { roomId, callId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, targetId, media, role: 'caller', since: Date.now() - 1000, seen: new Set() };
    activeCall = call;
    try {
      await setupPeer(call); updateCallStatus('상대에게 통화 요청 중…');
      await sendSignal(call, 'invite', { media });
      const offer = await call.pc.createOffer(); await call.pc.setLocalDescription(offer); await sendSignal(call, 'offer', offer);
      pollCallSignals();
    } catch { updateCallStatus('통화를 시작하지 못했어요.'); setTimeout(() => endCall(false), 800); }
  }

  function showIncomingInvite(signal) {
    if (activeCall || document.querySelector('#incoming-call-modal')) return;
    const media = signal.payload?.media === 'video' ? 'video' : 'audio';
    document.body.insertAdjacentHTML('beforeend', `<div id="incoming-call-modal" class="modal"><section><h2>${media === 'video' ? '화상통화' : '보이스톡'} 요청</h2><p>상대가 통화를 요청했어요.</p><button onclick="acceptIncomingCall('${signal.call_id}','${signal.from_id}','${media}',${signal.created})">받기</button><button class="quiet" onclick="rejectIncomingCall('${signal.call_id}','${signal.from_id}')">거절</button></section></div>`);
  }

  async function acceptIncomingCall(callId, targetId, media, created) {
    document.querySelector('#incoming-call-modal')?.remove();
    if (activeCall) return;
    const call = { roomId, callId, targetId, media, role: 'callee', since: Number(created) - 1, seen: new Set() };
    activeCall = call;
    try { await setupPeer(call); updateCallStatus('상대의 통화를 연결하는 중…'); pollCallSignals(); }
    catch { endCall(false); alert('통화를 받을 수 없어요. 마이크·카메라 권한을 확인해 주세요.'); }
  }

  async function rejectIncomingCall(callId, targetId) {
    document.querySelector('#incoming-call-modal')?.remove();
    try { await api(callUrl(roomId, callId), { method: 'POST', body: JSON.stringify({ target_id: targetId, kind: 'reject', payload: {} }) }); } catch {}
  }

  function endCall(notify = true) {
    const call = activeCall;
    if (!call) { closeCallOverlay(); return; }
    if (notify) void sendSignal(call, 'hangup', {});
    if (call.pollTimer) clearTimeout(call.pollTimer);
    call.pc?.close(); call.localStream?.getTracks().forEach(track => track.stop());
    activeCall = null; closeCallOverlay();
  }

  async function pollInvites() {
    if (!mediaRoomId || activeCall) return;
    try {
      const invites = await api(`/api/rooms/${encodeURIComponent(mediaRoomId)}/call-invites?since=${Math.max(0, inviteSince - 1)}`);
      for (const invite of invites) { inviteSince = Math.max(inviteSince, Number(invite.created) || inviteSince); showIncomingInvite(invite); }
    } catch {}
  }

  function startInvitePolling(id) { mediaRoomId = id; clearInterval(inviteTimer); inviteSince = Date.now(); void pollInvites(); inviteTimer = setInterval(pollInvites, 1800); }
  function stopInvitePolling() { clearInterval(inviteTimer); inviteTimer = null; mediaRoomId = null; }

  window.chooseChatFile = chooseChatFile;
  window.addMediaControls = addMediaControls;
  window.toggleVoiceRecording = toggleVoiceRecording;
  window.startCall = startCall;
  window.acceptIncomingCall = acceptIncomingCall;
  window.rejectIncomingCall = rejectIncomingCall;
  window.endCall = endCall;

})();
