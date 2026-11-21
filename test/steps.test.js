import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

async function setup(t) {
  const db = await openDatabase({ path: ':memory:' });
  t.after(() => db.close());
  const store = createStore(db);
  const member = await store.createMember({ name: 'João' });
  const actor = { ...member, source: 'Codex' };
  const project = await store.createProject({ name: 'Projeto' });
  const card = await store.createCard({ projectId: project.id, title: 'Rodada' }, actor);
  return { db, store, actor, card };
}

test('passos legados expõem IDs estáveis e a próxima gravação os persiste', async (t) => {
  const { db, store, actor, card } = await setup(t);
  const { version, ...document } = card;
  document.checklist = [{ title: 'Igual', done: false }, { title: 'Igual', done: true }];
  await db.query('UPDATE cards SET document = ? WHERE id = ?', [JSON.stringify(document), card.id]);

  const [read] = await store.listCards({});
  const [reread] = await createStore(db).listCards({});
  assert.deepEqual(read.checklist, reread.checklist);
  assert.ok(read.checklist.every(({ id, details, pr }) => id && details === '' && pr === ''));
  assert.notEqual(read.checklist[0].id, read.checklist[1].id);
  const saved = await store.updateCard(card.id, { comment: 'Gravação' }, actor);
  const [row] = await db.query('SELECT document FROM cards WHERE id = ?', [card.id]);
  assert.deepEqual(saved.checklist, read.checklist);
  assert.deepEqual(JSON.parse(row.document).checklist, read.checklist);
});

test('edições simultâneas por passo preservam as mudanças dos outros passos', async (t) => {
  const { db, store, actor, card } = await setup(t);
  const other = createStore(db);
  const first = await store.addStep(card.id, { title: 'Um', details: 'Reprodução' }, actor);
  const second = await store.addStep(card.id, { title: 'Dois', pr: 'https://example.com/pull/2' }, actor);
  const [a, b] = second.checklist;
  await Promise.all([
    store.updateStep(card.id, a.id, { done: true }, actor),
    other.updateStep(card.id, b.id, { title: 'Dois corrigido' }, actor)
  ]);
  await assert.rejects(store.removeStep(card.id, b.id, actor, first.version), { status: 409 });
  const [current] = await store.listCards({});
  const replaced = await store.updateCard(card.id, { checklist: [{ id: b.id, title: 'Dois revisado', done: true },
    { title: 'Novo', done: false }, { id: a.id, title: 'Um' }] }, actor, current.version);
  assert.deepEqual(replaced.checklist[0], { ...b, title: 'Dois revisado', done: true });
  assert.ok(replaced.checklist[1].id);
  assert.deepEqual(replaced.checklist[2], { ...a, done: true });
  await assert.rejects(store.updateCard(card.id, { checklist: [{ id: a.id }, { id: a.id }] }, actor), { status: 400 });
  await assert.rejects(store.updateCard(card.id, { checklist: [{ title: 'Sem estado' }] }, actor), { name: 'ZodError' });
});

test('Web e MCP operam pelo ID do passo e devolvem o cartão completo', async (t) => {
  const { store, actor, card } = await setup(t);
  const server = createApp(store).listen(0, '127.0.0.1');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = await store.issue(actor.id, 'Web', 1);
  const credential = await store.issue(actor.id, 'Codex', 1);
  const path = `${origin}/api/cards/${card.id}/steps`;
  const web = (method, suffix, body) => fetch(path + suffix, {
    method, headers: { cookie: `gavyo_session=${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: { authorization: `Bearer ${credential.token}` } }
  }));
  const call = (name, args) => client.callTool({ name, arguments: args });
  const result = async (name, args) => {
    const response = await call(name, args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };

  const created = await web('POST', '', { title: 'Web', version: card.version });
  assert.equal(created.status, 201);
  const fromWeb = await created.json();
  const { id: webStep } = fromWeb.checklist[0];
  const fromMcp = await result('adicionar_passo', { id: card.id, title: 'MCP', details: 'Passos para reproduzir', version: fromWeb.version });
  const { id: mcpStep } = fromMcp.checklist[1];
  assert.equal((await web('PATCH', `/${webStep}`, { version: fromWeb.version, done: true })).status, 409);
  assert.equal((await call('atualizar_passo', { id: card.id, passoId: mcpStep, pr: 'ftp://example.com/1' })).isError, true);
  const edited = await result('atualizar_passo', { id: card.id, passoId: mcpStep, pr: 'https://example.com/1', done: true, version: fromMcp.version });
  const updated = await web('PATCH', `/${webStep}`, { version: edited.version, title: 'Web editado' });
  assert.equal(updated.status, 200);
  const changed = await updated.json();
  const removed = await result('remover_passo', { id: card.id, passoId: webStep, version: changed.version });
  assert.deepEqual((await result('ver_tarefa', { id: card.id })).checklist, [
    { id: mcpStep, title: 'MCP', details: 'Passos para reproduzir', pr: 'https://example.com/1', done: true }
  ]);
  assert.equal((await result('listar_tarefas', {}))[0].checklist, undefined);
  assert.deepEqual(removed.history.slice(-5).map(({ source, action }) => [source, action]), [
    ['Web', 'Adicionou passo'], ['Codex', 'Adicionou passo'], ['Codex', 'Editou passo'],
    ['Web', 'Editou passo'], ['Codex', 'Removeu passo']
  ]);
  const unchanged = await result('atualizar_passo', { id: card.id, passoId: mcpStep, done: true });
  assert.equal(unchanged.version, removed.version);
  assert.deepEqual(unchanged.history, removed.history);
  assert.equal((await web('DELETE', `/${mcpStep}`, {})).status, 200);
  assert.deepEqual((await result('ver_tarefa', { id: card.id })).checklist, []);
  const checklist = Array.from({ length: 60 }, (_, i) => ({
    title: `Passo ${i + 1}`, details: 'a'.repeat(4000), done: false
  }));
  const full = await result('atualizar_tarefa', { id: card.id, checklist });
  assert.equal(full.checklist.length, 60);
  assert.equal(full.checklist[59].details.length, 4000);
  assert.equal((await call('adicionar_passo', { id: card.id, title: 'Além do limite' })).isError, true);
  const savedList = await fetch(`${origin}/api/cards/${card.id}`, {
    method: 'PATCH', headers: { cookie: `gavyo_session=${session.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ version: full.version, checklist: full.checklist })
  });
  assert.equal(savedList.status, 200);
  assert.equal((await savedList.json()).version, full.version);
});
