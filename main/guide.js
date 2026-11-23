// Toolkit Guide: the same ChatBaser agent and knowledge base as the Scale Plus dashboard's
// Video Toolkit guide. The ChatBaser key never ships in this open-source app; the request goes
// to a Scale Plus route that holds the key and limits how often each computer can ask.
// It runs here in the main process (Node fetch), so the page needs no network access.

const GUIDE_URL = process.env.SVE_GUIDE_URL || 'https://app.scaleplus.gg/api/public/video-editor/guide';
const MESSAGE_MAX = 4000;
const TURN_MAX = 8000;
const HISTORY_MAX = 20;

function clean({ message, conversation, format }) {
  const text = String(message || '').trim();
  if (!text || text.length > MESSAGE_MAX) return { error: `Write a message of ${MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.` };
  const history = (Array.isArray(conversation) ? conversation : []).slice(-HISTORY_MAX)
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .map(t => ({ role: t.role, content: t.content.trim().slice(0, TURN_MAX) }));
  return { body: { message: text, conversation: history, format: format ? String(format).slice(0, 120) : undefined } };
}

async function ask(payload, version) {
  const c = clean(payload || {});
  if (c.error) return { error: c.error };
  try {
    const res = await fetch(GUIDE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `ScaleVideoEditor/${version}` },
      body: JSON.stringify(c.body),
      signal: AbortSignal.timeout(75_000)
    });
    const data = await res.json().catch(() => null);
    if (res.status === 404) return { error: 'The Toolkit Guide is not switched on yet. Please check back soon.' };
    if (!res.ok || !data || typeof data.answer !== 'string' || !data.answer.trim()) {
      return { error: (data && typeof data.error === 'string' && data.error) || 'The Toolkit Guide could not answer right now. Please try again.' };
    }
    return { answer: data.answer, escalate: data.shouldEscalate === true };
  } catch (err) {
    return { error: err && err.name === 'TimeoutError' ? 'The Toolkit Guide took too long to answer. Please try again.' : 'The Toolkit Guide could not be reached. Check your internet connection and try again.' };
  }
}

module.exports = { ask, clean, GUIDE_URL };
