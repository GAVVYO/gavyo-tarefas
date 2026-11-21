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
export const DEFAULT_PIN = '1234';
export const pinInput = z.string().regex(/^[0-9]{4}$/);
const memberInput = z.object({
  name: text(100), pin: pinInput.default(DEFAULT_PIN), role: z.enum(['admin', 'member']).default('member')
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
  const member = (id) => first('SELECT id, name, role FROM members WHERE id = ?', [id]);
  const projects = () => query('SELECT id, name FROM projects ORDER BY name');
  const members = () => query('SELECT id, name, role FROM members ORDER BY name');
  const project = (id) => first('SELECT id, name FROM projects WHERE id = ?', [id]);

  async function encodePin(pin) {
    const salt = randomBytes(16).toString('hex');
    const key = await derive(pin, salt, 64);
    return `pin:${salt}:${key.toString('hex')}`;
  }

  async function createMember(input, id = randomUUID()) {
    const { name, role, pin } = memberInput.parse(input);
    // Keep the legacy unique email column compatible with existing databases.
    await query('INSERT INTO members (id, email, name, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, `${id}@perfil.invalid`, name, await encodePin(pin), role]);
    return { id, name, role };
  }

  async function verifyPin(id, pin) {
    const account = await first('SELECT id, password FROM members WHERE id = ?', [id]);
    const saved = account?.password;
    if (saved?.startsWith('pin:')) {
      const [, salt, encoded] = saved.split(':');
      if (timingSafeEqual(await derive(pin, salt, 64), Buffer.from(encoded, 'hex'))) return account;
    } else {
      // Accounts from the old login flow start with the same default as new profiles.
      await derive(pin, 'legacy-pin-comparison', 64);
      if (account && pin === DEFAULT_PIN) return account;
    }
    throw new AppError(401, 'PIN incorreto.');
  }

  async function login(id, pin) {
    const account = await verifyPin(id, pin);
    return issue(account.id, 'Web', 7);
  }

  async function changePin(id, currentPin, newPin, sessionToken) {
    const { password } = await verifyPin(id, currentPin);
    const updated = await query('UPDATE members SET password = ? WHERE id = ? AND password = ?',
      [await encodePin(newPin), id, password]);
    if (!updated.affectedRows) throw new AppError(409, 'O PIN mudou. Tente novamente.');
    await query("DELETE FROM credentials WHERE member_id = ? AND source = 'Web' AND digest <> ?",
      [id, digest(sessionToken)]);
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

  /**
   * Número do cartão por projeto (GA-12): as iniciais do projeto e a ordem de criação.
   * Cartões antigos sem número recebem o seu na primeira leitura, pela ordem em que nasceram.
   */
  const projectKey = (name) => (name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[A-Za-z0-9]+/g) || ['GT'])
    .map((word) => word[0]).join('').slice(0, 3).toUpperCase().padEnd(2, 'T');
  async function numberCards() {
    const rows = await query('SELECT id, project_id, version, document FROM cards');
    const cards = rows.map((row) => ({ row, card: JSON.parse(row.document) }));
    const missing = cards.filter(({ card }) => !card.number);
    if (!missing.length) return;
    const projectsById = new Map((await projects()).map((item) => [item.id, item]));
    const next = new Map();
    for (const { card } of cards) if (card.number) next.set(card.projectId, Math.max(next.get(card.projectId) || 0, card.number));
    missing.sort((a, b) => a.card.history[0].at.localeCompare(b.card.history[0].at));
    for (const { row, card } of missing) {
      const number = (next.get(card.projectId) || 0) + 1;
      next.set(card.projectId, number);
      card.number = number;
      card.key = `${projectKey(projectsById.get(card.projectId)?.name || 'GT')}-${number}`;
      await query('UPDATE cards SET document = ? WHERE id = ? AND version = ?', [JSON.stringify(card), row.id, row.version]);
    }
  }

  async function createCard(input, actor) {
    const fields = newCard.parse(input);
    const owner = await project(fields.projectId);
    if (!owner) throw new AppError(404, 'Projeto não encontrado.');
    await validateAssignee(fields.assigneeId);
    await numberCards();
    const numbers = (await query('SELECT document FROM cards WHERE project_id = ?', [fields.projectId]))
      .map((row) => JSON.parse(row.document).number || 0);
    const number = Math.max(0, ...numbers) + 1;
    const card = {
      ...fields, id: randomUUID(), number, key: `${projectKey(owner.name)}-${number}`, status: 'todo', blocked: '', archived: false, checklist: [], attachments: [],
      comments: [], history: [event(actor, 'Criou o cartão')]
    };
    await query('INSERT INTO cards (id, project_id, version, document) VALUES (?, ?, ?, ?)',
      [card.id, card.projectId, 1, JSON.stringify(card)]);
    return { ...card, version: 1 };
  }

  const decode = (row) => ({ ...JSON.parse(row.document), version: row.version });

  const cardVersions = () => query('SELECT id, version FROM cards ORDER BY id');

  async function readCards(projectId) {
    await numberCards();
    const rows = projectId
      ? await query('SELECT version, document FROM cards WHERE project_id = ?', [projectId])
      : await query('SELECT version, document FROM cards');
    return rows.map(decode).sort((a, b) => b.history[0].at.localeCompare(a.history[0].at));
  }

  async function listCards({ projectId, assigneeId, archived = false, blocked = false } = {}) {
    return (await readCards(projectId)).filter((card) => card.archived === archived &&
      (!blocked || card.blocked) && (!assigneeId || card.assigneeId === assigneeId));
  }

  async function boardCards() {
    const cards = [];
    const archive = [];
    for (const card of await readCards()) {
      if (card.archived === false) cards.push(card);
      else if (card.archived === true) archive.push(card);
    }
    return { cards, archive };
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

  /** Muda o cartão sem pedir versão (anexos): tenta de novo se outra pessoa salvou junto. */
  async function changeCard(id, change, actor, action) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await first('SELECT version, document FROM cards WHERE id = ?', [id]);
      if (!row) throw new AppError(404, 'Cartão não encontrado.');
      const { version, ...card } = decode(row);
      card.attachments ??= [];
      const result = change(card);
      card.history.push(event(actor, action));
      const saved = await query('UPDATE cards SET document = ?, version = ? WHERE id = ? AND version = ?',
        [JSON.stringify(card), version + 1, id, version]);
      if (saved.affectedRows === 1) return { card: { ...card, version: version + 1 }, result };
    }
    throw new AppError(409, 'O cartão mudou. Atualize o quadro e tente novamente.');
  }

  /** Print ou imagem do cartão: o arquivo fica no disco, o cartão guarda só o registro. */
  async function addAttachment(id, file, actor) {
    const attachment = { id: randomUUID(), file: file.name, type: file.type, size: file.size, by: actor.name, at: new Date().toISOString() };
    return (await changeCard(id, (card) => {
      if (card.attachments.length >= 30) throw new AppError(400, 'O cartão aceita até 30 imagens.');
      card.attachments.push(attachment);
      return attachment;
    }, actor, 'Print')).card;
  }

  async function removeAttachment(id, attachmentId, actor) {
    return changeCard(id, (card) => {
      const index = card.attachments.findIndex((item) => item.id === attachmentId);
      if (index < 0) throw new AppError(404, 'Imagem não encontrada.');
      return card.attachments.splice(index, 1)[0];
    }, actor, 'Tirou print');
  }

  async function cardFile(id, name) {
    const row = await first('SELECT document FROM cards WHERE id = ?', [id]);
    const card = row && JSON.parse(row.document);
    return card?.attachments?.find((item) => item.file === name) || null;
  }

  /** Fundos prontos; "imagem" usa a foto que a pessoa enviou. */
  const BACKGROUNDS = ['noite', 'couro', 'asfalto', 'entardecer', 'imagem'];
  async function preferences(id) {
    const row = await first('SELECT data FROM preferences WHERE member_id = ?', [id]);
    return { background: 'noite', backgroundFile: null, ...(row ? JSON.parse(row.data) : {}) };
  }
  async function setPreferences(id, input) {
    const current = await preferences(id);
    const next = { ...current };
    if (input.background !== undefined) {
      if (!BACKGROUNDS.includes(input.background)) throw new AppError(400, 'Fundo desconhecido.');
      if (input.background === 'imagem' && !(input.backgroundFile ?? current.backgroundFile)) throw new AppError(400, 'Envie uma imagem primeiro.');
      next.background = input.background;
    }
    if (input.backgroundFile !== undefined) next.backgroundFile = input.backgroundFile;
    const data = JSON.stringify(next);
    const updated = await query('UPDATE preferences SET data = ? WHERE member_id = ?', [data, id]);
    if (!updated.affectedRows) await query('INSERT INTO preferences (member_id, data) VALUES (?, ?)', [id, data]);
    return { previous: current, saved: next };
  }

  /**
   * Contexto do projeto: seções em texto, links, responsável e ambientes.
   * Cada gravação vira uma versão com autor, canal, hora e a versão que a pessoa
   * (ou a IA) leu antes. Se alguém salvou no meio-tempo, a gravação é recusada.
   */
  const AGENT_SOURCES = ['Codex', 'Claude'];
  const CONTEXT_SECTIONS = ['resumo', 'objetivo', 'regras', 'stack', 'decisoes'];
  const httpUrl = z.url().max(500).refine((value) => /^https?:\/\//i.test(value), 'Use um link http ou https.');
  const contextInput = z.object({
    ...Object.fromEntries(CONTEXT_SECTIONS.map((key) => [key, z.string().max(12000).optional()])),
    links: z.array(z.object({ title: z.string().trim().min(1).max(120), url: httpUrl })).max(30).optional(),
    responsavelId: z.uuid().nullable().optional(),
    producao: z.union([httpUrl, z.literal('')]).optional(),
    teste: z.union([httpUrl, z.literal('')]).optional(),
    repositorio: z.string().trim().max(200).optional(),
    branch: z.string().trim().max(120).optional()
  });
  const CONTEXT_FIELDS = [...CONTEXT_SECTIONS, 'links', 'responsavelId', 'producao', 'teste', 'repositorio', 'branch'];
  const readVersion = z.coerce.number().int().min(0, 'Informe a versão do contexto que você leu (campo versaoLida).');

  async function contextRow(projectId) {
    if (!(await project(projectId))) throw new AppError(404, 'Projeto não encontrado.');
    return first('SELECT data FROM project_context WHERE project_id = ?', [projectId]);
  }
  function contextOf(row) {
    const empty = { ...Object.fromEntries(CONTEXT_SECTIONS.map((key) => [key, ''])), links: [], responsavelId: null,
      producao: '', teste: '', repositorio: '', branch: '', version: 0, updated: null, sectionBy: {} };
    return { ...empty, ...(row ? JSON.parse(row.data) : {}) };
  }
  async function projectContext(projectId) {
    return contextOf(await contextRow(projectId));
  }
  async function logContext(projectId, entry) {
    await query('INSERT INTO context_history (id, project_id, at, data) VALUES (?, ?, ?, ?)',
      [randomUUID(), projectId, Date.now(), JSON.stringify(entry)]);
  }
  async function writeContext(projectId, row, current, patch, actor, read, action) {
    const by = event(actor, action);
    const changed = CONTEXT_FIELDS.filter((key) => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(current[key]));
    if (read !== current.version) {
      await logContext(projectId, { kind: 'recusado', by, readVersion: read, version: current.version, changed });
      throw new AppError(409, `O contexto mudou: agora está na versão ${current.version} e você leu a ${read}. Leia de novo (ver_contexto_projeto) antes de editar.`);
    }
    if (!changed.length) return current;
    if (patch.responsavelId) await validateAssignee(patch.responsavelId);
    const sectionBy = { ...current.sectionBy };
    for (const key of changed) sectionBy[key] = { ...by, readVersion: read };
    const next = { ...current, ...patch, version: current.version + 1, updated: { ...by, readVersion: read }, sectionBy };
    const data = JSON.stringify(next);
    const saved = row
      ? await query('UPDATE project_context SET data = ? WHERE project_id = ? AND data = ?', [data, projectId, row.data])
      : await query('INSERT INTO project_context (project_id, data) VALUES (?, ?)', [projectId, data]).catch(() => ({ affectedRows: 0 }));
    if (!saved.affectedRows) throw new AppError(409, 'O contexto mudou agora mesmo. Leia de novo antes de editar.');
    await logContext(projectId, { kind: 'versao', by, readVersion: read, version: next.version, changed, snapshot: next });
    return next;
  }
  async function setProjectContext(projectId, input, actor) {
    const row = await contextRow(projectId);
    const current = contextOf(row);
    const { versaoLida, ...rest } = input || {};
    const read = readVersion.parse(versaoLida ?? (current.version === 0 ? 0 : undefined));
    return writeContext(projectId, row, current, contextInput.parse(rest), actor, read, 'Editou o contexto');
  }
  async function contextHistory(projectId) {
    await contextRow(projectId);
    const rows = await query('SELECT data FROM context_history WHERE project_id = ? ORDER BY at DESC LIMIT 400', [projectId]);
    return rows.map((row) => JSON.parse(row.data)).filter((entry) => entry.kind !== 'leitura');
  }
  /** Registra que alguém leu o contexto (o MCP chama ao ler). Uma marca por pessoa e versão. */
  async function markContextRead(projectId, actor) {
    const current = await projectContext(projectId);
    const rows = await query('SELECT data FROM context_history WHERE project_id = ? ORDER BY at DESC LIMIT 400', [projectId]);
    const seen = rows.map((row) => JSON.parse(row.data)).some((entry) => entry.kind === 'leitura' &&
      entry.by.actor === actor.name && entry.by.source === actor.source && entry.version === current.version);
    if (!seen) await logContext(projectId, { kind: 'leitura', by: event(actor, 'Leu o contexto'), version: current.version });
    return current;
  }

  /** Linha do tempo do projeto: contexto, cartões e commits, do mais novo para o mais velho. */
  async function projectActivity(projectId, commits = []) {
    await contextRow(projectId);
    const rows = await query('SELECT id, data FROM context_history WHERE project_id = ? ORDER BY at DESC LIMIT 400', [projectId]);
    const log = rows.map((row) => ({ id: row.id, ...JSON.parse(row.data) }));
    const reads = log.filter((entry) => entry.kind === 'leitura');
    /** Última leitura do contexto pela mesma pessoa/canal antes de um momento. */
    const readBefore = (by) => reads.find((entry) => entry.by.actor === by.actor && entry.by.source === by.source && entry.by.at <= by.at);
    const items = log.filter((entry) => entry.kind !== 'leitura').map((entry) => ({
      kind: 'contexto', id: entry.id, at: entry.by.at, by: entry.by, rejected: entry.kind === 'recusado',
      version: entry.version, readVersion: entry.readVersion, changed: entry.changed || []
    }));
    for (const card of await readCards(projectId)) {
      card.history.forEach((entry, index) => {
        const read = AGENT_SOURCES.includes(entry.source) ? readBefore(entry) : undefined;
        items.push({ kind: 'cartao', id: `${card.id}:${index}`, at: entry.at, by: entry, cardId: card.id, key: card.key, title: card.title,
          action: entry.action, ...(AGENT_SOURCES.includes(entry.source) ? { readVersion: read ? read.version : null } : {}) });
      });
    }
    for (const commit of commits) items.push({ kind: 'commit', id: `commit:${commit.sha}`, ...commit });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }

  const messageInput = z.object({
    text: z.string().trim().min(1, 'Escreva a mensagem.').max(4000),
    ref: z.object({ kind: z.enum(['commit', 'contexto', 'cartao']), id: z.string().max(120), label: z.string().max(200) }).nullable().optional()
  });
  async function projectMessages(projectId) {
    await contextRow(projectId);
    const rows = await query('SELECT data FROM project_messages WHERE project_id = ? ORDER BY at DESC LIMIT 200', [projectId]);
    return rows.map((row) => JSON.parse(row.data)).reverse();
  }
  async function addProjectMessage(projectId, input, actor) {
    await contextRow(projectId);
    const { text, ref } = messageInput.parse(input);
    const message = { id: randomUUID(), text, ref: ref || null, ...event(actor, 'Mensagem') };
    delete message.action;
    await query('INSERT INTO project_messages (id, project_id, at, data) VALUES (?, ?, ?, ?)', [message.id, projectId, Date.now(), JSON.stringify(message)]);
    return message;
  }
  async function restoreContext(projectId, version, input, actor) {
    const row = await contextRow(projectId);
    const current = contextOf(row);
    const read = readVersion.parse(input?.versaoLida);
    const rows = await query('SELECT data FROM context_history WHERE project_id = ?', [projectId]);
    const target = rows.map((r) => JSON.parse(r.data)).find((entry) => entry.kind === 'versao' && entry.version === version);
    if (!target) throw new AppError(404, 'Versão não encontrada.');
    const patch = Object.fromEntries(CONTEXT_FIELDS.map((key) => [key, target.snapshot[key] ?? current[key]]));
    return writeContext(projectId, row, current, patch, actor, read, `Voltou para a versão ${version}`);
  }

  return { projectContext, setProjectContext, contextHistory, restoreContext, markContextRead, projectActivity, projectMessages, addProjectMessage, preferences, setPreferences, createMember, login, changePin, issue, revoke, tokens, revokeMcp, identity, projects, members, createProject, createCard, listCards, cardVersions, boardCards, updateCard, addAttachment, removeAttachment, cardFile };
}
