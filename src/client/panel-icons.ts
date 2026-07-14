export type PanelIconKind = 'console' | 'drums' | 'keys';

const ICON_PATHS: Record<PanelIconKind, string> = {
  console: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="2.5" y="4" width="19" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="8" cy="6.2" r="1.15" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="6.2" r="1.15" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="6.2" r="1.15" fill="currentColor" stroke="none"/>
    <line x1="8" y1="8" x2="8" y2="17.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity="0.45"/>
    <line x1="12" y1="8" x2="12" y2="17.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity="0.45"/>
    <line x1="16" y1="8" x2="16" y2="17.5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity="0.45"/>
    <rect x="7" y="10.5" width="2" height="2.6" rx="0.35" fill="currentColor" stroke="none"/>
    <rect x="11" y="13" width="2" height="2.6" rx="0.35" fill="currentColor" stroke="none"/>
    <rect x="15" y="11.5" width="2" height="2.6" rx="0.35" fill="currentColor" stroke="none"/>
    <rect x="4.5" y="17.8" width="15" height="1.4" rx="0.35" fill="currentColor" stroke="none" opacity="0.55"/>
  </svg>`,
  drums: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="13" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="12" cy="13" r="2.25" fill="currentColor" stroke="none"/>
    <path d="M6.2 4.4 9.6 9.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M17.8 4.4 14.4 9.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M5.5 13h13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.45"/>
  </svg>`,
  keys: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="8" width="18" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M7 8v10M11 8v10M15 8v10M19 8v10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <rect x="8.2" y="8" width="2.1" height="6.2" rx="0.4" fill="currentColor" stroke="none"/>
    <rect x="12.2" y="8" width="2.1" height="6.2" rx="0.4" fill="currentColor" stroke="none"/>
    <rect x="16.2" y="8" width="2.1" height="6.2" rx="0.4" fill="currentColor" stroke="none"/>
  </svg>`,
};

export function panelIconHtml(kind: PanelIconKind): string {
  return `<span class="panel-toggle-icon panel-icon-${kind}">${ICON_PATHS[kind]}</span>`;
}

export function mountPanelToggleIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLButtonElement>('.panel-toggle[data-panel-icon]').forEach((btn) => {
    if (btn.querySelector('.panel-toggle-icon')) return;
    const kind = btn.dataset.panelIcon as PanelIconKind | undefined;
    if (!kind) return;
    btn.insertAdjacentHTML('afterbegin', panelIconHtml(kind));
  });
}
