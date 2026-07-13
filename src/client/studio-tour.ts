import type { Studio3D } from './studio-3d';

export type TourStop = {
  id: string;
  label: string;
  detail: string;
  anchor: string;
};

export const TOUR_STOPS: TourStop[] = [
  { id: 'drums', anchor: 'drums', label: 'Drum machine', detail: 'Tap pads to program beats. KIT = sound style. PAT = preset patterns.' },
  { id: 'synth', anchor: 'synth', label: 'Synth / keys', detail: 'Play melody (A–K) and bass (1–0). SYN cycles piano, guitar, sax & more.' },
  { id: 'console', anchor: 'console', label: 'Mixer console', detail: 'ECHO, REV, ATK shape the sound. MIC toggles voice. VOL row sets keys / bass / drums levels.' },
  { id: 'tape', anchor: 'tape', label: 'Tape deck', detail: 'Tap REC to record (reels spin while taping). Tap again to stop — then play back, delete, or submit.' },
  { id: 'mic', anchor: 'mic', label: 'Microphone', detail: 'Sing or hum when MIC is on. Mic off = little z’s float up — it’s napping.' },
  { id: 'beer', anchor: 'beer', label: 'Refreshments', detail: 'Studio vibes. Not interactive — just atmosphere.' },
  { id: 'smoke', anchor: 'smoke', label: 'Ashtray', detail: 'Fuming cigarette. Pure mood.' },
];

export function mountTour(
  studio: Studio3D,
  overlay: HTMLElement,
  onClose: () => void,
): { show: () => void; hide: () => void; tick: () => void } {
  let step = 0;
  let visible = false;

  const card = document.createElement('div');
  card.className = 'tour-card hidden';
  card.innerHTML = `
    <div class="tour-step-pill"></div>
    <h3 class="tour-title"></h3>
    <p class="tour-detail"></p>
    <div class="tour-nav">
      <button type="button" class="tour-btn" data-act="prev">← Back</button>
      <button type="button" class="tour-btn primary" data-act="next">Next →</button>
      <button type="button" class="tour-btn" data-act="close">Done</button>
    </div>
  `;
  overlay.appendChild(card);

  const arrow = document.createElement('div');
  arrow.className = 'tour-arrow hidden';
  arrow.innerHTML = '▼';
  overlay.appendChild(arrow);

  function renderStep(): void {
    const stop = TOUR_STOPS[step]!;
    card.querySelector('.tour-step-pill')!.textContent = `${step + 1} / ${TOUR_STOPS.length}`;
    card.querySelector('.tour-title')!.textContent = stop.label;
    card.querySelector('.tour-detail')!.textContent = stop.detail;
    card.querySelector('[data-act="prev"]')!.classList.toggle('hidden', step === 0);
    card.querySelector('[data-act="next"]')!.classList.toggle('hidden', step === TOUR_STOPS.length - 1);
  }

  card.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'prev' && step > 0) {
      step--;
      renderStep();
    } else if (act === 'next' && step < TOUR_STOPS.length - 1) {
      step++;
      renderStep();
    } else if (act === 'close') {
      hide();
      onClose();
    }
  });

  function show(): void {
    visible = true;
    step = 0;
    renderStep();
    overlay.classList.remove('hidden');
    card.classList.remove('hidden');
    tick();
  }

  function hide(): void {
    visible = false;
    overlay.classList.add('hidden');
    card.classList.add('hidden');
    arrow.classList.add('hidden');
  }

  function tick(): void {
    if (!visible) return;
    const stop = TOUR_STOPS[step]!;
    const pt = studio.projectAnchor(stop.anchor);
    if (!pt) {
      arrow.classList.add('hidden');
      return;
    }
    arrow.classList.remove('hidden');
    arrow.style.left = `${pt.x}px`;
    arrow.style.top = `${pt.y - 28}px`;
    card.style.left = `${Math.min(window.innerWidth - 280, Math.max(12, pt.x - 130))}px`;
    card.style.top = `${Math.min(window.innerHeight - 200, pt.y + 16)}px`;
  }

  return { show, hide, tick };
}
