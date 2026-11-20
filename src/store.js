import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const derive = promisify(scrypt);
const digest = (token) => createHash('sha256').update(token).digest('hex');
const date = z.iso.date();
const text = (max) => z.string().trim().min(1).max(max);
export const status = z.enum(['todo', 'doing', 'done']);
export const priority = z.enum(['alta', 'normal', 'baixa']);
const cardFields = {
  title: text(160), description: z.string().max(8000),
  assigneeId: z.uuid().nullable(), due: date.nullable(), priority
};
export const newCard = z.object({
  ...cardFields, projectId: z.uuid(), description: cardFields.description.default(''),
  assigneeId: cardFields.assigneeId.default(null), due: cardFields.due.default(null),
  priority: priority.default('normal')
});
export const patchCard = z.object(cardFields).partial().extend({
  status: status.optional(), blocked: z.string().trim().max(500).optional(),
  archived: z.boolean().optional(),
  checklist: z.array(z.object({ title: text(240), done: z.boolean() })).max(60).optional(),
  comment: text(2000).optional()
});
export const memberInput = z.object({
  name: text(100), email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200), role: z.enum(['admin', 'member']).default('member')
});
export const projectInput = z.object({ name: text(100) });
export const sources = z.enum(['Codex', 'Claude']);
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createStore({ query }) {
  const first = async (sql, args) => (await query(sql, args))[0];
  const member = (id) => first('SELECT id, name, email, role FROM members WHERE id = ?', [id]);
  const projects = () => query('SELECT id, name FROM projects ORDER BY name');
  const members = () => query('SELECT id, name, role FROM members ORDER BY name');
  const project = (id) => first('SELECT id, name FROM projects WHERE id = ?', [id]);

  async function createMember(input) {
    const { email, name, role, password } = memberInput.parse(input);
    const salt = randomBytes(16).toString('hex');
    const key = await derive(password, salt, 64);
    const id = randomUUID();
    await query('INSERT INTO members (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, email, name, `${salt}:${key.toString('hex')}`, role]);
    return { id, email, name, role };
  }

  async function login(email, password) {
    const account = await first('SELECT id, password FROM members WHERE email = ?', [email.toLowerCase()]);
    const [salt, encoded] = account?.password.split(':') ?? ['0'.repeat(32), '0'.repeat(128)];
    if (!timingSafeEqual(await derive(password, salt, 64), Buffer.from(encoded, 'hex')) || !account) {
      throw new AppError(401, 'E-mail ou senha incorretos.');
    }
    return issue(account.id, 'Web', 7);
  }

  async function issue(id, source, days) {
    const token = randomBytes(32).toString('base64url');
    const expires = Date.now() + days * 86400000;
    await query('INSERT INTO credentials (digest, member_id, source, expires) VALUES (?, ?, ?, ?)',
      [digest(token), id, source, expires]);
    return { token, expires };
  }

  async function revoke(token) {
    if (token) await query('DELETE FROM credentials WHERE digest = ?', [digest(token)]);
  }

  const tokens = (id) => query(
    "SELECT digest AS id, source, expires FROM credentials WHERE member_id = ? AND source <> 'Web' AND expires > ? ORDER BY expires DESC",
    [id, Date.now()]
  );

  async function revokeMcp(id, key) {
    const result = await query("DELETE FROM credentials WHERE digest = ? AND member_id = ? AND source <> 'Web'", [key, id]);
    if (!result.affectedRows) throw new AppError(404, 'Token não encontrado.');
  }

  async function identity(token, channel) {
    if (!token || !/^[\w-]{43}$/.test(token)) return null;
    const row = await first('SELECT member_id, source FROM credentials WHERE digest = ? AND expires > ?',
      [digest(token), Date.now()]);
    if (!row || (channel === 'Web') !== (row.source === 'Web')) return null;
    const account = await member(row.member_id);
    return account && { ...account, source: row.source };
  }

  async function createProject(input) {
    const { name } = projectInput.parse(input);
    const id = randomUUID();
    await query('INSERT INTO projects (id, name) VALUES (?, ?)', [id, name]);
    return { id, name };
  }

  function event(actor, action) {
    return { actor: actor.name, source: actor.source, action, at: new Date().toISOString() };
  }

  async function validateAssignee(id) {
    if (id && !(await member(id))) throw new AppError(400, 'Responsável inválido.');
  }

  async function createCard(input, actor) {
    const fields = newCard.parse(input);
    if (!(await project(fields.projectId))) throw new AppError(404, 'Projeto não encontrado.');
    await validateAssignee(fields.assigneeId);
    const card = {
      ...fields, id: randomUUID(), status: 'todo', blocked: '', archived: false, checklist: [],
      comments: [], history: [event(actor, 'Criou o cartão')]
    };
    await query('INSERT INTO cards (id, project_id, version, document) VALUES (?, ?, ?, ?)',
      [card.id, card.projectId, 1, JSON.stringify(card)]);
    return { ...card, version: 1 };
  }

  const decode = (row) => ({ ...JSON.parse(row.document), version: row.version });

  async function listCards({ projectId, assigneeId, archived = false, blocked = false } = {}) {
    const rows = projectId
      ? await query('SELECT version, document FROM cards WHERE project_id = ?', [projectId])
      : await query('SELECT version, document FROM cards');
    return rows.map(decode).filter((card) => card.archived === archived &&
      (!blocked || card.blocked) && (!assigneeId || card.assigneeId === assigneeId))
      .sort((a, b) => b.history[0].at.localeCompare(a.history[0].at));
  }

  async function updateCard(id, input, actor, expectedVersion) {
    const { comment, ...patch } = patchCard.parse(input);
    await validateAssignee(patch.assigneeId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await first('SELECT version, document FROM cards WHERE id = ?', [id]);
      if (!row) throw new AppError(404, 'Cartão não encontrado.');
      const { version, ...current } = decode(row);
      if (expectedVersion != null && version !== expectedVersion) break;
      const changes = Object.entries(patch).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(current[key]));
      if (!changes.length && !comment) return { ...current, version };
      const updated = { ...current, ...Object.fromEntries(changes) };
      if (updated.archived && updated.status !== 'done') {
        throw new AppError(400, 'Conclua o cartão antes de arquivar ou restaure-o para mudar de coluna.');
      }
      const labels = {
        title: 'Título', description: 'Descrição', assigneeId: 'Responsável', due: 'Prazo',
        priority: 'Prioridade', status: 'Etapa', blocked: 'Bloqueio', archived: 'Arquivo',
        checklist: 'Checklist'
      };
      const actions = changes.map(([key]) => labels[key]);
      if (comment) {
        updated.comments.push({ ...event(actor, 'Comentou'), text: comment });
        actions.push('Comentário');
      }
      updated.history.push(event(actor, actions.join(', ')));
      const result = await query('UPDATE cards SET document = ?, version = ? WHERE id = ? AND version = ?',
        [JSON.stringify(updated), version + 1, id, version]);
      if (result.affectedRows === 1) return { ...updated, version: version + 1 };
    }
    throw new AppError(409, 'O cartão mudou. Atualize o quadro e tente novamente.');
  }

  return { createMember, login, issue, revoke, tokens, revokeMcp, identity, projects, members, createProject, createCard, listCards, updateCard };
}
