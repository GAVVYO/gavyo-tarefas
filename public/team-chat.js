/** Conversa global isolada do DOM do quadro e dos rascunhos dos cartões. */
export function setupTeamChat({ request, onExpired }) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn team-chat-trigger';
  trigger.textContent = 'Chat da equipe';
  trigger.setAttribute('aria-label', 'Abrir chat da equipe (Ctrl+Shift+L)');
  trigger.setAttribute('aria-keyshortcuts', 'Control+Shift+L');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'team-chat');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('popover', 'manual');
  trigger.hidden = true;
  document.body.append(trigger);
  const panel = document.createElement('dialog');
  panel.id = 'team-chat';
  panel.className = 'team-chat';
  panel.setAttribute('aria-labelledby', 'team-chat-title');
  panel.innerHTML = `<header class="dialog-head">
    <div><h2 id="team-chat-title">Chat da equipe</h2><p class="muted">Uma conversa para todos os projetos</p></div>
    <button type="button" class="btn ghost team-chat-close" aria-label="Fechar chat da equipe">Fechar</button>
  </header>
  <div class="team-chat-feedback" role="status" aria-live="polite"></div>
  <div class="team-chat-error" role="alert" hidden><span></span> <button type="button" class="btn team-chat-retry">Tentar novamente</button></div>
  <div class="team-chat-scroll" tabindex="0" aria-label="Histórico do chat da equipe">
    <button type="button" class="btn team-chat-older" hidden>Carregar mensagens antigas</button>
    <p class="team-chat-empty muted">Carregando mensagens…</p>
    <div class="team-chat-messages" role="log" aria-label="Mensagens da equipe" aria-live="polite" aria-relevant="additions"></div>
  </div>
  <form class="team-chat-form">
    <label for="team-chat-text">Mensagem para a equipe</label>
    <textarea id="team-chat-text" rows="3" maxlength="4000" required placeholder="Escreva sua mensagem…"></textarea>
    <div><small class="muted">Ctrl+Shift+L abre o chat · Esc fecha</small><button class="btn primary" type="submit">Enviar mensagem</button></div>
  </form>`;
  document.body.append(panel);
  const find = s => panel.querySelector(s);
  const form = find('form');
  const input = find('textarea');
  const send = find('[type=submit]');
  const older = find('.team-chat-older');
  const scroll = find('.team-chat-scroll');
  const log = find('.team-chat-messages');
  const empty = find('.team-chat-empty');
  const feedback = find('.team-chat-feedback');
  const errorBox = find('.team-chat-error');
  let user = null, previousFocus, timer, session = 0, reading = null, sending = false;
  let messages = [], hasOlder = false, retrySend = false, pendingMessage = null;
  let viewportCleanup;
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const lastSequence = () => messages.at(-1)?.sequence;

  function placeTrigger() {
    if (trigger.hidden || panel.open) return;
    const parent = [...document.querySelectorAll('dialog[open]')].filter(d => d !== panel && d.matches(':modal')).at(-1) || document.body;
    // Dentro do modal ativo para não ficar inerte; popover evita o recorte do diálogo.
    if (trigger.parentElement !== parent) parent.append(trigger);
    if (trigger.showPopover && !trigger.matches(':popover-open')) trigger.showPopover();
  }
  new MutationObserver(placeTrigger).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });

  function fail(error, isSend) {
    if (error.status === 401) { setUser(null); onExpired(); return; }
    if (!isSend && retrySend) return;
    errorBox.hidden = false;
    errorBox.querySelector('span').textContent = isSend
      ? 'Não foi possível enviar. Sua mensagem continua aqui; tente novamente.'
      : 'Não foi possível atualizar a conversa. Tente novamente.';
    retrySend = isSend;
  }

  function draw(items, prepend = false) {
    const oldHeight = scroll.scrollHeight;
    const oldTop = scroll.scrollTop;
    const nearBottom = oldHeight - oldTop - scroll.clientHeight < 70;
    const ids = new Set(messages.map(m => m.id));
    const fresh = items.filter(m => !ids.has(m.id));
    messages = [...messages, ...fresh].sort((a, b) => a.sequence - b.sequence);
    const fragment = document.createDocumentFragment();
    for (const message of fresh.sort((a, b) => a.sequence - b.sequence)) {
      const article = document.createElement('article');
      article.className = 'team-chat-message';
      article.dataset.own = String(message.author.id === user.id);
      const by = document.createElement('strong');
      by.textContent = message.author.name;
      const time = document.createElement('time');
      time.dateTime = message.at;
      time.textContent = date.format(new Date(message.at));
      const text = document.createElement('p');
      text.textContent = message.text;
      article.append(by, time, text);
      fragment.append(article);
    }
    if (prepend) {
      log.setAttribute('aria-live', 'off');
      log.prepend(fragment);
      scroll.scrollTop = oldTop + scroll.scrollHeight - oldHeight;
      log.setAttribute('aria-live', 'polite');
    } else {
      log.append(fragment);
      if (nearBottom || messages.length === fresh.length) scroll.scrollTop = scroll.scrollHeight;
      else if (fresh.length) feedback.textContent = 'Há novas mensagens no final da conversa.';
    }
    empty.hidden = messages.length > 0;
    empty.textContent = 'Ainda não há mensagens. Comece a conversa.';
  }

  function schedule(delay = 2500) {
    clearTimeout(timer);
    if (user && panel.open) timer = setTimeout(() => void load(), document.hidden ? 10000 : delay);
  }

  async function load(before = null) {
    if (!user || !panel.open || reading) return;
    const marker = {};
    const current = session;
    reading = marker;
    older.disabled = true;
    const after = lastSequence();
    try {
      const query = before ? `before=${before}` : after ? `after=${after}` : '';
      const page = await request(`/team/messages?${query}`, 'GET', undefined, { signal: AbortSignal.timeout(10000) });
      if (current !== session || !panel.open) return;
      // Erro de envio só desaparece após um envio bem-sucedido.
      if (!retrySend) errorBox.hidden = true;
      if (before || after === undefined) {
        hasOlder = page.hasMore;
        older.hidden = !hasOlder;
      }
      draw(page.messages, Boolean(before));
      if (!before && after !== undefined && page.hasMore) schedule(0);
      else schedule();
    } catch (error) {
      if (current === session && panel.open) { fail(error, false); schedule(5000); }
    } finally {
      if (reading === marker) reading = null;
      older.disabled = false;
    }
  }

  function fitViewport() {
    const vp = window.visualViewport;
    if (vp && matchMedia('(max-width: 640px)').matches) {
      panel.style.setProperty('--chat-height', `${vp.height}px`);
      panel.style.setProperty('--chat-top', `${vp.offsetTop}px`);
    } else {
      panel.style.removeProperty('--chat-height');
      panel.style.removeProperty('--chat-top');
    }
  }

  function open() {
    if (!user || panel.open) return;
    previousFocus = document.activeElement;
    trigger.hidePopover?.();
    trigger.hidden = true;
    trigger.setAttribute('aria-expanded', 'true');
    panel.showModal();
    fitViewport();
    window.visualViewport?.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('scroll', fitViewport);
    viewportCleanup = () => {
      window.visualViewport?.removeEventListener('resize', fitViewport);
      window.visualViewport?.removeEventListener('scroll', fitViewport);
    };
    input.focus({ preventScroll: true });
    void load();
  }

  panel.addEventListener('close', () => {
    clearTimeout(timer);
    viewportCleanup?.();
    trigger.hidden = !user;
    trigger.setAttribute('aria-expanded', 'false');
    placeTrigger();
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    else if (user) trigger.focus({ preventScroll: true });
  });
  panel.addEventListener('cancel', event => { event.preventDefault(); panel.close(); });
  find('.team-chat-close').addEventListener('click', () => panel.close());
  trigger.addEventListener('click', open);
  older.addEventListener('click', () => void load(messages[0]?.sequence));
  scroll.addEventListener('scroll', () => {
    if (scroll.scrollTop < 30 && hasOlder) void load(messages[0]?.sequence);
  }, { passive: true });
  find('.team-chat-retry').addEventListener('click', () => retrySend ? form.requestSubmit() : void load());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !user) return;
    const text = input.value.trim();
    if (!text || text.length > 4000) { input.setCustomValidity('Escreva uma mensagem com até 4000 caracteres.'); input.reportValidity(); return; }
    const current = session;
    if (!pendingMessage || pendingMessage.text !== text) pendingMessage = { text, clientId: crypto.randomUUID() };
    const payload = pendingMessage;
    sending = true;
    input.disabled = true;
    send.disabled = true;
    send.textContent = 'Enviando…';
    feedback.textContent = 'Enviando mensagem…';
    try {
      await request('/team/messages', 'POST', payload, { signal: AbortSignal.timeout(15000) });
      if (current !== session) return;
      // Buscar pelo cursor mantém a ordem se outra pessoa enviou durante a escrita.
      input.value = '';
      pendingMessage = null;
      errorBox.hidden = true;
      retrySend = false;
      feedback.textContent = 'Mensagem enviada.';
      schedule(0);
    } catch (error) {
      if (current === session) { feedback.textContent = ''; fail(error, true); }
    } finally {
      if (current === session) {
        sending = false; input.disabled = false; send.disabled = false; send.textContent = 'Enviar mensagem';
        if (panel.open) input.focus({ preventScroll: true });
      }
    }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));

  // Captura antes dos atalhos do cartão, menus e visualizador de prints.
  document.addEventListener('keydown', event => {
    if (!user) return;
    const shortcut = event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l';
    if (shortcut) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (panel.open) panel.close(); else open();
    } else if (panel.open && event.key === 'Escape' && !event.isComposing) {
      event.preventDefault(); event.stopImmediatePropagation(); panel.close();
    } else if (panel.open) {
      // O diálogo nativo cuida do Tab; atalhos antigos não devem agir na tela inferior.
      event.stopImmediatePropagation();
    }
  }, true);

  function setUser(next) {
    if (next?.id === user?.id) return;
    session++;
    reading = null;
    clearTimeout(timer);
    user = next;
    if (panel.open) panel.close();
    messages = []; hasOlder = false; pendingMessage = null; sending = false;
    input.value = ''; input.disabled = false; send.disabled = false; send.textContent = 'Enviar mensagem';
    log.replaceChildren(); older.hidden = true; empty.hidden = false; empty.textContent = 'Carregando mensagens…';
    errorBox.hidden = true; retrySend = false; feedback.textContent = '';
    trigger.hidden = !user;
    if (!user) trigger.hidePopover?.();
    else placeTrigger();
  }
  return { setUser, get isOpen() { return panel.open; } };
}
