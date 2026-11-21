import { avatarFor } from './profile-dock.js';

/** Conversa global isolada do DOM do quadro e dos rascunhos dos cartões. */
export function setupTeamChat({ request, onExpired, getCards, onCard }) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'btn team-chat-trigger';
  trigger.textContent = 'Chat da equipe';
  trigger.setAttribute('aria-label', 'Abrir chat da equipe (Ctrl+Shift+Z)');
  trigger.setAttribute('aria-keyshortcuts', 'Control+Shift+Z');
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
    <div class="team-chat-heading">
      <img class="team-chat-mark" src="/aguia-dourada.svg" alt="" aria-hidden="true" width="52" height="38">
      <div><h2 id="team-chat-title">Chat da equipe</h2><p class="muted">Uma conversa para todos os projetos</p></div>
    </div>
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
    <div class="team-chat-tools team-chat-composer">
      <label class="btn team-chat-upload" title="Adicionar imagem"><span aria-hidden="true">+</span><input class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple aria-label="Escolher imagens para o chat"></label>
      <textarea id="team-chat-text" rows="2" maxlength="4000" placeholder="Escreva sua mensagem…"></textarea>
      <button class="btn primary team-chat-send" type="submit" aria-label="Enviar mensagem" title="Enviar mensagem"><span aria-hidden="true">↑</span></button>
    </div>
    <div class="team-chat-attachments" aria-live="polite"></div>
    <small class="muted">Enter envia · Shift+Enter quebra linha · Arraste cartões até o chat</small>
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
  let user = null, previousFocus, stream, session = 0, reading = null, sending = false;
  let liveCursor = 0, unreadCount = 0;
  const toast = document.createElement('button');
  toast.type = 'button'; toast.className = 'btn team-chat-toast'; toast.hidden = true;
  toast.setAttribute('popover', 'manual'); toast.setAttribute('aria-live', 'polite');
  document.body.append(toast);
  toast.addEventListener('click', open);
  let messages = [], hasOlder = false, retrySend = false, pendingMessage = null;
  let attachments = [], mentioned = [], uploading = false;
  const pending = find('.team-chat-attachments');
  function renderPending() {
    pending.replaceChildren();
    attachments.forEach(image => {
      const chip = document.createElement('span'); chip.className = 'team-chat-chip';
      const img = document.createElement('img'); img.src = image.url; img.alt = 'Imagem para enviar';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remover imagem';
      remove.onclick = () => { attachments = attachments.filter(i => i.id !== image.id); renderPending(); };
      chip.append(img, remove); pending.append(chip);
    });
    mentioned.forEach(card => {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn';
      remove.textContent = `${card.key}: ${card.title} ×`; remove.setAttribute('aria-label', `Remover menção a ${card.key}`);
      remove.onclick = () => { mentioned = mentioned.filter(c => c.id !== card.id); renderPending(); };
      pending.append(remove);
    });
  }
  function mentionCard(card) {
    if (!card || !user || sending) return false;
    if (mentioned.some(c => c.id === card.id)) return true;
    if (mentioned.length >= 10) { feedback.textContent = 'Use no máximo 10 cartões por mensagem.'; return false; }
    mentioned.push(card); renderPending(); return true;
  }
  let draggedCard = null, delivering = false;
  function clearDrag() {
    draggedCard = null;
    trigger.classList.remove('team-chat-ready', 'team-chat-over');
  }
  document.addEventListener('dragstart', event => {
    const element = event.target.closest?.('.card[draggable="true"]');
    const card = element && (getCards?.() || []).find(c => c.id === element.dataset.id);
    if (!user || !card || delivering || sending) return;
    draggedCard = { card, rect: element.getBoundingClientRect() };
    trigger.classList.add('team-chat-ready');
  });
  document.addEventListener('dragend', clearDrag);
  for (const target of [trigger, panel]) {
    target.addEventListener('dragover', event => {
      if (!draggedCard || sending || delivering) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      trigger.classList.add('team-chat-over');
    });
    target.addEventListener('dragleave', event => {
      if (!target.contains(event.relatedTarget)) trigger.classList.remove('team-chat-over');
    });
    target.addEventListener('drop', async event => {
      if (!draggedCard || sending || delivering) return;
      event.preventDefault(); event.stopPropagation();
      const { card, rect } = draggedCard;
      clearDrag();
      if (!mentionCard(card)) return;
      const current = session;
      delivering = true;
      try {
        if (!panel.open) await carryToChat(card, rect);
        if (current !== session || !user) return;
        open(); feedback.textContent = `${card.key} pronto para enviar.`; input.focus();
      } finally { delivering = false; }
    });
  }
  async function carryToChat(card, from) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = trigger.getBoundingClientRect();
    const flight = document.createElement('div');
    flight.className = 'chat-delivery'; flight.setAttribute('popover', 'manual');
    flight.setAttribute('aria-hidden', 'true');
    const hawk = document.createElement('img'); hawk.src = '/aguia-dourada.svg'; hawk.alt = '';
    const cargo = document.createElement('span'); cargo.className = 'chat-delivery-card';
    const key = document.createElement('b'); key.textContent = card.key;
    const title = document.createElement('span'); title.textContent = card.title;
    cargo.append(key, title); flight.append(hawk, cargo); document.body.append(flight);
    flight.showPopover();
    const x = Math.max(12, Math.min(innerWidth - 200, from.left));
    const y = Math.max(70, Math.min(innerHeight - 100, from.top));
    const endX = to.left + to.width / 2 - 90, endY = to.top - 60;
    try {
      await flight.animate([
        { transform: `translate(${x}px,${y}px) rotate(-8deg)`, opacity: 0 },
        { transform: `translate(${x}px,${y - 35}px) rotate(-5deg)`, opacity: 1, offset: .18 },
        { transform: `translate(${(x + endX) / 2}px,${Math.min(y, endY) - 70}px) rotate(5deg)`, opacity: 1, offset: .58 },
        { transform: `translate(${endX}px,${endY}px) scale(.5) rotate(-3deg)`, opacity: 0 }
      ], { duration: 720, easing: 'ease-in-out', fill: 'forwards' }).finished;
    } finally { flight.remove(); }
  }
  find('[type=file]').addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (uploading || sending || !user) return;
    if (files.length + attachments.length > 4) { feedback.textContent = 'Escolha no máximo 4 imagens por mensagem.'; return; }
    if (files.some(f => !['image/png','image/jpeg','image/webp','image/gif'].includes(f.type) || f.size > 8*1024*1024)) {
      feedback.textContent = 'Use PNG, JPG, WebP ou GIF de até 8 MB.'; return;
    }
    const current = session; uploading = true; send.disabled = true; feedback.textContent = 'Enviando imagens…';
    try {
      for (const file of files) {
        const response = await fetch('/api/team/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal: AbortSignal.timeout(30000) });
        const image = await response.json();
        if (!response.ok) throw Object.assign(new Error(image.error), { status: response.status });
        if (current !== session) return;
        attachments.push(image); renderPending();
      }
      feedback.textContent = 'Imagem pronta. Envie a mensagem para compartilhar.';
    } catch (error) { if (current === session) { feedback.textContent = error.message || 'Não foi possível enviar a imagem.'; if (error.status === 401) { setUser(null); onExpired(); } } }
    finally { if (current === session) { uploading = false; send.disabled = false; } }
  });
  let viewportCleanup;
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const lastSequence = () => messages.at(-1)?.sequence;

  function placeTrigger() {
    if (trigger.hidden || panel.open) return;
    const parent = [...document.querySelectorAll('dialog[open]')].filter(d => d !== panel && d.matches(':modal')).at(-1) || document.body;
    // Dentro do modal ativo para não ficar inerte; popover evita o recorte do diálogo.
    if (trigger.parentElement !== parent) parent.append(trigger);
    if (toast.parentElement !== parent) parent.append(toast);
    if (!toast.hidden && toast.showPopover && !toast.matches(':popover-open')) toast.showPopover();
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
      const avatar = document.createElement('span');
      const art = avatarFor(message.author.name);
      avatar.className = `team-chat-avatar ${art ? 'face' : 'avatar'}`;
      avatar.setAttribute('aria-hidden', 'true');
      if (art) avatar.dataset.art = art;
      else avatar.textContent = message.author.name.trim().split(/\s+/).slice(0, 2)
        .map(part => Array.from(part)[0]).join('').toUpperCase();
      const content = document.createElement('div');
      content.className = 'team-chat-content';
      const by = document.createElement('strong');
      by.textContent = message.author.name;
      const time = document.createElement('time');
      time.dateTime = message.at;
      time.textContent = date.format(new Date(message.at));
      const text = document.createElement('p');
      text.textContent = message.text;
      content.append(by, time, text);
      for (const image of message.images || []) {
        const link = document.createElement('a'); link.href = image.url; link.target = '_blank'; link.rel = 'noopener'; link.setAttribute('aria-label', 'Abrir imagem da mensagem');
        const img = document.createElement('img'); img.src = image.url; img.alt = 'Imagem compartilhada'; img.className = 'team-chat-image'; img.loading = 'lazy';
        link.append(img); content.append(link);
      }
      for (const card of message.cards || []) {
        const link = document.createElement('button'); link.type = 'button'; link.className = 'btn team-chat-card'; link.textContent = `${card.key}: ${card.title}`;
        link.onclick = () => { panel.addEventListener('close', () => onCard?.(card.id), { once: true }); panel.close(); };
        content.append(link);
      }
      article.append(avatar, content);
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

  function connect() {
    if (stream || !user) return;
    const current = session;
    const source = new EventSource(`/api/team/messages/stream?after=${liveCursor}`);
    stream = source;
    source.addEventListener('messages', event => {
      if (current !== session || stream !== source) return;
      const incoming = JSON.parse(event.data);
      const fresh = incoming.filter(m => m.sequence > liveCursor);
      for (const msg of fresh) {
        liveCursor = Math.max(liveCursor, msg.sequence);
        if (msg.author.id !== user.id && (!panel.open || document.hidden)) {
          unreadCount++;
          trigger.textContent = `Chat da equipe (${unreadCount})`;
          trigger.setAttribute('aria-label', `Abrir chat da equipe: ${unreadCount} mensagens não lidas (Ctrl+Shift+Z)`);
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const notice = new Notification(`${msg.author.name} no chat da equipe`, { body: (msg.text || (msg.images?.length ? 'Enviou uma imagem' : 'Mencionou um cartão')).slice(0,160), icon: '/aguia-dourada.svg', tag: 'gavyo-team-chat' });
              notice.onclick = () => { window.focus(); open(); notice.close(); };
            } catch { /* O contador permanece disponível se o navegador não aceitar o aviso. */ }
          } else if (!document.hidden) {
            toast.textContent = `${msg.author.name}: ${(msg.text || (msg.images?.length ? 'Enviou uma imagem' : 'Mencionou um cartão')).slice(0,100)} — Abrir chat`;
            toast.hidden = false;
            if (!toast.matches(':popover-open')) toast.showPopover?.();
          }
        }
      }
      if (panel.open) draw(incoming);
      if (!retrySend) errorBox.hidden = true;
    });
    source.onopen = () => {
      if (current === session && !retrySend) {
        errorBox.hidden = true;
        if (feedback.textContent === 'Reconectando à conversa…') feedback.textContent = 'Conversa conectada.';
      }
    };
    source.onerror = async () => {
      if (stream !== source || current !== session) return;
      if (!retrySend) feedback.textContent = 'Reconectando à conversa…';
      try {
        const state = await request('/session', 'GET', undefined, { signal: AbortSignal.timeout(10000) });
        if (current === session && !state.signedIn) { setUser(null); onExpired(); }
      } catch { /* EventSource reconecta sozinho e retoma pelo Last-Event-ID. */ }
    };
  }

  document.addEventListener('visibilitychange', () => {
    if (panel.open && !document.hidden) {
      unreadCount = 0; trigger.textContent = 'Chat da equipe';
      trigger.setAttribute('aria-label', 'Abrir chat da equipe (Ctrl+Shift+Z)');
      toast.hidePopover?.(); toast.hidden = true;
    }
  });

  function disconnect() {
    stream?.close();
    stream = null;
  }

  async function load(before = null) {
    if (!user || !panel.open || reading) return;
    const marker = {};
    const current = session;
    reading = marker;
    older.disabled = true;
    const after = lastSequence();
    let more = false, loaded = false;
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
      more = !before && after !== undefined && page.hasMore;
      loaded = true;
    } catch (error) {
      if (current === session && panel.open) fail(error, false);
    } finally {
      if (reading === marker) reading = null;
      older.disabled = false;
      if (loaded && current === session && panel.open) {
        if (more) void load(); else { liveCursor = lastSequence() ?? liveCursor; connect(); }
      }
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
    disconnect();
    unreadCount = 0; trigger.textContent = 'Chat da equipe';
    trigger.setAttribute('aria-label', 'Abrir chat da equipe (Ctrl+Shift+Z)');
    toast.hidePopover?.(); toast.hidden = true;
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
    viewportCleanup?.();
    trigger.hidden = !user;
    trigger.setAttribute('aria-expanded', 'false');
    placeTrigger();
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    else if (user) trigger.focus({ preventScroll: true });
  });
  let backdropPress = false;
  const outside = event => {
    const rect = panel.getBoundingClientRect();
    return event.target === panel && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  panel.addEventListener('pointerdown', event => { backdropPress = outside(event); });
  panel.addEventListener('click', event => { if (backdropPress && outside(event)) panel.close(); backdropPress = false; });
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
    if (sending || uploading || !user) return;
    const text = input.value.trim();
    if ((!text && !attachments.length && !mentioned.length) || text.length > 4000) { input.setCustomValidity('Escreva uma mensagem com até 4000 caracteres.'); input.reportValidity(); return; }
    const current = session;
    const draft = { text, images: attachments.map(i => i.id), cards: mentioned.map(c => c.id) };
    if (!pendingMessage || JSON.stringify(pendingMessage.draft) !== JSON.stringify(draft)) pendingMessage = { ...draft, clientId: crypto.randomUUID(), draft };
    const { draft: ignoredDraft, ...payload } = pendingMessage;
    sending = true; find('.team-chat-tools').inert = true; pending.inert = true;
    input.disabled = true;
    send.disabled = true;
    send.textContent = '…';
    feedback.textContent = 'Enviando mensagem…';
    try {
      await request('/team/messages', 'POST', payload, { signal: AbortSignal.timeout(15000) });
      if (current !== session) return;
      // Buscar pelo cursor mantém a ordem se outra pessoa enviou durante a escrita.
      input.value = ''; attachments = []; mentioned = []; renderPending();
      pendingMessage = null;
      errorBox.hidden = true;
      retrySend = false;
      feedback.textContent = 'Mensagem enviada.';
      if (!stream && panel.open) void load();
    } catch (error) {
      if (current === session) { feedback.textContent = ''; fail(error, true); }
    } finally {
      if (current === session) {
        sending = false; find('.team-chat-tools').inert = false; pending.inert = false; input.disabled = false; send.disabled = false; send.innerHTML = '<span aria-hidden="true">↑</span>';
        if (panel.open) input.focus({ preventScroll: true });
      }
    }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));

  // Captura antes dos atalhos do cartão, menus e visualizador de prints.
  document.addEventListener('keydown', event => {
    if (!user || event.isComposing) return;
    const shortcut = event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z';
    if (shortcut) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (panel.open) panel.close(); else open();
    } else if (panel.open && event.target === input && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!sending && !uploading && (input.value.trim() || attachments.length || mentioned.length)) form.requestSubmit();
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
    disconnect();
    user = next;
    if (panel.open) panel.close();
    clearDrag();
    attachments = []; mentioned = []; uploading = false; find('.team-chat-tools').inert = false; pending.inert = false; renderPending();
    messages = []; hasOlder = false; pendingMessage = null; sending = false;
    input.value = ''; input.disabled = false; send.disabled = false; send.innerHTML = '<span aria-hidden="true">↑</span>';
    log.replaceChildren(); older.hidden = true; empty.hidden = false; empty.textContent = 'Carregando mensagens…';
    errorBox.hidden = true; retrySend = false; feedback.textContent = '';
    liveCursor = 0; unreadCount = 0;
    trigger.textContent = 'Chat da equipe';
    toast.hidePopover?.(); toast.hidden = true;
    if (user) {
      const current = session;
      void request('/team/messages?limit=1').then(page => {
        if (current !== session) return;
        liveCursor = page.nextAfter ?? 0; connect();
      }).catch(error => { if (current === session) fail(error, false); });
    }
    trigger.hidden = !user;
    if (!user) trigger.hidePopover?.();
    else placeTrigger();
  }
  return { setUser, get isOpen() { return panel.open; } };
}
