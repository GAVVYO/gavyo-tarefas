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
    else for (const share of entry.shares) add(share.memberId, entry.payerId, share.amountCents);
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
      const id = entry.occurrence.expenseId;
      paid.set(id, (paid.get(id) || 0) + 1);
    }
  }
  return entries.flatMap((entry) => {
    if (entry.kind !== 'expense' || entry.frequency === 'none') return [];
    const dueOn = nextDue(entry.paidOn, entry.frequency, (paid.get(entry.id) || 0) + 1);
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

  async function projectFinance(projectId) {
    const { version, entries } = await read(projectId);
    const today = todayInFortaleza.format(new Date());
    const expenses = entries.filter((entry) => entry.kind === 'expense').sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.at.localeCompare(a.at));
    return {
      projectId, version, today, expenses, balances: calculateBalances(entries),
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
      const previous = entries.find((entry) => entry.id === expense.id);
      if (previous) {
        const sameFields = Object.keys(fields).every((key) => JSON.stringify(previous[key]) === JSON.stringify(expense[key]));
        if (previous.kind === expense.kind && previous.actorId === actor.id && sameFields
          && Boolean(previous.occurrence) === Boolean(expense.occurrence)) return previous;
        throw new AppError(409, 'Identificador de gasto já usado.');
      }
      if (fields.occurrence) {
        const { expenseId, dueOn } = fields.occurrence;
        const next = nextRenewals(entries, todayInFortaleza.format(new Date())).find(({ id }) => id === expenseId);
        if (next?.dueOn !== dueOn) throw new AppError(409, 'O vencimento mudou. Confira o próximo pagamento na aba Financeiro.');
      }
      if (await append(projectId, version, expense)) return expense;
    }
    throw new AppError(409, 'O financeiro mudou enquanto você salvava. Tente novamente.');
  }

  async function settleFinance(projectId, input, actor) {
    const { version, fromId, toId, amountCents } = settlementInput.parse(input);
    const current = await read(projectId);
    const balance = calculateBalances(current.entries).find((entry) => entry.fromId === fromId && entry.toId === toId);
    const changed = () => new AppError(409, 'O saldo mudou. Confira o valor atualizado antes de confirmar o acerto.');
    if (version !== current.version || balance?.amountCents !== amountCents) throw changed();
    const entry = { id: randomUUID(), kind: 'settlement', fromId, toId, amountCents, readVersion: version,
      actorId: actor.id, ...event(actor, 'Registrou acerto') };
    if (!await append(projectId, version, entry)) throw changed();
    return entry;
  }

  return { projectFinance, addExpense, settleFinance };
}
