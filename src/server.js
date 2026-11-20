import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { createApp } from './app.js';
import { setupWorkspace } from './bootstrap.js';

// Hostinger's launcher loads this module with require(), which needs a synchronous module graph.
async function start() {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.PUBLIC_ORIGIN || '';
  if (production && (!origin.startsWith('https://') || new URL(origin).origin !== origin)) {
    throw new Error('Defina PUBLIC_ORIGIN como a origem HTTPS do quadro sem barra final.');
  }

  const database = await openDatabase();
  const store = createStore(database);
  if (production && process.env.ADMIN_NAME) await setupWorkspace(store, process.env, { onlyWhenEmpty: true });
  const app = createApp(store, { production, origin });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`GAVYO Tarefas na porta ${port}`));
}

void start().catch((error) => {
  console.error(error);
  process.exit(1);
});
