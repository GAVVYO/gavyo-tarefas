const GAP = 14;
const desktop = matchMedia('(min-width: 840px)');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function setupTaskWindow(dialog) {
  let gesture;
  let dock = '';
  let floating;
  const board = document.documentElement;
  const clear = () => {
    for (const key of ['left', 'top', 'width', 'height']) dialog.style.removeProperty(key);
    board.style.removeProperty('--task-dock-size');
    delete board.dataset.taskDock;
    delete dialog.dataset.dock;
    delete dialog.dataset.magnet;
  };
  const fit = ({ left, top, width, height }) => {
    width = clamp(width, 360, innerWidth - GAP * 2);
    height = clamp(height, 300, innerHeight - GAP * 2);
    return { width, height, left: clamp(left, GAP, innerWidth - width - GAP), top: clamp(top, GAP, innerHeight - height - GAP) };
  };
  function position(box) {
    for (const [key, value] of Object.entries(box)) dialog.style[key] = `${value}px`;
  }
  function playSnap(before) {
    if (reduce.matches || !dialog.animate) return;
    const after = dialog.getBoundingClientRect();
    dialog.animate([
      { transform: `translate(${before.left - after.left}px,${before.top - after.top}px) scale(${before.width / after.width},${before.height / after.height})` },
      { transform: 'none' }
    ], { duration: 330, easing: 'cubic-bezier(.17,.84,.25,1)' });
    const feather = dialog.querySelector('.task-snap-hawk');
    if (feather) feather.animate([
      { opacity: 0, transform: 'translateX(-36px) rotate(-12deg) scale(.7)' },
      { opacity: .92, offset: .38 },
      { opacity: 0, transform: 'translateX(30px) rotate(8deg) scale(1.15)' }
    ], { duration: 440, easing: 'ease-out' });
  }
  function dockTo(side, motion = true) {
    if (!desktop.matches) return;
    const before = dialog.getBoundingClientRect();
    if (!dock && !gesture) floating = fit(before);
    dock = side;
    clear();
    if (!dock) {
      if (floating) position(fit(floating));
    } else {
      const width = clamp(before.width, 360, Math.floor(innerWidth * .55));
      position({ left: side === 'left' ? GAP : innerWidth - width - GAP, top: GAP, width, height: innerHeight - GAP * 2 });
      dialog.dataset.dock = side;
      board.dataset.taskDock = side;
      board.style.setProperty('--task-dock-size', `${width + GAP}px`);
    }
    if (motion) playSnap(before);
  }
  dialog.addEventListener('click', (event) => {
    const control = event.target.closest('button[data-task-dock]');
    if (!control) return;
    const side = control.dataset.taskDock;
    dockTo(side === dock ? '' : side);
  });
  dialog.addEventListener('keydown', (event) => {
    if (!desktop.matches || !event.target.matches('.task-resize') ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const { left, top, width, height } = dialog.getBoundingClientRect();
    const horizontal = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0;
    const vertical = event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0;
    const next = fit({ left, top, width: width + horizontal, height: dock ? height : height + vertical });
    if (dock) {
      next.width = Math.min(next.width, innerWidth * .55);
      next.left = dock === 'right' ? innerWidth - GAP - next.width : GAP;
      board.style.setProperty('--task-dock-size', `${next.width + GAP}px`);
    }
    position(next);
  });
  dialog.addEventListener('pointerdown', (event) => {
    if (!desktop.matches || event.button !== 0 || !dialog.classList.contains('task-dialog')) return;
    const edge = event.target.closest('.task-resize');
    if (!edge && (!event.target.closest('.task-drag') || event.target.closest('button,a,input'))) return;
    dialog.getAnimations().forEach((animation) => animation.cancel());
    const box = dialog.getBoundingClientRect();
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, box, edge: Boolean(edge), side: dock, moved: false };
    dialog.setPointerCapture(event.pointerId);
  });
  dialog.addEventListener('pointermove', (event) => {
    if (gesture?.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
    gesture.moved = true;
    const { left, top, width, height } = gesture.box;
    if (gesture.edge) {
      const resized = fit({ left, top, width: width + dx * (dock === 'right' ? -1 : 1), height: dock ? height : height + dy });
      if (dock) {
        resized.width = Math.min(resized.width, innerWidth * .55);
        resized.left = dock === 'right' ? innerWidth - GAP - resized.width : GAP;
        board.style.setProperty('--task-dock-size', `${resized.width + GAP}px`);
      }
      position(resized);
      return;
    }
    if (dock) { dock = ''; clear(); }
    const side = event.clientX < 76 ? 'left' : event.clientX > innerWidth - 76 ? 'right' : '';
    if (side) dialog.dataset.magnet = side; else delete dialog.dataset.magnet;
    position(fit({ left: left + dx, top: top + dy, width, height }));
  });
  function finish(event) {
    if (gesture?.id !== event.pointerId) return;
    const { moved, edge } = gesture;
    const side = dialog.dataset.magnet;
    gesture = null;
    delete dialog.dataset.magnet;
    if (!moved) return;
    if (side && !edge && event.type === 'pointerup') dockTo(side);
    else if (!dock) floating = fit(dialog.getBoundingClientRect());
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) dialog.addEventListener(name, finish);
  window.addEventListener('resize', () => {
    if (!dialog.open || !dialog.classList.contains('task-dialog')) return;
    if (!desktop.matches) { dock = ''; clear(); }
    else if (dock) dockTo(dock, false);
    else if (dialog.style.left) position(fit(dialog.getBoundingClientRect()));
  });
  dialog.addEventListener('close', () => {
    if (dialog.open && dialog.classList.contains('task-dialog')) return;
    dock = '';
    gesture = null;
    floating = undefined;
    clear();
  });
}
