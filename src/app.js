'use strict';
const $ = selector => document.querySelector(selector);
const api = window.metaChan;
let state = null;
let selectedTab = 'chat';
let connection = null;
let toastTimer;
let framePending = false;
const streamed = new Map();

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function messageFrom(error) { return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
async function run(action) { try { return await action(); } catch (error) { toast(messageFrom(error)); } }
const tabs = {
  chat: ['A LITTLE COMPANY. A LOT OF POSSIBILITY.', 'Hey, I’m Meta-chan.'],
  tasks: ['SMALL STEPS. REAL PROGRESS.', 'A little less on your mind.'],
  memory: ['A SPACE THAT FEELS LIKE YOU.', 'The things worth remembering.'],
  settings: ['YOUR COMPANION. YOUR WAY.', 'Make it feel like home.'],
};
function openTab(tab) {
  selectedTab = tab;
  document.querySelectorAll('.pane').forEach(pane => { pane.hidden = pane.id !== `pane-${tab}`; });
  document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('active', active); active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current'); });
  $('#page-eyebrow').textContent = tabs[tab][0];
  $('#page-title').textContent = tabs[tab][1];
  if (tab === 'settings') fillSettings();
}
function applyState(next) {
  state = next;
  document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
  $('#model-label').textContent = state.settings.model;
  $('#voice-toggle').textContent = state.settings.voice ? 'Voice on' : 'Voice off';
  $('#voice-toggle').setAttribute('aria-pressed', String(state.settings.voice));
  $('#voice-toggle').setAttribute('aria-label', state.settings.voice ? 'Disable spoken replies' : 'Enable spoken replies');
  $('#voice-toggle').disabled = state.busy;
  $('#new-chat').disabled = state.busy || !state.messages.length;
  $('#save-settings').disabled = state.busy;
  $('#clear-data').disabled = state.busy;
  $('#send-message').hidden = state.busy;
  $('#send-message').disabled = !$('#message-input').value.trim();
  $('#stop-reply').hidden = !state.busy;
  $('#chat-subtitle').textContent = state.busy ? 'Thinking with you…' : 'Your space to think out loud';
  $('#character-state').textContent = state.busy ? 'THINKING WITH YOU' : connection?.installed ? 'READY WHEN YOU ARE' : 'LET’S GET YOU CONNECTED';
  renderMessages(); renderTasks(); renderMemories();
}
function formatContent(container, content) {
  container.replaceChildren();
  const parts = content.split('```');
  parts.forEach((part, index) => {
    if (index % 2) { const pre = el('pre'); pre.append(el('code', '', part.replace(/^[\w+#.-]*\n/, ''))); container.append(pre); }
    else container.append(document.createTextNode(part));
  });
}
function renderMessages() {
  const list = $('#messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  list.replaceChildren();
  $('#empty-chat').hidden = state.messages.length > 0;
  for (const message of state.messages) {
    const row = el('article', `message ${message.role}`);
    row.dataset.id = message.id;
    const label = el('div', 'message-label', message.role === 'user' ? (state.settings.name || 'You') : 'Meta-chan');
    const time = new Date(message.createdAt);
    if (!Number.isNaN(time.getTime())) label.append(el('small', '', time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    row.append(label);
    const body = el('div', 'message-body');
    const content = streamed.get(message.id) ?? message.content;
    if (!content && message.status === 'streaming' && state.busy) body.append(el('span', 'typing', '•••'));
    else formatContent(body, content);
    row.append(body);
    if (message.status === 'error') row.append(el('div', 'message-status', 'Reply interrupted. You can send the question again.'));
    if (message.status === 'stopped') row.append(el('div', 'message-status', 'Reply stopped.'));
    if (message.role === 'assistant' && content && !state.busy) {
      const actions = el('div', 'message-actions');
      const speakButton = el('button', '', 'Read aloud'); speakButton.addEventListener('click', () => speak(content)); actions.append(speakButton); row.append(actions);
    }
    list.append(row);
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}
function renderTasks() {
  const list = $('#tasks-list'); list.replaceChildren();
  const completed = state.tasks.filter(task => task.done).length;
  $('#task-count').textContent = state.tasks.length - completed;
  $('#task-summary').textContent = `${completed} of ${state.tasks.length} complete`;
  $('#tasks-empty').hidden = state.tasks.length > 0;
  for (const task of state.tasks) {
    const row = el('div', `list-item${task.done ? ' done' : ''}`);
    const toggle = el('button', 'task-check', '✓'); toggle.setAttribute('aria-label', `${task.done ? 'Reopen' : 'Complete'} ${task.text}`); toggle.setAttribute('aria-pressed', String(task.done)); toggle.addEventListener('click', () => run(() => api.toggleTask(task.id)));
    const remove = el('button', 'delete-item', '×'); remove.setAttribute('aria-label', `Delete task: ${task.text}`); remove.addEventListener('click', () => run(() => api.deleteTask(task.id)));
    row.append(toggle, el('span', 'item-text', task.text), remove); list.append(row);
  }
}
function renderMemories() {
  const list = $('#memories-list'); list.replaceChildren();
  $('#memory-count').textContent = `${state.memories.length} / 30`;
  $('#memories-empty').hidden = state.memories.length > 0;
  for (const memory of state.memories) {
    const row = el('div', 'list-item');
    const remove = el('button', 'delete-item', '×'); remove.setAttribute('aria-label', `Delete memory: ${memory.text}`); remove.addEventListener('click', () => run(() => api.deleteMemory(memory.id)));
    row.append(el('span', 'memory-symbol', '◇'), el('span', 'item-text', memory.text), remove); list.append(row);
  }
}
function fillSettings() {
  if (!state) return;
  $('#setting-name').value = state.settings.name;
  $('#setting-model').value = state.settings.model;
  $('#setting-endpoint').value = state.settings.endpoint;
  $('#setting-voice').checked = state.settings.voice;
  $('#setting-top').checked = state.settings.alwaysOnTop;
  $('#setting-motion').checked = state.settings.reducedMotion;
}
async function testConnection() {
  $('#test-connection').disabled = true;
  $('#connection-result').textContent = 'Looking for your local model…';
  try {
    connection = await api.checkConnection();
    $('#connection-result').textContent = connection.message;
    $('#installed-models').replaceChildren(...connection.models.map(name => { const option = el('option'); option.value = name; return option; }));
    $('#connection-status span').textContent = connection.installed ? 'Local model ready' : 'Install a model';
    $('#connection-status').classList.toggle('connected', connection.installed);
  } catch (error) {
    connection = null;
    $('#connection-result').textContent = messageFrom(error);
    $('#connection-status span').textContent = 'Connect your model';
    $('#connection-status').classList.remove('connected');
  } finally {
    $('#test-connection').disabled = false;
    $('#character-state').textContent = state?.busy ? 'THINKING WITH YOU' : connection?.installed ? 'READY WHEN YOU ARE' : 'LET’S GET YOU CONNECTED';
  }
}
function speak(content) {
  if (!('speechSynthesis' in window)) return toast('System speech is unavailable on this computer.');
  window.speechSynthesis.cancel();
  const text = content.replace(/```[\s\S]*?```/g, ' Code example omitted. ').replace(/[#*_`]/g, '').slice(0, 12000);
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  for (const sentence of sentences) {
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = 'en-US'; utterance.rate = 1.03; utterance.pitch = 1.08;
    utterance.onerror = event => { if (!['interrupted', 'canceled'].includes(event.error)) toast('No system voice is available. Install a voice in your OS settings.'); };
    window.speechSynthesis.speak(utterance);
  }
}
async function confirmAction(title, copy) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title; $('#confirm-copy').textContent = copy; dialog.returnValue = 'cancel';
  return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.tab)));
document.querySelectorAll('[data-window]').forEach(button => button.addEventListener('click', () => run(() => api.windowAction(button.dataset.window))));
$('#brand-home').addEventListener('click', event => { event.preventDefault(); openTab('chat'); });
$('#connection-status').addEventListener('click', () => openTab('settings'));
$('#toggle-companion').addEventListener('click', () => run(() => api.windowAction('companion')));
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('#message-input').value = button.dataset.prompt; $('#message-input').focus(); $('#send-message').disabled = false; }));
$('#message-input').addEventListener('input', () => { $('#send-message').disabled = !$('#message-input').value.trim(); });
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!state?.busy) $('#chat-form').requestSubmit(); } });
$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const value = $('#message-input').value.trim(); if (!value || state.busy) return;
  $('#chat-error').hidden = true;
  window.speechSynthesis?.cancel();
  try { await api.send(value); $('#message-input').value = ''; $('#messages').scrollTop = $('#messages').scrollHeight; }
  catch (error) { $('#chat-error').textContent = messageFrom(error); $('#chat-error').hidden = false; }
});
$('#stop-reply').addEventListener('click', () => run(() => api.stop()));
$('#new-chat').addEventListener('click', () => run(async () => {
  if (await confirmAction('Clear this conversation?', 'Your tasks and memory notes will stay. The chat history will be removed.')) { window.speechSynthesis?.cancel(); streamed.clear(); await api.clearChat(); $('#chat-error').hidden = true; }
}));
$('#task-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await api.addTask($('#task-input').value); $('#task-input').value = ''; $('#task-input').focus(); }); });
$('#memory-form').addEventListener('submit', event => { event.preventDefault(); run(async () => { await api.addMemory($('#memory-input').value); $('#memory-input').value = ''; toast('Saved. I’ll use this context in future replies.'); }); });
$('#settings-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await api.saveSettings({ name: $('#setting-name').value, model: $('#setting-model').value, endpoint: $('#setting-endpoint').value, voice: $('#setting-voice').checked, alwaysOnTop: $('#setting-top').checked, reducedMotion: $('#setting-motion').checked });
  if (!state.settings.voice) window.speechSynthesis?.cancel();
  toast('Settings saved.'); await testConnection();
}); });
$('#test-connection').addEventListener('click', () => run(() => testConnection()));
$('#voice-toggle').addEventListener('click', () => run(async () => { await api.saveSettings({ ...state.settings, voice: !state.settings.voice }); if (!state.settings.voice) window.speechSynthesis?.cancel(); }));
$('#export-data').addEventListener('click', () => run(async () => { if (await api.exportData()) toast('Your data has been exported.'); }));
$('#open-data').addEventListener('click', () => run(() => api.openDataFolder()));
$('#clear-data').addEventListener('click', () => run(async () => {
  if (await confirmAction('Clear your personal data?', 'This removes all conversations, tasks, and memory notes from Meta-chan. Export a copy first if you want to keep them. Settings and any backup/export files are kept.')) { window.speechSynthesis?.cancel(); streamed.clear(); await api.clearData(); $('#chat-error').hidden = true; toast('Personal data cleared.'); }
}));

if (!api) {
  $('#connection-status span').textContent = 'Desktop app required';
  $('#chat-error').textContent = 'Open Meta-chan with npm start. This interface needs its Electron desktop runtime.';
  $('#chat-error').hidden = false;
  document.querySelectorAll('button,input,textarea').forEach(control => { control.disabled = true; });
} else {
  api.onState(applyState);
  api.onChat(event => {
    if (event.type === 'delta') {
      streamed.set(event.id, (streamed.get(event.id) || '') + event.token);
      if (!framePending) { framePending = true; requestAnimationFrame(() => { framePending = false; renderMessages(); }); }
    } else if (event.type === 'done') {
      streamed.set(event.id, event.content);
      if (event.error) { $('#chat-error').textContent = event.error; $('#chat-error').hidden = false; }
      if (event.status === 'complete' && state.settings.voice) speak(event.content);
    }
  });
  run(async () => { applyState(await api.getState()); fillSettings(); if (state.storageWarning) toast(state.storageWarning); await testConnection(); });
}
