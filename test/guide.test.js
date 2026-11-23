const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

function serve(handler) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => handler(req, JSON.parse(body || '{}'), res));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('the guide sends the bounded conversation and returns the answer', async () => {
  let seen;
  const server = await serve((req, body, res) => {
    seen = { ua: req.headers['user-agent'], body };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ answer: 'Try a Short.', shouldEscalate: false }));
  });
  process.env.SVE_GUIDE_URL = `http://127.0.0.1:${server.address().port}/guide`;
  delete require.cache[require.resolve('../main/guide')];
  const guide = require('../main/guide');
  const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i }));
  const res = await guide.ask({ message: '  What should I make?  ', conversation: [...turns, { role: 'system', content: 'x' }], format: 'Reel' }, '0.1.0');
  server.close();
  assert.deepEqual(res, { answer: 'Try a Short.', escalate: false });
  assert.equal(seen.ua, 'ScaleVideoEditor/0.1.0');
  assert.equal(seen.body.message, 'What should I make?');
  assert.equal(seen.body.conversation.length, 19);
  assert.equal(seen.body.format, 'Reel');
});

test('the guide passes on the server error and refuses empty messages', async () => {
  const server = await serve((req, body, res) => { res.statusCode = 429; res.end(JSON.stringify({ error: 'Busy. Wait a moment.' })); });
  process.env.SVE_GUIDE_URL = `http://127.0.0.1:${server.address().port}/guide`;
  delete require.cache[require.resolve('../main/guide')];
  const guide = require('../main/guide');
  assert.deepEqual(await guide.ask({ message: 'hi' }, '0.1.0'), { error: 'Busy. Wait a moment.' });
  assert.ok((await guide.ask({ message: '   ' }, '0.1.0')).error);
  server.close();
});
