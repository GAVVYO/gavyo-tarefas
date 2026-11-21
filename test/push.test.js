import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createPush } from '../src/push.js';

const sub = (n) => ({ endpoint: `https://push.example.com/${n}`, keys: { p256dh: 'p' + n, auth: 'a' + n } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function setup() {
  const database = await openDatabase({ path: ':memory:' });
  const store = createStore(database);
  const sent = [];
  const gone = new Set();
  const push = createPush({ query: database.query, store, send: async (subscription, body) => {
    if (gone.has(subscription.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ to: subscription.endpoint, ...JSON.parse(body) });
  } });
  store.onEvent((event) => (event.type === 'team' ? push.teamMessage(event.message) : push.cardComment(event.card, event.comment, event.actor)));
  const ana = await store.createMember({ name: 'Ana Souza' });
  const bia = await store.createMember({ name: 'Bia' });
  const caio = await store.createMember({ name: 'Caio' });
  await push.subscribe(ana.id, sub('ana'));
  await push.subscribe(bia.id, sub('bia'));
  await push.subscribe(caio.id, sub('caio'));
  return { database, store, push, sent, gone, ana, bia, caio };
}

test('chat global avisa todos menos quem escreveu', async (t) => {
  const { database, store, sent, ana } = await setup();
  t.after(() => database.close());
  await store.addTeamMessage({ text: 'reunião às 15h', clientId: crypto.randomUUID() }, { ...ana, source: 'Web' });
  await settle();
  assert.deepEqual(sent.map((item) => item.to).sort(), ['https://push.example.com/bia', 'https://push.example.com/caio']);
  assert.equal(sent[0].url, '/?chat=1');
  assert.match(sent[0].title, /Ana Souza/);
});

test('comentário de cartão avisa responsável, quem conversou e quem foi citado; nunca o autor', async (t) => {
  const { database, store, sent, ana, bia, caio } = await setup();
  t.after(() => database.close());
  const project = await store.createProject({ name: 'Projeto' });
  const card = await store.createCard({ projectId: project.id, title: 'Tela', assigneeId: bia.id }, { ...ana, source: 'Web' });
  await store.updateCard(card.id, { comment: 'começando' }, { ...ana, source: 'Web' });
  await settle();
  assert.deepEqual(sent.map((item) => item.to), ['https://push.example.com/bia']);
  sent.length = 0;
  await store.updateCard(card.id, { comment: 'caio, consegue ver?' }, { ...bia, source: 'Web' });
  await settle();
  assert.deepEqual(sent.map((item) => item.to).sort(), ['https://push.example.com/ana', 'https://push.example.com/caio']);
  assert.equal(sent[0].url, `/?card=${card.id}`);
  void caio;
});

test('aparelho revogado (410) sai da lista', async (t) => {
  const { database, push, gone, sent, ana, bia } = await setup();
  t.after(() => database.close());
  gone.add('https://push.example.com/bia');
  assert.equal(await push.sendTo([bia.id], { title: 'x' }), 0);
  gone.clear();
  assert.equal(await push.sendTo([bia.id], { title: 'x' }), 0);
  assert.equal(await push.sendTo([ana.id], { title: 'x' }), 1);
  assert.equal(sent.length, 1);
});

test('chaves VAPID são criadas uma vez e reaproveitadas', async (t) => {
  const { database, push, store } = await setup();
  t.after(() => database.close());
  const first = await push.keys();
  const again = await createPush({ query: database.query, store }).keys();
  assert.equal(first.publicKey, again.publicKey);
});
