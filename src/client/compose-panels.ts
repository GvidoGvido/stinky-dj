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
  setNodeOpen(nodes.drums, arm === 'drums');
  setNodeOpen(nodes.keys, arm === 'keys' || arm === 'bass');
  nodes.toolbar.classList.remove('hidden');

  mounts.setDrumsVisible(arm === 'drums');
  mounts.setKeysVisible(arm === 'keys' || arm === 'bass');
  mounts.setKeysFocus(arm === 'keys' ? 'melody' : arm === 'bass' ? 'bass' : 'all');

  nodes.composeRoot.dataset.activeArm = arm;
  nodes.stack.dataset.active = 'true';

  requestAnimationFrame(() => {
    const target =
      arm === 'drums' ? nodes.drums : arm === 'keys' || arm === 'bass' ? nodes.keys : null;
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
