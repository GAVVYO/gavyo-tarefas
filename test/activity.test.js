import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('atividade Web e MCP mantém eventos do webhook e ordena por instante', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const store = createStore(database);
  const member = await store.createMember({ name: 'João' });
  const project = await store.createProject({ name: 'Projeto' });
  const repo = 'example/activity-test';
  await store.setProjectContext(project.id, { repositorio: repo, branch: 'main', versaoLida: 0 }, { ...member, source: 'Web' });
  const old = { sha: 'a'.repeat(40), at: '2026-11-21T15:00:00-03:00', message: 'Pelo webhook' };
  const recent = { sha: 'b'.repeat(40), at: '2026-11-21T16:00:00-03:00', message: 'Pela API' };
  await store.saveGithubEvent('push', { repository: { full_name: repo }, ref: 'refs/heads/main',
    commits: [{ id: old.sha, timestamp: old.at, message: old.message }] });
  await store.saveGithubEvent('pull_request', { repository: { full_name: repo }, action: 'opened',
    pull_request: { number: 1, updated_at: '2026-11-21T18:30:00Z', title: 'PR' } });

  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, options) => String(url).startsWith('https://api.github.com/')
    ? Promise.resolve(Response.json([old, recent].map(({ sha, at, message }) => ({ sha, commit: { message, author: { date: at } } }))))
    : originalFetch(url, options));
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;

  const web = await store.issue(member.id, 'Web', 1);
  const response = await fetch(`${origin}/api/projects/${project.id}/activity`, { headers: { cookie: `gavyo_session=${web.token}` } });
  assert.equal(response.status, 200);
  const { items } = await response.json();

  const mcp = await store.issue(member.id, 'Codex', 1);
  const client = new Client({ name: 'teste', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: { authorization: `Bearer ${mcp.token}` } }
  }));
  const result = await client.callTool({ name: 'atividade_projeto', arguments: { projectId: project.id } });
  assert.ok(!result.isError);
  const { itens } = JSON.parse(result.content[0].text);
  const ids = [`commit:${recent.sha}`, 'pr:1:abriu', `commit:${old.sha}`];
  assert.deepEqual({ web: items.map((item) => item.id), mcp: itens.map((item) => item.id) }, { web: ids, mcp: ids });
});
