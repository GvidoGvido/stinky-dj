/** Readable synth console for mobile — mirrors 3D ▲/▼ controls. */

export type TouchConsoleOptions = {
  container: HTMLElement;
  onCtrl: (action: string, dir: 'up' | 'down') => void;
  getLabels: () => Record<string, string>;
  onClose?: () => void;
};

type ControlDef = { action: string; label: string };

const MAIN_CONTROLS: ControlDef[] = [
  { action: 'syn', label: 'SYN' },
  { action: 'bass', label: 'BASS' },
  { action: 'bpm', label: 'BPM' },
  { action: 'drm', label: 'DRM' },
  { action: 'dub', label: 'DUB' },
  { action: 'lay', label: 'LAY' },
  { action: 'sust', label: 'SUST' },
];

const EFFECTS_CONTROLS: ControlDef[] = [
  { action: 'echo', label: 'ECHO' },
  { action: 'rev', label: 'REV' },
  { action: 'atk', label: 'ATK' },
];

const VOLUME_CONTROLS: ControlDef[] = [
  { action: 'leadvol', label: 'KEY' },
  { action: 'bassvol', label: 'BASS' },
  { action: 'drumvol', label: 'DRM' },
];

const ALL_CONTROLS = [...MAIN_CONTROLS, ...EFFECTS_CONTROLS, ...VOLUME_CONTROLS];

function buildCell(c: ControlDef): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'tc-cell';
  cell.dataset.action = c.action;
  cell.innerHTML = `
    <div class="tc-label">${c.label}</div>
    <div class="tc-value" data-value="${c.action}">—</div>
    <div class="tc-btns">
      <button type="button" class="tc-arr" data-dir="up" aria-label="${c.label} up">▲</button>
      <button type="button" class="tc-arr" data-dir="down" aria-label="${c.label} down">▼</button>
    </div>
  `;
  return cell;
}

function buildGroup(title: string, controls: ControlDef[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'tc-group';
  group.dataset.group = title.toLowerCase();

  const head = document.createElement('div');
  head.className = 'tc-group-head';
  head.innerHTML = `<span class="tc-group-title">${title}</span>`;

  const diagram = document.createElement('div');
  diagram.className = 'tc-branch-diagram';
  diagram.setAttribute('aria-hidden', 'true');
  diagram.style.setProperty('--tc-branch-cols', String(controls.length));
  const bar = document.createElement('div');
  bar.className = 'tc-branch-bar';
  diagram.appendChild(bar);
  for (let i = 0; i < controls.length; i++) {
    const drop = document.createElement('div');
    drop.className = 'tc-branch-drop';
    diagram.appendChild(drop);
  }
  head.appendChild(diagram);
  group.appendChild(head);

  const row = document.createElement('div');
  row.className = 'tc-group-row';
  row.style.setProperty('--tc-branch-cols', String(controls.length));
  for (const c of controls) row.appendChild(buildCell(c));
  group.appendChild(row);

  return group;
}

export function mountTouchConsole(opts: TouchConsoleOptions): {
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  refresh: () => void;
} {
  const { container } = opts;
  let visible = false;

  container.innerHTML = `
    <div class="tp-head">
      <span>TUNEBOX SYNTH</span>
      <button type="button" class="tp-close" aria-label="Close console">✕</button>
    </div>
    <div class="tc-main-grid"></div>
    <div class="tc-groups"></div>
  `;
  const mainGrid = container.querySelector<HTMLElement>('.tc-main-grid')!;
  const groups = container.querySelector<HTMLElement>('.tc-groups')!;
  container.querySelector<HTMLElement>('.tp-close')!.addEventListener('click', () => opts.onClose?.());

  for (const c of MAIN_CONTROLS) mainGrid.appendChild(buildCell(c));
  groups.appendChild(buildGroup('EFFECTS', EFFECTS_CONTROLS));
  groups.appendChild(buildGroup('VOLUME', VOLUME_CONTROLS));

  container.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tc-arr');
    if (!btn) return;
    const cell = btn.closest<HTMLElement>('.tc-cell');
    const action = cell?.dataset.action;
    const dir = btn.dataset.dir as 'up' | 'down' | undefined;
    if (!action || !dir) return;
    opts.onCtrl(action, dir);
    refresh();
  });

  function refresh(): void {
    const labels = opts.getLabels();
    for (const c of ALL_CONTROLS) {
      const node = container.querySelector<HTMLElement>(`[data-value="${c.action}"]`);
      if (node) node.textContent = labels[c.action] ?? '—';
    }
  }

  function setVisible(v: boolean): void {
    visible = v;
    container.classList.toggle('hidden', !v);
    if (v) refresh();
  }

  return { setVisible, isVisible: () => visible, refresh };
}
