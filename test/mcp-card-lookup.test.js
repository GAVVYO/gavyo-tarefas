import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('ver_tarefa consulta somente o cartão pelo ID, inclusive no arquivo', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const cardQueries = [];
  const store = createStore({ query: (sql, args) => {
    if (/SELECT.*FROM cards/.test(sql)) cardQueries.push({ sql, args });
    return database.query(sql, args);
  } });
  const member = await store.createMember({ name: 'João' });
  const actor = { ...member, source: 'Codex' };
  const project = await store.createProject({ name: 'Projeto' });
  const active = await store.createCard({ projectId: project.id, title: 'Ativa' }, actor);
  const archived = await store.createCard({ projectId: project.id, title: 'Arquivada' }, actor);
  await store.updateCard(archived.id, { status: 'done', archived: true, comment: 'Conferido' }, actor);
  const { token } = await store.issue(member.id, 'Codex', 1);
  const server = createApp(store).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }));

  const call = (id) => client.callTool({ name: 'ver_tarefa', arguments: { id } });
  const missing = randomUUID();
  cardQueries.length = 0;
  const activeResult = await call(active.id);
  assert.equal(JSON.parse(activeResult.content[0].text).title, 'Ativa');
  const archivedResult = await call(archived.id);
  const task = JSON.parse(archivedResult.content[0].text);
  assert.equal(task.archived, true);
  assert.equal(task.comments[0].text, 'Conferido');
  assert.equal((await call(missing)).isError, true);
  assert.equal(cardQueries.length, 3);
  assert.deepEqual(cardQueries.map(({ sql, args }) => [sql.includes('WHERE id = ?'), args]), [
    [true, [active.id]], [true, [archived.id]], [true, [missing]]
  ]);
});
