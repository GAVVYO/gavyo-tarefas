import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function openDatabase({ url = process.env.DATABASE_URL, path = '.data/tarefas.sqlite' } = {}) {
  if (process.env.NODE_ENV === 'production' && !url) {
    throw new Error('DATABASE_URL é obrigatória em produção.');
  }
  let query;
  let close;
  if (url) {
    const { createPool } = await import('mysql2/promise');
    const pool = createPool({ uri: url, connectionLimit: 4, charset: 'utf8mb4' });
    query = async (sql, args = []) => (await pool.execute(sql, args))[0];
    close = () => pool.end();
  } else {
    const { DatabaseSync } = await import('node:sqlite');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON');
    query = async (sql, args = []) => {
      const statement = db.prepare(sql);
      if (/^SELECT/i.test(sql)) return statement.all(...args);
      return { affectedRows: statement.run(...args).changes };
    };
    close = () => db.close();
  }
  const definitions = [
    'members (id VARCHAR(36) PRIMARY KEY, email VARCHAR(254) UNIQUE NOT NULL, name VARCHAR(100) NOT NULL, password VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL)',
    'projects (id VARCHAR(36) PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL)',
    'cards (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL, version INTEGER NOT NULL, document MEDIUMTEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id))',
    'credentials (digest VARCHAR(64) PRIMARY KEY, member_id VARCHAR(36) NOT NULL, source VARCHAR(20) NOT NULL, expires BIGINT NOT NULL, FOREIGN KEY (member_id) REFERENCES members(id))',
    // Preferências de cada pessoa (fundo do quadro).
    'preferences (member_id VARCHAR(36) PRIMARY KEY, data TEXT NOT NULL, FOREIGN KEY (member_id) REFERENCES members(id))',
    // Contexto de cada projeto: o que é, objetivo, regras, stack e links (as IAs leem pelo MCP).
    'project_context (project_id VARCHAR(36) PRIMARY KEY, data MEDIUMTEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id))',
    // Versões do contexto (e tentativas recusadas): quem, por qual canal, quando e qual versão leu antes.
    'context_history (id VARCHAR(36) PRIMARY KEY, project_id VARCHAR(36) NOT NULL, at BIGINT NOT NULL, data MEDIUMTEXT NOT NULL, FOREIGN KEY (project_id) REFERENCES projects(id))'
  ];
  for (const definition of definitions) await query(`CREATE TABLE IF NOT EXISTS ${definition}`);
  return { query, close };
}
