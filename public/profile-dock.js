const AVATARS = new Map([
  ['bola', 'bola'],
  ['felipe', 'felipe'],
  ['passa marcha', 'passa-marcha']
]);
let viewerModule;

export function avatarFor(name) {
  const normalized = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .trim().replace(/[-\s]+/g, ' ');
  return AVATARS.get(normalized) || (normalized.startsWith('felipe ') ? 'felipe' : '');
}

export function setupProfileDock(dock, { avatar, name, initiallyOpen }) {
  const handle = dock.querySelector('.profile-handle');
  const panel = dock.querySelector('.profile-panel');
  const stage = dock.querySelector('.profile-avatar-stage');
  let gesture = null;
  let ignoreClick = false;
  let loaded = false;

  function loadAvatar() {
    if (!avatar || loaded) return;
    loaded = true;
    if (!stage.querySelector('.profile-poster')) {
      const poster = document.createElement('img');
      poster.className = 'profile-poster';
      poster.alt = '';
      poster.src = `/api/avatar-assets/${avatar}.png`;
      stage.append(poster);
    }
    viewerModule ??= import('/assets/model-viewer.min.js').catch((error) => {
      viewerModule = undefined;
      throw error;
    });
    void viewerModule.then(async ({ ModelViewerElement }) => {
      if (!dock.isConnected) return;
      if (ModelViewerElement) ModelViewerElement.powerPreference = 'low-power';
      await customElements.whenDefined('model-viewer');
      if (!dock.isConnected) return;
      const model = document.createElement('model-viewer');
      for (const [key, value] of Object.entries({
        src: `/api/avatar-assets/${avatar}.glb`, alt: `Avatar 3D de ${name}`, loading: 'lazy',
        'camera-controls': '', 'disable-pan': '', 'disable-zoom': '', 'interaction-prompt': 'none',
        'camera-target': '0m 0.73m 0m', 'camera-orbit': '8deg 83deg 1.48m',
        'field-of-view': '25deg', 'touch-action': 'pan-y', exposure: '1.15'
      })) model.setAttribute(key, value);
      model.addEventListener('load', () => { stage.dataset.loaded = 'true'; });
      model.addEventListener('error', () => { delete stage.dataset.loaded; });
      stage.append(model);
    }).catch(() => { loaded = false; });
  }

  function setOpen(open) {
    if (!open && panel.contains(document.activeElement)) handle.focus({ preventScroll: true });
    dock.dataset.open = String(open);
    handle.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', open ? 'Recolher perfil' : 'Abrir perfil');
    handle.title = open ? 'Recolher perfil' : 'Puxe para abrir o perfil';
    panel.inert = !open;
    if (open) loadAvatar();
  }

  function endGesture(event, canceled = false) {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { fromX, wasOpen } = gesture;
    gesture = null;
    const travel = fromX - event.clientX;
    if (!canceled && Math.abs(travel) >= 8) {
      ignoreClick = true;
      setTimeout(() => { ignoreClick = false; }, 0);
      const towardOtherState = wasOpen ? travel <= -35 : travel >= 35;
      setOpen(towardOtherState ? !wasOpen : wasOpen);
    }
    delete dock.dataset.pulling;
    dock.style.removeProperty('--profile-pull');
  }

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    gesture = { id: event.pointerId, fromX: event.clientX, wasOpen: dock.dataset.open === 'true' };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const travel = gesture.fromX - event.clientX;
    const pull = gesture.wasOpen ? Math.min(0, travel) : Math.max(0, travel);
    if (Math.abs(pull) < 3 && !dock.hasAttribute('data-pulling')) return;
    dock.dataset.pulling = 'true';
    const resistance = Math.sign(pull) * Math.min(86, Math.abs(pull) * .66);
    dock.style.setProperty('--profile-pull', `${resistance}px`);
  });
  handle.addEventListener('pointerup', endGesture);
  handle.addEventListener('lostpointercapture', (event) => endGesture(event, true));
  handle.addEventListener('pointercancel', (event) => endGesture(event, true));
  handle.addEventListener('click', (event) => {
    if (!ignoreClick || event.detail === 0) setOpen(dock.dataset.open !== 'true');
  });
  dock.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dock.dataset.open === 'true') {
      event.stopPropagation();
      setOpen(false);
      handle.focus({ preventScroll: true });
    }
  });
  panel.querySelector('.profile-close').addEventListener('click', () => {
    setOpen(false);
    handle.focus({ preventScroll: true });
  });
  setOpen(initiallyOpen);
}
