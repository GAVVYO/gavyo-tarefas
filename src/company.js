import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const COLORS = ['papel', 'amarelo', 'azul', 'verde', 'rosa'];
const day = z.iso.date();
const optionalProject = z.uuid().nullable().optional();

/** O que cada tipo de item da tela Empresa aceita. Criar exige os campos obrigatórios; editar aceita qualquer parte. */
const shapes = {
  note: z.object({
    title: z.string().trim().max(120).default(''),
    text: z.string().max(4000).default(''),
    x: z.number().min(0).max(100).default(4),
    y: z.number().min(0).max(20000).default(24),
    color: z.enum(COLORS).default('papel'),
    projectId: optionalProject
  }).strict(),
  event: z.object({
    day,
    title: z.string().trim().min(1).max(120),
    text: z.string().max(1000).default(''),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
    color: z.enum(COLORS).default('amarelo'),
    projectId: optionalProject
  }).strict(),
  cash: z.object({
    type: z.enum(['in', 'out']),
    amountCents: z.number().int().min(1).max(99999999999),
    day,
    description: z.string().trim().min(1).max(300),
    ownerId: z.uuid().nullable().default(null),
    category: z.string().trim().max(60).default(''),
    projectId: optionalProject
  }).strict()
};
export const companyKinds = Object.keys(shapes);
const kindInput = z.enum(companyKinds);

export function createCompany({ query, members, AppError }) {
  const decode = (row) => ({ ...JSON.parse(row.data), version: Number(row.version) });

  async function checkMember(id) {
    if (id && !(await members()).some((member) => member.id === id)) throw new AppError(400, 'Essa pessoa não está na equipe.');
  }

  async function companyItems(kind) {
    const rows = await query('SELECT version, data FROM company_items WHERE kind = ?', [kindInput.parse(kind)]);
    return rows.map(decode).sort((a, b) => a.at.localeCompare(b.at));
  }

  async function addCompanyItem(kind, input, actor) {
    const fields = shapes[kindInput.parse(kind)].parse(input ?? {});
    await checkMember(fields.ownerId);
    const now = new Date().toISOString();
    const item = { id: randomUUID(), kind, ...fields, author: { id: actor.id, name: actor.name }, at: now, updatedAt: now, updatedBy: actor.name };
    await query('INSERT INTO company_items (id, kind, version, data) VALUES (?, ?, 1, ?)', [item.id, kind, JSON.stringify(item)]);
    return { ...item, version: 1 };
  }

  /** Edita com a versão lida: se outra pessoa gravou antes, recusa (409) para ninguém perder o que escreveu. */
  async function updateCompanyItem(kind, id, input, actor) {
    const { version, ...rest } = input ?? {};
    const expected = z.int().positive().parse(version);
    // No zod 4, .partial() ainda aplica os padrões: fica só com o que foi enviado.
    const parsed = shapes[kindInput.parse(kind)].partial().parse(rest);
    const patch = Object.fromEntries(Object.entries(parsed).filter(([key]) => key in rest));
    if ('ownerId' in patch) await checkMember(patch.ownerId);
    const [row] = await query('SELECT version, data FROM company_items WHERE id = ? AND kind = ?', [z.uuid().parse(id), kind]);
    if (!row) throw new AppError(404, 'Item não encontrado.');
    const current = decode(row);
    if (current.version !== expected) throw new AppError(409, 'Alguém mudou este item agora há pouco. Veja a versão nova.');
    const { version: _old, ...base } = current;
    const updated = { ...base, ...patch, updatedAt: new Date().toISOString(), updatedBy: actor.name };
    const result = await query('UPDATE company_items SET data = ?, version = ? WHERE id = ? AND version = ?',
      [JSON.stringify(updated), expected + 1, id, expected]);
    if (result.affectedRows !== 1) throw new AppError(409, 'Alguém mudou este item agora há pouco. Veja a versão nova.');
    return { ...updated, version: expected + 1 };
  }

  async function removeCompanyItem(kind, id) {
    const result = await query('DELETE FROM company_items WHERE id = ? AND kind = ?', [z.uuid().parse(id), kindInput.parse(kind)]);
    if (result.affectedRows !== 1) throw new AppError(404, 'Item não encontrado.');
  }

  return { companyItems, addCompanyItem, updateCompanyItem, removeCompanyItem };
}
