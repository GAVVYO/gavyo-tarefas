import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

test('criações simultâneas em duas instâncias reservam números diferentes por projeto', async (t) => {
  const database = await openDatabase({ path: ':memory:' });
  t.after(() => database.close());
  const store = createStore(database);
  const other = createStore(database);
  const member = await store.createMember({ name: 'João' });
  const actor = { ...member, source: 'Codex' };
  const project = await store.createProject({ name: 'Projeto' });
  const anotherProject = await store.createProject({ name: 'Outro Projeto' });
  const legacyId = randomUUID();
  await database.query('INSERT INTO cards (id, project_id, version, document) VALUES (?, ?, ?, ?)', [
    legacyId, project.id, 1, JSON.stringify({
      id: legacyId, projectId: project.id, title: 'Primeiro', archived: false,
      history: [{ at: '2026-11-21T10:00:00Z' }]
    })
  ]);
  const created = await Promise.all([
    store.createCard({ projectId: project.id, title: 'Segundo' }, actor),
    other.createCard({ projectId: project.id, title: 'Terceiro' }, actor),
    store.createCard({ projectId: anotherProject.id, title: 'Outro' }, actor)
  ]);
  assert.deepEqual(created.slice(0, 2).map((card) => card.number).sort((a, b) => a - b), [2, 3]);
  assert.equal(created[2].number, 1);
  assert.equal((await store.listCards({ projectId: project.id })).find((card) => card.id === legacyId).number, 1);
});
