import type { LayerArm } from './multitrack-ui';

export type ComposePanelMounts = {
  setConsoleVisible: (open: boolean) => void;
  setDrumsVisible: (open: boolean) => void;
  setKeysVisible: (open: boolean) => void;
  setKeysFocus: (layer: 'melody' | 'bass' | 'all') => void;
};

export type ComposePanelNodes = {
  console: HTMLElement;
  drums: HTMLElement;
  keys: HTMLElement;
  stack: HTMLElement;
  scroll: HTMLElement;
  toolbar: HTMLElement;
  composeRoot: HTMLElement;
};

function setNodeOpen(node: HTMLElement, open: boolean): void {
  node.classList.toggle('hidden', !open);
  node.setAttribute('aria-hidden', open ? 'false' : 'true');
}

export function openComposeArm(
  arm: LayerArm,
  nodes: ComposePanelNodes,
  mounts: ComposePanelMounts,
): void {
  const wantDrums = arm === 'drums';
  const wantKeys = arm === 'keys' || arm === 'bass';

  if (wantDrums) {
    setNodeOpen(nodes.drums, true);
    mounts.setDrumsVisible(true);
  }
  if (wantKeys) {
    setNodeOpen(nodes.keys, true);
    mounts.setKeysVisible(true);
    mounts.setKeysFocus(arm === 'keys' ? 'melody' : 'bass');
  }

  nodes.toolbar.classList.remove('hidden');
  nodes.composeRoot.dataset.activeArm = arm;
  nodes.stack.dataset.active = 'true';

  requestAnimationFrame(() => {
    const target = wantDrums ? nodes.drums : wantKeys ? nodes.keys : null;
    if (target && !target.classList.contains('hidden')) {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

export function closeComposeInstruments(nodes: ComposePanelNodes, mounts: ComposePanelMounts): void {
  setNodeOpen(nodes.console, false);
  setNodeOpen(nodes.drums, false);
  setNodeOpen(nodes.keys, false);
  mounts.setConsoleVisible(false);
  mounts.setDrumsVisible(false);
  mounts.setKeysVisible(false);
  mounts.setKeysFocus('all');
  delete nodes.composeRoot.dataset.activeArm;
  delete nodes.stack.dataset.active;
}
