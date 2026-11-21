import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { z } from 'zod';

const subscriptionInput = z.object({
  endpoint: z.url().max(2000).refine((value) => value.startsWith('https://'), 'Endereço de aviso inválido.'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) })
});
const idOf = (endpoint) => createHash('sha256').update(endpoint).digest('hex');
const firstName = (name) => String(name || '').trim().split(/\s+/)[0].toLowerCase();

/**
 * Avisos fora do site (Web Push): chegam no aparelho mesmo com a aba fechada.
 * Chaves VAPID vêm do ambiente ou são criadas uma vez e guardadas no banco.
 */
export function createPush({ query, store, subject = process.env.PUBLIC_ORIGIN || 'mailto:equipe@gavyo.me', send = webpush.sendNotification }) {
  let keysPromise;
  function keys() {
    keysPromise ??= (async () => {
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      }
      const [row] = await query('SELECT public_key, private_key FROM push_keys WHERE id = 1');
      if (row) return { publicKey: row.public_key, privateKey: row.private_key };
      const fresh = webpush.generateVAPIDKeys();
      try {
        await query('INSERT INTO push_keys (id, public_key, private_key) VALUES (1, ?, ?)', [fresh.publicKey, fresh.privateKey]);
        return fresh;
      } catch {
        // Outra instância criou junto: vale a que ficou gravada.
        const [saved] = await query('SELECT public_key, private_key FROM push_keys WHERE id = 1');
        return { publicKey: saved.public_key, privateKey: saved.private_key };
      }
    })().catch((error) => { keysPromise = undefined; throw error; });
    return keysPromise;
  }

  async function subscribe(memberId, input) {
    const subscription = subscriptionInput.parse(input);
    const id = idOf(subscription.endpoint);
    await query('DELETE FROM push_subscriptions WHERE id = ?', [id]);
    await query('INSERT INTO push_subscriptions (id, member_id, data) VALUES (?, ?, ?)', [id, memberId, JSON.stringify(subscription)]);
  }

  async function unsubscribe(memberId, endpoint) {
    await query('DELETE FROM push_subscriptions WHERE id = ? AND member_id = ?', [idOf(String(endpoint || '')), memberId]);
  }

  async function deliver(rows, payload, label) {
    const { publicKey, privateKey } = await keys();
    const body = JSON.stringify(payload);
    let sent = 0;
    const failures = [];
    await Promise.all(rows.map(async (row) => {
      try {
        await send(JSON.parse(row.data), body, { TTL: 3600, urgency: 'high', vapidDetails: { subject, publicKey, privateKey } });
        sent++;
      } catch (error) {
        // Aparelho que desinstalou ou revogou: some da lista.
        if (error.statusCode === 404 || error.statusCode === 410) await query('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
        failures.push(error.statusCode || error.code || error.message);
      }
    }));
    console.log(`Aviso (${label}): ${sent} de ${rows.length} aparelho(s)${failures.length ? `; falhas: ${failures.join(', ')}` : ''}`);
    return { devices: rows.length, sent, failures };
  }

  const rowsFor = (ids) => query(`SELECT id, data FROM push_subscriptions WHERE member_id IN (${ids.map(() => '?').join(',')})`, ids);

  async function sendTo(memberIds, payload, label = 'envio') {
    const ids = [...new Set(memberIds)].filter(Boolean);
    if (!ids.length) return 0;
    return (await deliver(await rowsFor(ids), payload, label)).sent;
  }

  /** Aviso de teste para a própria pessoa: diz quantos aparelhos dela estão registrados e quantos receberam. */
  async function test(memberId) {
    return deliver(await rowsFor([memberId]), {
      title: 'GAVYO Tarefas', body: 'Aviso de teste: se você está lendo isto, os avisos chegam neste aparelho.', url: '/?chat=1', tag: 'teste'
    }, 'teste');
  }

  /** Chat global: todos menos quem escreveu. */
  async function teamMessage(message) {
    const members = await store.members();
    return sendTo(members.filter((member) => member.id !== message.author.id).map((member) => member.id), {
      title: `${message.author.name} no chat da equipe`, body: (message.text || (message.images?.length ? '📷 Imagem' : 'Nova mensagem')).slice(0, 180),
      url: '/?chat=1', tag: 'chat-equipe'
    }, 'chat');
  }

  /** Conversa do cartão: responsável, quem já conversou ali e quem foi citado pelo nome; nunca quem escreveu. */
  async function cardComment(card, comment, actor) {
    const members = await store.members();
    const byName = new Map(members.map((member) => [member.name, member.id]));
    const talked = card.comments.slice(0, -1).map((item) => byName.get(item.actor));
    const text = comment.toLowerCase();
    const cited = members.filter((member) => new RegExp(`(^|[^\\p{L}])@?${firstName(member.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(text)).map((member) => member.id);
    const to = [card.assigneeId, ...talked, ...cited].filter((id) => id && id !== actor.id);
    return sendTo(to, {
      title: `${actor.name} · ${card.key || 'cartão'} ${card.title}`.slice(0, 120), body: comment.slice(0, 180),
      url: `/?card=${card.id}`, tag: `cartao-${card.id}`
    }, 'cartão');
  }

  return { keys, subscribe, unsubscribe, sendTo, test, teamMessage, cardComment };
}
