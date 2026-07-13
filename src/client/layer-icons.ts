export type LayerIconKind = 'drums' | 'keys' | 'bass' | 'vox' | 'mix';

const ICON_PATHS: Record<LayerIconKind, string> = {
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
  bass: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M14.8 3.2c1.8 1.1 2.8 3 2.6 5.1-.2 2.4-1.8 4.4-4 5.2l-1.2 7.6c-.2 1.2-1.2 2.1-2.4 2.1H8.8c-1.2 0-2.2-.9-2.4-2.1L5.2 13.5c-2.2-.8-3.8-2.8-4-5.2-.2-2.1.8-4 2.6-5.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="12" cy="8.2" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="11.2" r="1.1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="14.2" r="1.1" fill="currentColor" stroke="none"/>
    <path d="M9.2 20.8h5.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,
  vox: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="9" y="4" width="6" height="9.5" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M6.5 12.2a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 17.7v2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M8.2 20.5h7.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 7.2v4.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
    <path d="M10.4 9.4h3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
  </svg>`,
  mix: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 18V9M12 18V7M16 18v-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="8" cy="8.5" r="1.4" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="6.5" r="1.4" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="10.5" r="1.4" fill="currentColor" stroke="none"/>
  </svg>`,
};

export function layerIconHtml(kind: LayerIconKind, size: 'sm' | 'md' = 'md'): string {
  const sizeClass = size === 'sm' ? 'mt-icon sm' : 'mt-icon';
  return `<span class="${sizeClass} mt-icon-${kind}" role="img">${ICON_PATHS[kind]}</span>`;
}

export function mountLayerArmIcons(armRow: HTMLElement): void {
  armRow.querySelectorAll<HTMLButtonElement>('.mt-arm').forEach((btn) => {
    const arm = btn.dataset.arm as LayerIconKind | undefined;
    if (!arm || arm === 'mix') return;
    const labelText = btn.querySelector('span')?.textContent ?? '';
    btn.innerHTML = layerIconHtml(arm, 'md');
    const span = document.createElement('span');
    span.textContent = labelText;
    btn.appendChild(span);
  });
}
