let activeRewrite = null;

function updateRewriteButton() {
  const button = document.querySelector('.sendbar [data-rewrite-draft]');
  if (!button) return;
  const input = document.querySelector('#text');
  button.disabled = !input || input.disabled || !input.value.trim();
}

function closeRewriteEditor(focusInput = true) {
  const editor = activeRewrite;
  if (!editor) return;
  activeRewrite = null;
  editor.controller.abort();
  editor.modal.remove();
  if (focusInput && isCurrentSendView(editor)) editor.input.focus();
}

function rewriteDraft() {
  const input = document.querySelector('#text');
  if (activeRewrite || pendingSend || !input || input.disabled || !input.value.trim()) return;
  const view = {room: roomId, userId: signedInId, list: document.querySelector('.chat #messages')};
  if (!isCurrentSendView(view)) return;
  popup(`<div id="rewrite-editor" role="dialog" aria-modal="true" aria-labelledby="rewrite-heading">
    <h2 id="rewrite-heading">말 고치기</h2>
    <h3>원문</h3><p data-original></p>
    <h3>제안</h3><p data-result aria-live="polite"></p>
    <div class="modal-actions"><button type="button" class="quiet" data-cancel>취소</button>
    <button type="button" data-retry hidden>다시 시도</button>
    <button type="button" data-apply disabled>입력창에 적용</button></div></div>`);
  const panel = document.querySelector('#rewrite-editor');
  const modal = panel.closest('.modal');
  const editor = {...view, input, original: input.value, modal, controller: new AbortController(),
    result: panel.querySelector('[data-result]'), apply: panel.querySelector('[data-apply]'),
    retry: panel.querySelector('[data-retry]'), contextIds: null, suggestion: ''};
  activeRewrite = editor;
  panel.querySelector('[data-original]').textContent = editor.original;
  const cancel = panel.querySelector('[data-cancel]');
  cancel.onclick = () => closeRewriteEditor();
  cancel.focus();
  modal.onclick = event => { if (event.target === modal) closeRewriteEditor(); };
  modal.onkeydown = event => { if (event.key === 'Escape') closeRewriteEditor(); };
  editor.retry.onclick = () => loadRewrite(editor);
  editor.apply.onclick = () => {
    if (editor !== activeRewrite) return;
    if (!isCurrentSendView(editor) || input.value !== editor.original) {
      closeRewriteEditor(false);
      return;
    }
    if (!editor.suggestion || editor.apply.disabled) return;
    input.value = editor.suggestion;
    closeRewriteEditor();
    handleChatInput(input.value);
  };
  void loadRewrite(editor);
}

async function loadRewrite(editor, changed = false) {
  editor.contextIds = null;
  editor.suggestion = '';
  editor.apply.hidden = false;
  editor.apply.disabled = true;
  editor.retry.hidden = true;
  editor.result.textContent = changed ? '새 대화를 반영하는 중…' : '대화를 읽고 있어요…';
  let response;
  try {
    response = await api(`/api/rooms/${encodeURIComponent(editor.room)}/rewrite`, {
      method: 'POST', signal: editor.controller.signal,
      body: JSON.stringify({user_id: editor.userId, text: editor.original})
    });
  } catch { /* An offline request leaves the original in the composer. */ }
  if (editor !== activeRewrite) return;
  if (!isCurrentSendView(editor) || editor.input.value !== editor.original) {
    closeRewriteEditor(false);
    return;
  }
  if (!response?.suggestion?.trim() || !Array.isArray(response.context_ids)) {
    editor.apply.hidden = true;
    editor.retry.hidden = false;
    editor.result.textContent = response?.error === 'CONVERSATION_CHANGED'
      ? '새 메시지가 도착했어요. 최신 대화로 다시 고쳐 주세요.'
      : '말을 고치지 못했어요. 잠시 후 다시 시도해 주세요.';
    return;
  }
  editor.suggestion = response.suggestion.trim().replace(/\s*[\r\n]+\s*/g, ' ');
  editor.result.textContent = editor.suggestion;
  editor.contextIds = response.context_ids;
  // An older in-flight poll may still return the transcript from before this answer.
  editor.observedAfter = messageRequest;
  editor.apply.disabled = false;
}

function updateRewriteContext(request) {
  const editor = activeRewrite;
  if (!editor?.contextIds || request <= editor.observedAfter || !isCurrentSendView(editor)) return;
  const ids = roomMessages.slice(-6).map(message => message.id);
  if (ids.length !== editor.contextIds.length || ids.some((id, i) => id !== editor.contextIds[i])) {
    void loadRewrite(editor, true);
  }
}

function rewritePending() {
  const original = pendingSend;
  editPendingSend();
  if (original && isCurrentSendView(original)) rewriteDraft();
}
