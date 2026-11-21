import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createApp } from '../src/app.js';

test('GT-15: equipe autenticada envia e pagina o chat sem perder mensagens simultâneas', async (t) => {
  const db = await openDatabase({ path: ':memory:' });
  const store = createStore(db);
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); await db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, cookie, body, extra = {}) {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function session(name) {
    const member = await store.createMember({ name });
    const login = await request('/api/login', null, { memberId: member.id, pin: '1234' });
    return { member, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  const a = await session('Pessoa A');
  const b = await session('Pessoa B');
  assert.equal((await request('/api/team/messages')).status, 401);
  assert.equal((await request('/api/team/messages', null, { text: 'Anônimo', clientId: randomUUID() })).status, 401);
  assert.deepEqual((await request('/api/team/messages', a.cookie)).body.messages, []);
  const payload = { text: '  Olá, equipe!  ', clientId: randomUUID() };
  const sent = await request('/api/team/messages', a.cookie, payload);
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.author, { id: a.member.id, name: a.member.name });
  assert.equal(sent.body.text, 'Olá, equipe!');
  assert.ok(Number.isFinite(Date.parse(sent.body.at)));
  assert.equal((await request('/api/team/messages', b.cookie)).body.messages[0].id, sent.body.id);
  // Uma resposta perdida pode ser reenviada sem duplicar a mensagem.
  assert.equal((await request('/api/team/messages', a.cookie, payload)).body.id, sent.body.id);
  assert.equal((await request('/api/team/messages', b.cookie, payload)).status, 409);
  assert.equal((await request('/api/team/messages', a.cookie, { ...payload, text: 'Alterado' })).status, 409);
  assert.equal((await request('/api/team/messages', a.cookie, { text: '', clientId: randomUUID() })).status, 400);
  assert.equal((await request('/api/team/messages', a.cookie, { text: 'x'.repeat(4001), clientId: randomUUID() })).status, 400);
  assert.equal((await request('/api/team/messages', a.cookie, { text: 'x', clientId: randomUUID(), author: 'Forjado' })).status, 400);
  assert.equal((await request('/api/team/messages', a.cookie, { text: 'x', clientId: randomUUID() }, { origin: 'https://outro.invalid' })).status, 403);
  const batch = await Promise.all(Array.from({ length: 7 }, (_, i) => request('/api/team/messages', b.cookie, { text: `Mensagem ${i}`, clientId: randomUUID() })));
  assert.ok(batch.every(r => r.status === 201));
  const latest = await request('/api/team/messages?limit=3', a.cookie);
  assert.equal(latest.status, 200);
  assert.match(latest.headers.get('cache-control'), /no-store/);
  assert.equal(latest.body.messages.length, 3);
  assert.equal(latest.body.hasMore, true);
  const seen = [...latest.body.messages];
  let page = latest.body;
  while (page.hasMore) {
    page = (await request(`/api/team/messages?limit=3&before=${page.nextBefore}`, a.cookie)).body;
    seen.unshift(...page.messages);
  }
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen.map(m => m.id)).size, 8);
  assert.deepEqual(seen.map(m => m.sequence), [...seen.map(m => m.sequence)].sort((a, b) => a - b));
  const newer = (await request(`/api/team/messages?after=${sent.body.sequence}&limit=3`, a.cookie)).body;
  assert.equal(newer.messages.length, 3);
  assert.equal(newer.hasMore, true);
  assert.ok(newer.messages.every(m => m.sequence > sent.body.sequence));
  assert.equal(newer.nextAfter, newer.messages.at(-1).sequence);
  const caughtUp = (await request(`/api/team/messages?after=${seen.at(-1).sequence}`, b.cookie)).body;
  assert.deepEqual(caughtUp.messages, []);
  for (const query of ['limit=0', 'limit=101', 'after=-1', 'before=abc', 'before=1&after=2']) {
    assert.equal((await request(`/api/team/messages?${query}`, a.cookie)).status, 400, query);
  }
  // A conversa não mora no cache de um store nem depende do projeto selecionado.
  const reopenedStore = createStore(db);
  assert.equal((await reopenedStore.teamMessages({})).messages.length, 8);
  await request('/api/logout', a.cookie, {});
  assert.equal((await request('/api/team/messages', a.cookie)).status, 401);
});

test('GT-15: SSE entrega imediatamente, retoma cursor e encerra sessão revogada', async (t) => {
  const db = await openDatabase({ path: ':memory:' });
  const store = createStore(db);
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const abort = new AbortController();
  t.after(async () => { abort.abort(); server.closeAllConnections(); await new Promise(r => server.close(r)); await db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const member = await store.createMember({ name: 'Equipe SSE' });
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: member.id, pin: '1234' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin + '/api/team/messages/stream')).status, 401);
  assert.equal((await fetch(origin + '/api/team/messages/stream?after=bad', { headers: { cookie } })).status, 400);
  const first = await store.addTeamMessage({ text: 'Anterior', clientId: randomUUID() }, { ...member, source: 'Web' });
  const response = await fetch(origin + '/api/team/messages/stream?after=0', { headers: { cookie, 'Last-Event-ID': String(first.sequence) }, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  let buffer = '';
  async function until(check) {
    const deadline = setTimeout(() => abort.abort(), 3000);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return 'closed';
        buffer += new TextDecoder().decode(value);
        if (check(buffer)) return buffer;
      }
    } finally { clearTimeout(deadline); }
  }
  const sent = await fetch(origin + '/api/team/messages', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Em tempo real', clientId: randomUUID() }) });
  assert.equal(sent.status, 201);
  const pushed = await until(s => s.includes('Em tempo real'));
  assert.match(pushed, /event: messages/);
  assert.ok(!pushed.includes('Anterior'), 'Last-Event-ID deve prevalecer sobre a URL da reconexão');
  // Outro store/worker não partilha a assinatura em memória: o stream reconcilia pelo banco.
  await createStore(db).addTeamMessage({ text: 'Outro worker', clientId: randomUUID() }, { ...member, source: 'Web' });
  await until(s => s.includes('Outro worker'));
  await fetch(origin + '/api/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(await until(() => false), 'closed');
});
