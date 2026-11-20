const GOLD_HAWK = '/aguia-dourada.svg';
const FLIGHT_MS = 760;

function translate(x, y) {
  return `translate3d(${x}px, ${y}px, 0)`;
}

function visible(rect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
    rect.right > 0 && rect.left < innerWidth;
}

/** Carries a visual copy. The actual card and the board remain interactive. */
export function playCardFlight(card, from) {
  if (!card?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = card.getBoundingClientRect();
  if (!visible(from) || !visible(to)) return;

  const layer = document.createElement('div');
  layer.className = 'card-flight';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;

  const cargo = card.cloneNode(true);
  cargo.classList.remove('moved', 'card-transition');
  cargo.classList.add('flight-cargo');
  cargo.removeAttribute('data-id');
  cargo.removeAttribute('draggable');
  cargo.style.width = `${to.width}px`;

  const hawk = document.createElement('img');
  hawk.className = 'flight-hawk';
  hawk.alt = '';
  hawk.src = GOLD_HAWK;

  layer.append(cargo, hawk);
  document.body.append(layer);
  card.classList.add('flight-landing');
  const finish = () => {
    layer.remove();
    card.classList.remove('flight-landing');
  };

  const side = to.left + to.width / 2 >= from.left + from.width / 2 ? 1 : -1;
  const startX = from.left + (from.width - to.width) / 2;
  const span = to.left - startX;
  const rise = Math.min(68, Math.max(24, Math.min(from.top, to.top) - 72));
  const liftX = startX + span * .24;
  const liftY = from.top - rise;
  const releaseX = to.left - span * .06;
  const releaseY = to.top - Math.min(48, rise);
  const hawkWidth = Math.min(116, Math.max(84, to.width * .32));
  hawk.style.width = `${hawkWidth}px`;
  const cargoFrame = (x, y, angle = 0, scale = 1) =>
    `${translate(x, y)} rotate(${angle}deg) scale(${scale})`;
  const birdFrame = (x, y, angle, flap = 1) =>
    `${translate(x + to.width / 2 - hawkWidth / 2, y - hawkWidth * .49)} rotate(${angle}deg) scale(${side}, ${flap})`;

  const timing = { duration: FLIGHT_MS, fill: 'both' };
  const cargoFlight = cargo.animate([
    { offset: 0, transform: cargoFrame(startX, from.top) },
    { offset: .23, transform: cargoFrame(startX, from.top), easing: 'cubic-bezier(.2,.8,.25,1)' },
    { offset: .45, transform: cargoFrame(liftX, liftY, -side * 5, .93), easing: 'ease-in-out' },
    { offset: .72, transform: cargoFrame(releaseX, releaseY, side * 6, .95), easing: 'ease-in' },
    { offset: .9, transform: cargoFrame(to.left, to.top + 3, 0, .99), easing: 'ease-out' },
    { offset: 1, transform: cargoFrame(to.left, to.top) }
  ], timing);

  const hawkFlight = hawk.animate([
    { offset: 0, opacity: 0, transform: birdFrame(startX - side * 148, from.top - 110, side * 24, .94), easing: 'ease-out' },
    { offset: .09, opacity: 1, transform: birdFrame(startX - side * 77, from.top - 45, side * 24, 1.1) },
    { offset: .23, opacity: 1, transform: birdFrame(startX, from.top, -side * 7, .77), easing: 'cubic-bezier(.2,.8,.25,1)' },
    { offset: .45, opacity: 1, transform: birdFrame(liftX, liftY, -side * 11, 1.12), easing: 'ease-in-out' },
    { offset: .72, opacity: 1, transform: birdFrame(releaseX, releaseY, side * 8, .83), easing: 'ease-out' },
    { offset: .89, opacity: .83, transform: birdFrame(to.left + side * 93, to.top - rise - 35, -side * 16, 1.08) },
    { offset: 1, opacity: 0, transform: birdFrame(to.left + side * 176, to.top - rise - 70, -side * 22) }
  ], timing);

  void Promise.allSettled([cargoFlight.finished, hawkFlight.finished]).then(finish);
}
