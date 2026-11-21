import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const isoDay = z.iso.date().refine((value) => value >= '0001-01-01' && value <= '9998-12-31', 'Informe uma data válida.');
const cents = z.number().int().min(1).max(99999999999);
export const expenseInput = z.object({
  description: z.string().trim().min(1).max(300),
  amountCents: cents,
  paidOn: isoDay,
  payerId: z.uuid(),
  participantIds: z.array(z.uuid()).min(1).max(250),
  frequency: z.enum(['none', 'monthly', 'yearly']).default('none'),
  occurrence: z.object({ expenseId: z.uuid(), dueOn: z.iso.date() }).optional(),
  categoryId: z.uuid().nullable().optional(),
  operationId: z.uuid().optional()
}).strict();
const settlementInput = z.object({
  fromId: z.uuid(), toId: z.uuid(), amountCents: z.number().int().positive(), version: z.number().int().nonnegative()
}).strict();

const todayInFortaleza = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' });
const dayMs = 86400000;

function splitExpense(amount, participants) {
  const each = Math.floor(amount / participants.length);
  const remainder = amount % participants.length;
  return participants.map((memberId, index) => ({ memberId, amountCents: each + Number(index < remainder) }));
}

function nextDue(paidOn, frequency, occurrenceNumber) {
  const [year, month, day] = paidOn.split('-').map(Number);
  const monthIndex = year * 12 + month - 1 + occurrenceNumber * (frequency === 'monthly' ? 1 : 12);
  const nextYear = Math.floor(monthIndex / 12);
  const nextMonth = monthIndex % 12 + 1;
  if (nextYear > 9999) return null;
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(nextYear, nextMonth, 0);
  return [String(nextYear).padStart(4, '0'), String(nextMonth).padStart(2, '0'), String(Math.min(day, monthEnd.getUTCDate())).padStart(2, '0')].join('-');
}

function calculateBalances(entries) {
  const pairs = new Map();
  function add(fromId, toId, amount) {
    if (fromId === toId || amount === 0) return;
    const [first, second] = [fromId, toId].sort();
    const key = first + ':' + second;
    const current = pairs.get(key) || 0n;
    pairs.set(key, current + BigInt(first === fromId ? amount : -amount));
  }
  for (const entry of entries) {
    if (entry.kind === 'settlement') add(entry.fromId, entry.toId, -entry.amountCents);
    else if (entry.kind === 'expense') for (const share of entry.shares) add(share.memberId, entry.payerId, share.amountCents);
  }
  return [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, amount]) => {
    if (amount === 0n) return [];
    const [a, b] = key.split(':');
    return [{ fromId: amount > 0n ? a : b, toId: amount > 0n ? b : a, amountCents: Number(amount > 0n ? amount : -amount) }];
  });
}

function nextRenewals(entries, today) {
  const paid = new Map();
  for (const entry of entries) {
    if (entry.kind === 'expense' && entry.occurrence) {
      const { expenseId, dueOn } = entry.occurrence;
      if (!paid.has(expenseId)) paid.set(expenseId, new Set());
      paid.get(expenseId).add(dueOn);
    }
  }
  return entries.flatMap((entry) => {
    if (entry.kind !== 'expense' || entry.frequency === 'none') return [];
    let occurrence = 1;
    let dueOn = nextDue(entry.paidOn, entry.frequency, occurrence);
    while (dueOn && paid.get(entry.id)?.has(dueOn)) dueOn = nextDue(entry.paidOn, entry.frequency, ++occurrence);
    if (!dueOn) return [];
    const days = (Date.parse(dueOn) - Date.parse(today)) / dayMs;
    return [{ id: entry.id, dueOn, days, notice: days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'later' }];
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export function createFinance({ query, project, members, event, AppError }) {
  async function read(projectId) {
    if (!await project(projectId)) throw new AppError(404, 'Projeto não encontrado.');
    const rows = await query('SELECT revision, data FROM project_finance WHERE project_id = ? ORDER BY revision', [projectId]);
    return { version: Number(rows.at(-1)?.revision ?? 0), entries: rows.map((row) => JSON.parse(row.data)) };
  }

  // A chave única por projeto e revisão serializa gravações também entre instâncias do app.
  async function append(projectId, version, entry) {
    try {
      await query('INSERT INTO project_finance (project_id, revision, operation_id, data) VALUES (?, ?, ?, ?)',
        [projectId, version + 1, entry.id, JSON.stringify(entry)]);
      return true;
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/.test(error.message)) return false;
      throw error;
    }
  }

  function active(entries) {
    const removed = new Set(entries.filter(e => e.kind === 'expense_deleted').map(e => e.expenseId));
    return entries.filter(e => !removed.has(e.id) && !removed.has(e.occurrence?.expenseId));
  }

  async function addFinanceCategory(projectId, input, actor) {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).strict().parse(input);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { version, entries } = await read(projectId);
      const previous = entries.find(e => e.kind === 'category' && e.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
      if (previous) return previous;
      const entry = { id: randomUUID(), kind: 'category', name, ...event(actor, 'Criou categoria') };
      if (await append(projectId, version, entry)) return entry;
    }
    throw new AppError(409, 'O financeiro mudou. Tente novamente.');
  }

  async function deleteExpense(projectId, expenseId, input, actor) {
    const { version } = z.object({ version: z.number().int().nonnegative() }).strict().parse(input);
    const current = await read(projectId);
    const expense = current.entries.find(e => e.id === expenseId && e.kind === 'expense');
    if (!expense) throw new AppError(404, 'Gasto não encontrado.');
    const previous = current.entries.find(e => e.kind === 'expense_deleted' && e.expenseId === expenseId);
    if (previous) return previous;
    if (current.version !== version) throw new AppError(409, 'O financeiro mudou. Atualize antes de excluir.');
    const entry = { id: randomUUID(), kind: 'expense_deleted', expenseId, description: expense.description,
      amountCents: expense.amountCents, ...event(actor, 'Excluiu gasto') };
    if (!await append(projectId, version, entry)) throw new AppError(409, 'O financeiro mudou. Atualize antes de excluir.');
    return entry;
  }

  async function projectFinance(projectId) {
    const { version, entries: history } = await read(projectId);
    const entries = active(history);
    const today = todayInFortaleza.format(new Date());
    const expenses = entries.filter((entry) => entry.kind === 'expense').sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.at.localeCompare(a.at));
    return {
      projectId, version, today, expenses, categories: entries.filter(e => e.kind === 'category'),
      deletions: history.filter(e => e.kind === 'expense_deleted').reverse(), balances: calculateBalances(entries),
      settlements: entries.filter((entry) => entry.kind === 'settlement').reverse(),
      renewals: nextRenewals(entries, today)
    };
  }

  async function addExpense(projectId, input, actor) {
    const { operationId = randomUUID(), ...fields } = expenseInput.parse(input);
    fields.participantIds.sort();
    if (new Set(fields.participantIds).size !== fields.participantIds.length) {
      throw new AppError(400, 'Há um participante repetido no rateio.');
    }
    const memberIds = new Set((await members()).map(({ id }) => id));
    if (![fields.payerId, ...fields.participantIds].every((id) => memberIds.has(id))) {
      throw new AppError(400, 'Escolha quem pagou e os participantes entre os membros da equipe.');
    }
    if (fields.occurrence && fields.frequency !== 'none') {
      throw new AppError(400, 'Uma renovação não pode iniciar outra recorrência.');
    }
    const expense = { id: operationId, kind: 'expense', ...fields, shares: splitExpense(fields.amountCents, fields.participantIds),
      actorId: actor.id, ...event(actor, 'Registrou gasto') };
    for (let attempt = 0; attempt < 5; attempt++) {
      const { version, entries } = await read(projectId);
      if (fields.categoryId && !entries.some(e => e.kind === 'category' && e.id === fields.categoryId)) throw new AppError(400, 'Categoria não encontrada neste projeto.');
      const previous = entries.find((entry) => entry.id === expense.id);
      if (previous) {
        const sameFields = Object.keys(fields).every((key) => JSON.stringify(previous[key]) === JSON.stringify(expense[key]));
        if (previous.kind === expense.kind && previous.actorId === actor.id && sameFields
          && Boolean(previous.occurrence) === Boolean(expense.occurrence)) return previous;
        throw new AppError(409, 'Identificador de gasto já usado.');
      }
      if (fields.occurrence) {
        const { expenseId, dueOn } = fields.occurrence;
        const next = nextRenewals(active(entries), todayInFortaleza.format(new Date())).find(({ id }) => id === expenseId);
        if (next?.dueOn !== dueOn) throw new AppError(409, 'O vencimento mudou. Confira o próximo pagamento na aba Financeiro.');
      }
      if (await append(projectId, version, expense)) return expense;
    }
    throw new AppError(409, 'O financeiro mudou enquanto você salvava. Tente novamente.');
  }

  async function settleFinance(projectId, input, actor) {
    const { version, fromId, toId, amountCents } = settlementInput.parse(input);
    const current = await read(projectId);
    const balance = calculateBalances(active(current.entries)).find((entry) => entry.fromId === fromId && entry.toId === toId);
    const changed = () => new AppError(409, 'O saldo mudou. Confira o valor atualizado antes de confirmar o acerto.');
    if (version !== current.version || balance?.amountCents !== amountCents) throw changed();
    const entry = { id: randomUUID(), kind: 'settlement', fromId, toId, amountCents, readVersion: version,
      actorId: actor.id, ...event(actor, 'Registrou acerto') };
    if (!await append(projectId, version, entry)) throw changed();
    return entry;
  }

  return { projectFinance, addExpense, settleFinance, addFinanceCategory, deleteExpense };
}
