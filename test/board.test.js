import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('a conta do navegador e o MCP compartilham os cartões e preservam a autoria', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const password = 'senha-ficticia-do-teste';
  const member = await store.createMember({ name: 'João', email: 'joao@example.com', password });
  const project = await store.createProject({ name: 'GAVYO Auto' });
  const other = await store.createProject({ name: 'Outro projeto' });

  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + path, {
      method, headers: { ...(body && { 'content-type': 'application/json' }), ...headers },
      body: body && JSON.stringify(body)
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };

  assert.equal((await request('/api/board')).status, 401);
  assert.equal((await request('/mcp')).status, 401);
  const login = await request('/api/login', { method: 'POST', body: { email: member.email, password } });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/api/projects', { method: 'POST', body: { name: 'Restrito' }, headers })).status, 403);
  assert.equal((await request('/api/tokens', { method: 'POST', body: { source: 'Codex' },
    headers: { ...headers, origin: 'https://example.com' } })).status, 403);

  const credential = await request('/api/tokens', { method: 'POST', body: { source: 'Codex' }, headers });
  assert.equal(credential.status, 201);
  assert.equal((await request('/api/board', {
    headers: { cookie: `gavyo_session=${credential.body.token}` }
  })).status, 401);
  const client = new Client({ name: 'teste', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: { authorization: `Bearer ${credential.body.token}` } }
  }));
  assert.equal((await client.listTools()).tools.length, 5);

  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }

  const task = await call('criar_tarefa', {
    title: 'Revisar preços', projectId: project.id, assigneeId: member.id, priority: 'alta', due: '2026-11-27'
  });
  const second = await call('criar_tarefa', { title: 'Outra entrega', projectId: other.id, assigneeId: member.id });
  assert.equal((await call('listar_tarefas', { minhas: true })).length, 2);
  const moved = await call('atualizar_tarefa', { id: task.id, status: 'doing', comment: 'Revisão iniciada.' });
  assert.equal(moved.priority, 'alta');
  assert.equal(moved.assigneeId, member.id);
  assert.equal(moved.due, '2026-11-27');

  const board = (await request('/api/board', { headers })).body;
  const visible = board.cards.find((card) => card.id === task.id);
  assert.equal(visible.status, 'doing');
  assert.equal(visible.history.at(-1).source, 'Codex');
  assert.equal(visible.history.at(-1).actor, 'João');
  assert.equal(visible.comments[0].text, 'Revisão iniciada.');

  const patch = (body) => request(`/api/cards/${task.id}`, { method: 'PATCH', body, headers });
  assert.equal((await patch({ version: task.version, blocked: 'Aguardando aprovação' })).status, 409);
  const blocked = await patch({ version: visible.version, blocked: 'Aguardando aprovação',
    checklist: [{ title: 'Conferir orçamento', done: true }] });
  assert.equal(blocked.body.checklist[0].done, true);
  assert.equal((await call('listar_tarefas', { blocked: true })).length, 1);
  assert.equal((await patch({ version: blocked.body.version, archived: true })).status, 400);
  assert.equal((await patch({ version: blocked.body.version, status: 'done', archived: true })).status, 200);
  assert.equal((await call('listar_tarefas', { archived: true }))[0].id, task.id);
  assert.equal((await call('listar_tarefas', {}))[0].id, second.id);

  assert.equal((await request('/api/logout', { method: 'POST', body: {}, headers })).status, 200);
  assert.equal((await request('/api/board', { headers })).status, 401);
  await client.close();
});
