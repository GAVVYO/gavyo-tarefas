import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { setupWorkspace } from './bootstrap.js';

const db = await openDatabase();
try {
  await setupWorkspace(createStore(db));
  console.log('Configuração inicial conferida.');
} finally {
  await db.close();
}
