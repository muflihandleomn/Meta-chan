const { validateEndpoint } = require('./core.cjs');

async function* ndjson(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1024 * 1024) throw new Error('Ollama sent an oversized response.');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer);
}

async function checkConnection(settings, fetcher = fetch) {
  const base = validateEndpoint(settings.endpoint);
  let response;
  try { response = await fetcher(`${base}/api/tags`, { signal: AbortSignal.timeout(8000), redirect: 'error' }); }
  catch { throw new Error('Ollama is offline. Start Ollama, then test the connection again.'); }
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Check its address.`);
  const data = await response.json();
  const models = (Array.isArray(data.models) ? data.models : []).map(m => m.name).filter(n => typeof n === 'string');
  const installed = models.includes(settings.model) || (!settings.model.includes(':') && models.includes(`${settings.model}:latest`));
  return { connected: true, installed, models, message: installed ? 'Connected. Meta-chan is ready.' : `Model not installed. Run: ollama pull ${settings.model}` };
}

async function streamChat(settings, messages, signal, onToken, fetcher = fetch) {
  const base = validateEndpoint(settings.endpoint);
  let response;
  try {
    response = await fetcher(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error',
      body: JSON.stringify({ model: settings.model, messages, stream: true, keep_alive: '5m', options: { temperature: 0.7, num_predict: 2048 } }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Cannot reach Ollama. Start Ollama and check Settings → Test connection.');
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Model not found. Install it with: ollama pull ${settings.model}`);
    throw new Error(`Ollama returned HTTP ${response.status}. Check the model and Ollama logs.`);
  }
  if (!response.body) throw new Error('Ollama returned an empty response.');
  let length = 0;
  let done = false;
  for await (const frame of ndjson(response.body)) {
    if (frame.error) throw new Error(String(frame.error).slice(0, 300));
    if (typeof frame.message?.content === 'string') {
      length += frame.message.content.length;
      if (length > 64000) throw new Error('The reply exceeded the output limit. Ask for a shorter answer.');
      onToken(frame.message.content);
    }
    if (frame.done) { done = true; break; }
  }
  if (!done) throw new Error('Ollama disconnected before finishing the reply. Try again.');
  if (length === 0) throw new Error('The model returned no text. Try another prompt or model.');
}

module.exports = { ndjson, checkConnection, streamChat };
