/** Readable drum machine for mobile — pads + KIT/PAT controls. */

import type { DrumSound } from '../shared/api';

export type TouchDrumsOptions = {
  container: HTMLElement;
  onStepToggle: (sound: DrumSound, step: number) => void;
  onCtrl: (action: string, dir: 'up' | 'down') => void;
  onPatternPlayToggle: () => void;
  getKitLabel: () => string;
  getPatLabel: () => string;
  getPattern: () => Record<DrumSound, number[]>;
  getStepHighlight: () => number;
  getPatternPlaying: () => boolean;
  onClose?: () => void;
};

const SOUNDS: DrumSound[] = ['kick', 'snare', 'hat', 'clap'];
const ROW_LBL = ['K', 'S', 'H', 'C'];
const STEPS = 16;

export function mountTouchDrums(opts: TouchDrumsOptions): {
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  refresh: () => void;
} {
  const { container } = opts;
  let visible = false;

  container.innerHTML = `
    <div class="tp-head">
      <span>RHYTHM 808</span>
      <button type="button" class="tp-close" aria-label="Close drums">✕</button>
    </div>
    <div class="td-top">
      <div class="td-ctrl" data-action="kit">
        <span class="td-ctrl-label">KIT</span>
        <span class="td-ctrl-val" data-kit-val>—</span>
        <button type="button" class="tc-arr" data-dir="up">▲</button>
        <button type="button" class="tc-arr" data-dir="down">▼</button>
      </div>
      <div class="td-ctrl" data-action="pat">
        <span class="td-ctrl-label">PAT</span>
        <span class="td-ctrl-val" data-pat-val>—</span>
        <button type="button" class="tc-arr" data-dir="up">▲</button>
        <button type="button" class="tc-arr" data-dir="down">▼</button>
      </div>
    </div>
    <button type="button" class="td-play-btn" data-play-btn aria-label="Play pattern">▶ Play pattern</button>
    <div class="td-grid"></div>
  `;

  const grid = container.querySelector<HTMLElement>('.td-grid')!;
  const playBtn = container.querySelector<HTMLButtonElement>('[data-play-btn]')!;
  playBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onPatternPlayToggle();
    refresh();
  });
  container.querySelector<HTMLElement>('.tp-close')!.addEventListener('click', () => opts.onClose?.());
  const padEls: HTMLElement[][] = [];

  for (let row = 0; row < 4; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'td-row';
    const lbl = document.createElement('span');
    lbl.className = 'td-row-lbl';
    lbl.textContent = ROW_LBL[row]!;
    rowEl.appendChild(lbl);
    padEls[row] = [];
    for (let col = 0; col < STEPS; col++) {
      const pad = document.createElement('button');
      pad.type = 'button';
      pad.className = 'td-pad';
      pad.dataset.sound = SOUNDS[row]!;
      pad.dataset.step = String(col);
      rowEl.appendChild(pad);
      padEls[row]![col] = pad;
    }
    grid.appendChild(rowEl);
  }

  container.addEventListener('click', (ev) => {
    const arr = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tc-arr');
    if (arr) {
      const ctrl = arr.closest<HTMLElement>('.td-ctrl');
      const action = ctrl?.dataset.action;
      const dir = arr.dataset.dir as 'up' | 'down' | undefined;
      if (action && dir) {
        opts.onCtrl(action, dir);
        refresh();
      }
      return;
    }
    const pad = (ev.target as HTMLElement).closest<HTMLButtonElement>('.td-pad');
    if (!pad) return;
    const sound = pad.dataset.sound as DrumSound | undefined;
    const step = Number(pad.dataset.step);
    if (!sound || Number.isNaN(step)) return;
    opts.onStepToggle(sound, step);
    refresh();
  });

  function refresh(): void {
    const pat = opts.getPattern();
    const hi = opts.getStepHighlight();
    const playing = opts.getPatternPlaying();
    container.querySelector('[data-kit-val]')!.textContent = opts.getKitLabel();
    container.querySelector('[data-pat-val]')!.textContent = opts.getPatLabel();
    playBtn.textContent = playing ? '⏸ Pause pattern' : '▶ Play pattern';
    playBtn.setAttribute('aria-label', playing ? 'Pause pattern' : 'Play pattern');
    playBtn.classList.toggle('playing', playing);
    for (let row = 0; row < 4; row++) {
      const sound = SOUNDS[row]!;
      for (let col = 0; col < STEPS; col++) {
        const pad = padEls[row]![col]!;
        const on = pat[sound]?.[col] === 1;
        pad.classList.toggle('on', on);
        pad.classList.toggle('hi', col === hi);
      }
    }
  }

  function setVisible(v: boolean): void {
    visible = v;
    container.classList.toggle('hidden', !v);
    if (v) refresh();
  }

  return { setVisible, isVisible: () => visible, refresh };
}
