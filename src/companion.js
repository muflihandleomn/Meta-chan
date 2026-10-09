'use strict';
const api = window.metaChan;
function update(state) {
  document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
  const last = state.messages.filter(message => message.role === 'assistant' && message.content && message.status === 'complete').at(-1);
  document.querySelector('#bubble').textContent = state.busy ? 'Thinking with you…' : last ? last.content.slice(0, 110) + (last.content.length > 110 ? '…' : '') : 'Hey. What are we working on?';
}
document.querySelector('#hide').addEventListener('click', () => api.windowAction('companion'));
for (const id of ['#open', '#bubble']) document.querySelector(id).addEventListener('click', () => api.windowAction('open'));
api.onState(update);
api.getState().then(update);
