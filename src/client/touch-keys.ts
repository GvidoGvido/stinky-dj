/**
 * Bottom-docked touch keyboard for mobile play. Big flat targets, multi-touch,
 * glide between keys, and octave shift. Feeds the same note callbacks as the
 * 3D keys, so recording captures it identically.
 */

type Layer = 'melody' | 'bass';

export type TouchKeysOptions = {
  container: HTMLElement;
  onNoteDown: (midi: number, id: number, layer: Layer) => void;
  onNoteUp: (midi: number, id: number, layer: Layer) => void;
  onClose?: () => void;
};

// Two octaves of white keys (C..C), matching the 3D keybed
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
const BLACK_DEFS = [
  { semi: 1, after: 0 },
  { semi: 3, after: 1 },
  { semi: 6, after: 3 },
  { semi: 8, after: 4 },
  { semi: 10, after: 5 },
  { semi: 13, after: 7 },
  { semi: 15, after: 8 },
  { semi: 18, after: 10 },
  { semi: 20, after: 11 },
  { semi: 22, after: 12 },
];
const BASS_BASE = 36;
const OCTAVE_BASES = [48, 60, 72]; // C3, C4, C5
const INPUT_ID_OFFSET = 9000;
const MOUSE_INPUT_ID = INPUT_ID_OFFSET + 999;

export function mountTouchKeys(opts: TouchKeysOptions): {
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  setFocusLayer: (layer: 'melody' | 'bass' | 'all') => void;
  releaseAll: () => void;
} {
  const { container } = opts;
  let octaveIdx = 1; // C4 default
  let visible = false;

  container.innerHTML = `
    <div class="tk-head">
      <button type="button" class="tk-btn" data-tk="oct-down">OCT −</button>
      <span class="tk-oct-label">C4</span>
      <button type="button" class="tk-btn" data-tk="oct-up">OCT +</button>
      <span class="tk-hint">slide to glide</span>
      <button type="button" class="tp-close tk-close" aria-label="Close keys">✕</button>
    </div>
    <div class="tk-piano"></div>
    <div class="tk-bass"></div>
  `;

  const piano = container.querySelector<HTMLElement>('.tk-piano')!;
  const bassRow = container.querySelector<HTMLElement>('.tk-bass')!;
  const octLabel = container.querySelector<HTMLElement>('.tk-oct-label')!;
  const playSurfaces = [piano, bassRow];

  container.querySelector<HTMLElement>('.tk-close')!.addEventListener('click', () => opts.onClose?.());

  function buildKeys(): void {
    const base = OCTAVE_BASES[octaveIdx]!;
    octLabel.textContent = `C${octaveIdx + 3}`;
    setHoverKey(null);
    piano.innerHTML = '';
    for (const semi of WHITE_SEMIS) {
      const k = document.createElement('div');
      k.className = 'tk-white';
      k.dataset.midi = String(base + semi);
      k.dataset.layer = 'melody';
      piano.appendChild(k);
    }
    for (const b of BLACK_DEFS) {
      const k = document.createElement('div');
      k.className = 'tk-black';
      k.dataset.midi = String(base + b.semi);
      k.dataset.layer = 'melody';
      k.style.left = `${((b.after + 1) / WHITE_SEMIS.length) * 100 - 3.2}%`;
      piano.appendChild(k);
    }
    bassRow.innerHTML = '';
    for (let i = 0; i < 13; i++) {
      const k = document.createElement('div');
      k.className = `tk-bass-key${[1, 3, 6, 8, 10].includes(i) ? ' sharp' : ''}`;
      k.dataset.midi = String(BASS_BASE + i);
      k.dataset.layer = 'bass';
      bassRow.appendChild(k);
    }
  }

  const active = new Map<number, HTMLElement>();
  const keyHoldCount = new Map<HTMLElement, number>();
  let hoverKey: HTMLElement | null = null;
  let globalMoveBound = false;
  const scrollParent = container.closest<HTMLElement>('.mobile-compose-scroll');

  function inputIdForPointer(ev: PointerEvent): number {
    return ev.pointerType === 'mouse' ? MOUSE_INPUT_ID : ev.pointerId;
  }

  function noteInputId(raw: number): number {
    return raw + INPUT_ID_OFFSET;
  }

  function lockComposeScroll(): void {
    if (scrollParent) scrollParent.style.overflow = 'hidden';
  }

  function unlockComposeScroll(): void {
    if (scrollParent && active.size === 0) scrollParent.style.overflow = '';
  }

  function addKeyActive(key: HTMLElement): void {
    const count = (keyHoldCount.get(key) ?? 0) + 1;
    keyHoldCount.set(key, count);
    key.classList.add('active');
  }

  function removeKeyActive(key: HTMLElement): void {
    const count = (keyHoldCount.get(key) ?? 1) - 1;
    if (count <= 0) {
      keyHoldCount.delete(key);
      key.classList.remove('active');
    } else {
      keyHoldCount.set(key, count);
    }
  }

  function clearKeyActives(): void {
    for (const key of keyHoldCount.keys()) key.classList.remove('active');
    keyHoldCount.clear();
  }

  function setHoverKey(key: HTMLElement | null): void {
    if (hoverKey === key) return;
    hoverKey?.classList.remove('hover');
    hoverKey = key;
    hoverKey?.classList.add('hover');
  }

  function isKeyPlayable(key: HTMLElement): boolean {
    let node: HTMLElement | null = key;
    while (node && node !== container) {
      if (getComputedStyle(node).pointerEvents === 'none') return false;
      node = node.parentElement;
    }
    return true;
  }

  /** Hit-test via bounding boxes — reliable for glide (gaps, overlays, capture). */
  function keyFromPoint(x: number, y: number): HTMLElement | null {
    const keys = container.querySelectorAll<HTMLElement>('[data-midi]');
    for (const k of keys) {
      if (!k.classList.contains('tk-black') || !isKeyPlayable(k)) continue;
      const r = k.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return k;
    }
    for (const k of keys) {
      if (k.classList.contains('tk-black') || !isKeyPlayable(k)) continue;
      const r = k.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return k;
    }
    return null;
  }

  function externalInputId(inputId: number): number {
    return inputId === MOUSE_INPUT_ID ? MOUSE_INPUT_ID : noteInputId(inputId);
  }

  function press(inputId: number, key: HTMLElement): void {
    if (active.has(inputId)) release(inputId);
    addKeyActive(key);
    active.set(inputId, key);
    opts.onNoteDown(Number(key.dataset.midi), externalInputId(inputId), key.dataset.layer as Layer);
  }

  function release(inputId: number): void {
    const key = active.get(inputId);
    if (!key) return;
    removeKeyActive(key);
    active.delete(inputId);
    opts.onNoteUp(Number(key.dataset.midi), externalInputId(inputId), key.dataset.layer as Layer);
  }

  function glideTo(inputId: number, x: number, y: number): void {
    if (!active.has(inputId)) return;
    const key = keyFromPoint(x, y);
    const held = active.get(inputId)!;
    if (!key || key === held) return;
    release(inputId);
    press(inputId, key);
  }

  function releaseAll(): void {
    for (const id of [...active.keys()]) release(id);
    clearKeyActives();
    unbindGlobalMove();
    unlockComposeScroll();
  }

  const onGlobalPointerMove = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    const inputId = inputIdForPointer(ev);
    if (!active.has(inputId)) return;
    ev.preventDefault();
    glideTo(inputId, ev.clientX, ev.clientY);
  };

  const onGlobalPointerEnd = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    const inputId = inputIdForPointer(ev);
    if (!active.has(inputId)) return;
    release(inputId);
    unbindGlobalMove();
    unlockComposeScroll();
  };

  const onGlobalTouchMove = (ev: TouchEvent): void => {
    if (active.size === 0) return;
    ev.preventDefault();
    for (const touch of ev.touches) {
      glideTo(touch.identifier, touch.clientX, touch.clientY);
    }
  };

  const onGlobalTouchEnd = (ev: TouchEvent): void => {
    for (const touch of ev.changedTouches) {
      release(touch.identifier);
    }
    unbindGlobalMove();
    unlockComposeScroll();
  };

  const bindGlobalMove = (): void => {
    if (globalMoveBound) return;
    document.addEventListener('pointermove', onGlobalPointerMove, { passive: false, capture: true });
    document.addEventListener('pointerup', onGlobalPointerEnd, { capture: true });
    document.addEventListener('pointercancel', onGlobalPointerEnd, { capture: true });
    document.addEventListener('touchmove', onGlobalTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onGlobalTouchEnd, { capture: true });
    document.addEventListener('touchcancel', onGlobalTouchEnd, { capture: true });
    globalMoveBound = true;
  };

  const unbindGlobalMove = (): void => {
    if (!globalMoveBound || active.size > 0) return;
    document.removeEventListener('pointermove', onGlobalPointerMove, { capture: true });
    document.removeEventListener('pointerup', onGlobalPointerEnd, { capture: true });
    document.removeEventListener('pointercancel', onGlobalPointerEnd, { capture: true });
    document.removeEventListener('touchmove', onGlobalTouchMove, { capture: true });
    document.removeEventListener('touchend', onGlobalTouchEnd, { capture: true });
    document.removeEventListener('touchcancel', onGlobalTouchEnd, { capture: true });
    globalMoveBound = false;
  };

  const beginAt = (inputId: number, x: number, y: number, ev: Event): void => {
    if (document.body.classList.contains('instruments-blocked')) return;
    const key = keyFromPoint(x, y);
    if (!key) return;
    ev.preventDefault();
    ev.stopPropagation();
    setHoverKey(null);
    press(inputId, key);
    bindGlobalMove();
    lockComposeScroll();
    if (ev instanceof PointerEvent) {
      try {
        (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const endPointer = (ev: PointerEvent): void => {
    if (ev.pointerType === 'touch') return;
    const inputId = inputIdForPointer(ev);
    if (!active.has(inputId)) return;
    release(inputId);
    unbindGlobalMove();
    unlockComposeScroll();
  };

  for (const surface of playSurfaces) {
    surface.addEventListener(
      'touchstart',
      (ev) => {
        for (const touch of ev.changedTouches) {
          beginAt(touch.identifier, touch.clientX, touch.clientY, ev);
        }
      },
      { passive: false },
    );

    surface.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch') return;
      beginAt(inputIdForPointer(ev), ev.clientX, ev.clientY, ev);
    });

    surface.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch') return;
      const inputId = inputIdForPointer(ev);
      if (active.has(inputId)) return;
      setHoverKey(keyFromPoint(ev.clientX, ev.clientY));
    });

    surface.addEventListener('pointerleave', () => setHoverKey(null));
    surface.addEventListener('pointerup', endPointer);
    surface.addEventListener('pointercancel', endPointer);
  }

  buildKeys();

  container.querySelector('[data-tk="oct-down"]')!.addEventListener('click', () => {
    if (octaveIdx === 0) return;
    releaseAll();
    octaveIdx--;
    buildKeys();
  });
  container.querySelector('[data-tk="oct-up"]')!.addEventListener('click', () => {
    if (octaveIdx === OCTAVE_BASES.length - 1) return;
    releaseAll();
    octaveIdx++;
    buildKeys();
  });

  function setFocusLayer(layer: 'melody' | 'bass' | 'all'): void {
    container.classList.remove('focus-melody', 'focus-bass', 'focus-all');
    container.classList.add(layer === 'all' ? 'focus-all' : `focus-${layer}`);
  }

  function setVisible(v: boolean): void {
    visible = v;
    if (!v) {
      releaseAll();
      setFocusLayer('all');
      setHoverKey(null);
    }
    container.classList.toggle('hidden', !v);
  }

  return { setVisible, isVisible: () => visible, setFocusLayer, releaseAll };
}
