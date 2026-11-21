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
  const member = await store.createMember({ name: 'João' });
  const project = await store.createProject({ name: 'GAVYO Auto' });
  const other = await store.createProject({ name: 'Outro projeto' });

  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(origin + path, {
      method, headers: { ...(body && { 'content-type': 'application/json' }), ...headers },
      body: body && JSON.stringify(body)
    });
    return { status: response.status, headers: response.headers, body: response.status === 304 ? null : await response.json() };
  };

  assert.equal((await request('/api/board')).status, 401);
  assert.equal((await request('/mcp')).status, 401);
  const profiles = await request('/api/profiles');
  assert.deepEqual(profiles.body, [{ id: member.id, name: member.name }]);
  const loginAs = (pin) => request('/api/login', { method: 'POST', body: { memberId: member.id, pin } });
  assert.equal((await loginAs('0123')).status, 401);
  const login = await loginAs('1234');
  const otherSession = await loginAs('1234');
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0] };
  const otherHeaders = { cookie: otherSession.headers.get('set-cookie').split(';')[0] };
  const changePin = (currentPin, newPin) => request('/api/pin',
    { method: 'POST', body: { currentPin, newPin }, headers });
  assert.equal((await changePin('0123', '0479')).status, 401);
  assert.equal((await changePin('1234', '1234')).status, 400);
  assert.equal((await changePin('1234', '0479')).status, 200);
  assert.equal((await request('/api/board', { headers: otherHeaders })).status, 401);
  assert.equal((await loginAs('1234')).status, 401);
  assert.equal((await loginAs('0479')).status, 200);
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
  assert.equal((await client.listTools()).tools.length, 10);

  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }

  // Contexto do projeto: o assistente lê e escreve; a tela vê quem mexeu e por qual canal.
  const context = await call('atualizar_contexto_projeto', { projectId: project.id, versaoLida: 0, objetivo: 'Publicar o quadro' });
  assert.equal(context.updated.source, 'Codex');
  assert.equal(context.version, 1);
  assert.equal(context.sectionBy.objetivo.readVersion, 0);
  assert.equal((await call('ver_contexto_projeto', { projectId: project.id })).objetivo, 'Publicar o quadro');
  const viaWeb = await request(`/api/projects/${project.id}/context`, { method: 'PUT', headers, body: { versaoLida: 1, regras: 'Sempre abrir PR.', producao: 'https://tarefas.gavyo.me' } });
  assert.equal(viaWeb.status, 200);
  assert.equal(viaWeb.body.version, 2);
  // Quem não leu a versão atual é recusado, e a tentativa fica no histórico.
  const stale = await request(`/api/projects/${project.id}/context`, { method: 'PUT', headers, body: { versaoLida: 1, regras: 'Apagar tudo' } });
  assert.equal(stale.status, 409);
  const iaAtrasada = await client.callTool({ name: 'atualizar_contexto_projeto', arguments: { projectId: project.id, versaoLida: 1, stack: 'x' } });
  assert.ok(iaAtrasada.isError && /versão 2/.test(iaAtrasada.content[0].text));
  const log = (await request(`/api/projects/${project.id}/context/history`, { headers })).body;
  assert.deepEqual(log.map((entry) => entry.kind).slice(0, 4), ['recusado', 'recusado', 'versao', 'versao']);
  assert.equal(log[2].by.source, 'Web');
  // Central de projetos: a leitura da IA fica marcada; a conversa aceita pessoas e assistentes.
  await call('ver_contexto_projeto', { projectId: project.id });
  await call('enviar_mensagem_projeto', { projectId: project.id, text: 'Li o contexto e subi o ajuste.', ref: { kind: 'contexto', id: 'x', label: 'v2' } });
  const conversa = await request(`/api/projects/${project.id}/messages`, { method: 'POST', headers, body: { text: 'Valeu!' } });
  assert.equal(conversa.status, 200);
  const mensagens = (await request(`/api/projects/${project.id}/messages`, { headers })).body;
  assert.deepEqual(mensagens.map((item) => item.source), ['Codex', 'Web']);
  const atividade = (await request(`/api/projects/${project.id}/activity`, { headers })).body;
  assert.ok(atividade.items.some((item) => item.kind === 'contexto' && item.rejected));
  assert.ok(!(await request(`/api/projects/${project.id}/context/history`, { headers })).body.some((item) => item.kind === 'leitura'));
  const voltou = await request(`/api/projects/${project.id}/context/restore/1`, { method: 'POST', headers, body: { versaoLida: 2 } });
  assert.equal(voltou.body.regras, '');
  assert.equal(voltou.body.version, 3);
  assert.equal(viaWeb.body.objetivo, 'Publicar o quadro');
  assert.equal(viaWeb.body.updated.source, 'Web');
  assert.equal((await request(`/api/projects/${project.id}/context`, { method: 'PUT', headers, body: { versaoLida: 3, links: [{ title: 'x', url: 'javascript:alert(1)' }] } })).status, 400);

  const initialBoard = await request('/api/board', { headers });
  const unchangedBoard = () => request('/api/board', {
    headers: { ...headers, 'If-None-Match': initialBoard.headers.get('etag') }
  });
  assert.equal((await unchangedBoard()).status, 304);

  const task = await call('criar_tarefa', {
    title: 'Revisar preços', projectId: project.id, assigneeId: member.id, priority: 'alta', due: '2026-11-27'
  });
  const second = await call('criar_tarefa', { title: 'Outra entrega', projectId: other.id, assigneeId: member.id });
  assert.equal((await call('listar_tarefas', { minhas: true })).length, 2);
  const moved = await call('atualizar_tarefa', { id: task.id, status: 'doing', comment: 'Revisão iniciada.' });
  assert.equal(moved.priority, 'alta');
  assert.equal(moved.assigneeId, member.id);
  assert.equal(moved.due, '2026-11-27');

  const updatedBoard = await unchangedBoard();
  assert.equal(updatedBoard.status, 200);
  assert.notEqual(updatedBoard.headers.get('etag'), initialBoard.headers.get('etag'));
  const board = updatedBoard.body;
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


test('perfis antigos passam a usar PIN padrão e tentativas são limitadas por perfil', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const id = 'c916b557-02b8-4be3-8323-0ddcac0417ed';
  await database.query('INSERT INTO members (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
    [id, 'legado@example.test', 'Legado', 'hashed-password', 'member']);
  const login = (pin) => fetch(`http://127.0.0.1:${server.address().port}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: id, pin })
  });
  assert.equal((await login('1234')).status, 200);
  for (let i = 0; i < 8; i++) assert.equal((await login('4321')).status, 401);
  assert.equal((await login('1234')).status, 429);
});

test('prints do cartão: só imagem de verdade, só para quem entrou, e somem do disco ao tirar', async (t) => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const uploads = await mkdtemp(join(tmpdir(), 'gavyo-prints-'));
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store, { uploads }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const member = await store.createMember({ name: 'Bola' });
  const project = await store.createProject({ name: 'GAVYO Auto' });
  const login = await fetch(origin + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: member.id, pin: '1234' })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const card = await store.createCard({ projectId: project.id, title: 'Tela com erro' }, { ...member, source: 'Web' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const send = (body, type = 'image/png', headers = { cookie }) =>
    fetch(`${origin}/api/cards/${card.id}/attachments`, { method: 'POST', headers: { 'content-type': type, ...headers }, body });

  assert.equal((await send(png, 'image/png', {})).status, 401);
  assert.equal((await send(Buffer.from('<script>alert(1)</script>'))).status, 400);
  const added = await send(png);
  assert.equal(added.status, 201);
  const saved = await added.json();
  assert.equal(saved.attachments.length, 1);
  assert.equal(saved.history.at(-1).action, 'Print');
  const [attachment] = saved.attachments;

  const file = await fetch(`${origin}/api/files/${card.id}/${attachment.file}`, { headers: { cookie } });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  assert.equal((await fetch(`${origin}/api/files/${card.id}/${attachment.file}`)).status, 401);

  const removed = await fetch(`${origin}/api/cards/${card.id}/attachments/${attachment.id}`, {
    method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).attachments.length, 0);
  assert.deepEqual(await readdir(join(uploads, card.id)), []);
});

test('fundo do quadro: cada pessoa escolhe o seu e só ela vê a própria imagem', async (t) => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store, { uploads: await mkdtemp(join(tmpdir(), 'gavyo-fundos-')) }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const enter = async (name) => {
    const member = await store.createMember({ name });
    const r = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: member.id, pin: '1234' }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const felipe = await enter('Felipe');
  const bola = await enter('Bola');
  const put = (cookie, background) => fetch(origin + '/api/preferences', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ background }) });
  assert.equal((await (await fetch(origin + '/api/board', { headers: { cookie: felipe } })).json()).preferences.background, 'noite');
  assert.equal((await put(felipe, 'couro')).status, 200);
  assert.equal((await put(felipe, 'imagem')).status, 400);
  assert.equal((await put(felipe, 'neon')).status, 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const sent = await fetch(origin + '/api/preferences/background', { method: 'POST', headers: { cookie: felipe, 'content-type': 'image/png' }, body: png });
  assert.equal(sent.status, 201);
  const prefs = await sent.json();
  assert.equal(prefs.background, 'imagem');
  assert.equal((await fetch(`${origin}/api/backgrounds/${prefs.backgroundFile}`, { headers: { cookie: felipe } })).status, 200);
  assert.equal((await fetch(`${origin}/api/backgrounds/${prefs.backgroundFile}`, { headers: { cookie: bola } })).status, 404);
  assert.equal((await (await fetch(origin + '/api/board', { headers: { cookie: bola } })).json()).preferences.background, 'noite');
});

test('cada cartão ganha um número do projeto (GA-1, GA-2) e cartões antigos são numerados na ordem', async () => {
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const member = await store.createMember({ name: 'Felipe' });
  const actor = { ...member, source: 'Web' };
  const project = await store.createProject({ name: 'GAVYO Auto' });
  const other = await store.createProject({ name: 'Site' });
  const first = await store.createCard({ projectId: project.id, title: 'Primeiro' }, actor);
  const second = await store.createCard({ projectId: project.id, title: 'Segundo' }, actor);
  const elsewhere = await store.createCard({ projectId: other.id, title: 'Outro projeto' }, actor);
  assert.equal(first.key, 'GA-1');
  assert.equal(second.key, 'GA-2');
  assert.equal(elsewhere.key, 'ST-1');
  // Cartão gravado antes dos números existirem.
  const legacy = { ...second, id: crypto.randomUUID(), title: 'Antigo', history: [{ ...second.history[0], at: new Date().toISOString() }] };
  delete legacy.number; delete legacy.key; delete legacy.version;
  await database.query('INSERT INTO cards (id, project_id, version, document) VALUES (?, ?, ?, ?)', [legacy.id, project.id, 1, JSON.stringify(legacy)]);
  const numbered = (await store.listCards()).find((card) => card.id === legacy.id);
  assert.equal(numbered.key, 'GA-3');
  await database.close();
});

test('presença: quem mandou sinal aparece como online, com a tela e o cartão que está vendo', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const enter = async (name) => {
    const member = await store.createMember({ name });
    const r = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberId: member.id, pin: '1234' }) });
    return { member, cookie: r.headers.get('set-cookie').split(';')[0] };
  };
  const felipe = await enter('Felipe');
  const bola = await enter('Bola');
  const ping = (who, body) => fetch(origin + '/api/presence', { method: 'POST', headers: { cookie: who.cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cardId = crypto.randomUUID();
  assert.equal((await ping(bola, { view: 'board', cardId })).status, 200);
  const list = await (await ping(felipe, { view: 'context' })).json();
  assert.deepEqual(list.map((item) => item.id).sort(), [felipe.member.id, bola.member.id].sort());
  assert.equal(list.find((item) => item.id === bola.member.id).cardId, cardId);
  assert.equal((await fetch(origin + '/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
});

test('webhook do GitHub: só aceita assinatura certa e o push entra na linha do tempo', async (t) => {
  const { createHmac } = await import('node:crypto');
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const server = createApp(store, { commits: async () => ({ commits: [], note: '' }) }).listen(0, '127.0.0.1');
  const previous = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = 'segredo-de-teste';
  t.after(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = previous;
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const member = await store.createMember({ name: 'João' });
  const project = await store.createProject({ name: 'GAVYO Auto' });
  await store.setProjectContext(project.id, { versaoLida: 0, repositorio: 'GAVVYO/gavyo-tarefas', branch: 'main' }, { ...member, source: 'Web' });
  const body = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'GAVVYO/gavyo-tarefas' }, sender: { login: 'felipe' },
    commits: [{ id: 'a'.repeat(40), message: 'Primeiro commit', timestamp: new Date().toISOString(), url: 'https://github.com/x', author: { username: 'felipe' } }] });
  const send = (signature) => fetch(`${origin}/api/github/webhook`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': signature }, body });
  assert.equal((await send('sha256=errada')).status, 401);
  assert.equal((await send(`sha256=${createHmac('sha256', 'segredo-de-teste').update(body).digest('hex')}`)).status, 200);
  const events = await store.githubEvents('GAVVYO/gavyo-tarefas', 'main');
  assert.equal(events[0].message, 'Primeiro commit');
  const activity = await store.projectActivity(project.id, events);
  assert.ok(activity.some((item) => item.kind === 'commit' && item.short === 'aaaaaaa'));
});
