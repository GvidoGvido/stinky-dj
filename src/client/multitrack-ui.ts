import type { DrumHitEvent, HookData, NoteEvent, VoiceTrack } from '../shared/api';
import type { InstrumentTake } from './hook-recorder';
import { layerIconHtml, mountLayerArmIcons } from './layer-icons';

export type LayerArm = 'drums' | 'keys' | 'bass' | 'vox';

export type LayerKind = LayerArm | 'mix';

export const MAX_TRACK_LAYERS = 4;

export const TRACK_SLOTS: LayerArm[] = ['drums', 'keys', 'bass', 'vox'];

export type RecordedLayer = {
  id: string;
  kind: LayerKind;
  notes: NoteEvent[];
  bassNotes: NoteEvent[];
  /** @deprecated Legacy — drums are stored as `drumPattern`. */
  drumHits: DrumHitEvent[];
  /** Step pattern snapshot for drums layers (matches live sequencer playback). */
  drumPattern?: HookData['drum']['pattern'];
  voice?: VoiceTrack;
  durationSec: number;
};

export type MultitrackSession = {
  layers: RecordedLayer[];
  loopSec: number;
  pattern: HookData['drum']['pattern'];
};

const LAYER_META: Record<LayerKind, { label: string; css: string }> = {
  drums: { label: 'Drums', css: 'drums' },
  keys: { label: 'Keys', css: 'keys' },
  bass: { label: 'Bass', css: 'bass' },
  vox: { label: 'Voice', css: 'vox' },
  mix: { label: 'Mixed', css: 'mix' },
};

export function layerArmLabel(arm: LayerArm): string {
  return LAYER_META[arm].label.toUpperCase();
}

export function flattenSession(session: MultitrackSession): {
  notes: NoteEvent[];
  bassNotes: NoteEvent[];
  drumHits: DrumHitEvent[];
  voice?: VoiceTrack;
} {
  const notes: NoteEvent[] = [];
  const bassNotes: NoteEvent[] = [];
  const drumHits: DrumHitEvent[] = [];
  let voice: VoiceTrack | undefined;
  for (const layer of session.layers) {
    notes.push(...layer.notes);
    bassNotes.push(...layer.bassNotes);
    drumHits.push(...layer.drumHits);
    if (layer.voice) voice = layer.voice;
  }
  return {
    notes,
    bassNotes,
    drumHits,
    ...(voice ? { voice } : {}),
  };
}

export function sessionMaxEventSec(session: MultitrackSession): number {
  const flat = flattenSession(session);
  let maxT = 0;
  for (const n of flat.notes) maxT = Math.max(maxT, n.t + n.d);
  for (const n of flat.bassNotes) maxT = Math.max(maxT, n.t + n.d);
  for (const h of flat.drumHits) maxT = Math.max(maxT, h.t + 0.08);
  for (const layer of session.layers) {
    if (layer.kind === 'drums') maxT = Math.max(maxT, layer.durationSec);
  }
  return maxT;
}

export function classifyLayer(
  pass: InstrumentTake,
  voice: VoiceTrack | undefined,
  arm: LayerArm,
): LayerKind {
  if (voice && pass.notes.length === 0 && pass.bassNotes.length === 0 && pass.drumHits.length === 0) {
    return 'vox';
  }
  const hasKeys = pass.notes.length > 0;
  const hasBass = pass.bassNotes.length > 0;
  const hasDrums = pass.drumHits.length > 0 || arm === 'drums';
  const typeCount = (hasKeys ? 1 : 0) + (hasBass ? 1 : 0) + (hasDrums ? 1 : 0);
  if (typeCount === 1) {
    if (hasDrums) return 'drums';
    if (hasKeys) return 'keys';
    if (hasBass) return 'bass';
  }
  if (typeCount === 0 && voice) return 'vox';
  return typeCount > 1 ? 'mix' : arm;
}

export function suggestNextArm(session: MultitrackSession | null): LayerArm {
  if (!session) return 'drums';
  for (const arm of TRACK_SLOTS) {
    if (!findLayerForArm(session, arm)) return arm;
  }
  return 'keys';
}

export function findLayerForArm(session: MultitrackSession, arm: LayerArm): RecordedLayer | undefined {
  return session.layers.find((l) => l.kind === arm);
}

function layerSummary(layer: RecordedLayer): string {
  const bits: string[] = [];
  if (layer.notes.length) bits.push(`${layer.notes.length} keys`);
  if (layer.bassNotes.length) bits.push(`${layer.bassNotes.length} bass`);
  if (layer.kind === 'drums' || layer.drumPattern) {
    const pat = layer.drumPattern;
    if (pat) {
      let steps = 0;
      for (const s of ['kick', 'snare', 'hat', 'clap'] as const) {
        steps += pat[s]?.filter((v) => v).length ?? 0;
      }
      bits.push(steps > 0 ? `${steps} drum steps` : 'drums');
    } else if (layer.drumHits.length) {
      bits.push(`${layer.drumHits.length} drums`);
    } else {
      bits.push('drums');
    }
  }
  if (layer.voice) bits.push('voice');
  return bits.length ? bits.join(' · ') : `${layer.durationSec.toFixed(1)}s`;
}

export type MultitrackPanelOptions = {
  root: HTMLElement;
  loopLabel: HTMLElement;
  collapsedSummary: HTMLElement;
  collapseToggle: HTMLButtonElement;
  slotsGrid: HTMLElement;
  armRow: HTMLElement;
  submitBtn: HTMLButtonElement;
  playLoopBtn: HTMLButtonElement;
  onArm: (arm: LayerArm) => void;
  onRecordLayer: (arm: LayerArm) => void;
  onSubmit: () => void;
  onClear: () => void;
  onPlayLoop: () => void;
  onStopLoop: () => void;
  onReRecord: (arm: LayerArm) => void;
  onRemoveLayer: (id: string) => void;
  onPreviewLayer: (arm: LayerArm) => void;
  onToggleExpanded: () => void;
};

export function mountMultitrackPanel(opts: MultitrackPanelOptions): {
  setVisible: (v: boolean) => void;
  render: (args: {
    session: MultitrackSession | null;
    arm: LayerArm;
    recording: boolean;
    recordSec: number;
    loopPlaying: boolean;
    loopPaused: boolean;
    atMaxLayers: boolean;
    reRecordArm: LayerArm | null;
    expanded: boolean;
    previewPlayingArm: LayerArm | null;
    previewPausedArm: LayerArm | null;
    canSubmit: boolean;
  }) => void;
} {
  const {
    root,
    loopLabel,
    collapsedSummary,
    collapseToggle,
    slotsGrid,
    armRow,
    submitBtn,
    playLoopBtn,
  } = opts;

  armRow.querySelectorAll<HTMLButtonElement>('.mt-arm').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const arm = btn.dataset.arm as LayerArm | undefined;
      if (arm) opts.onArm(arm);
    });
  });
  mountLayerArmIcons(armRow);

  collapseToggle.addEventListener('click', () => opts.onToggleExpanded());
  playLoopBtn.addEventListener('click', () => opts.onPlayLoop());
  submitBtn.addEventListener('click', () => opts.onSubmit());
  root.querySelector<HTMLButtonElement>('#mt-clear')!.addEventListener('click', () => opts.onClear());

  function setVisible(v: boolean): void {
    root.classList.toggle('hidden', !v);
  }

  function renderCollapsedSummary(session: MultitrackSession | null): void {
    collapsedSummary.innerHTML = '';
    for (const slotArm of TRACK_SLOTS) {
      const meta = LAYER_META[slotArm];
      const filled = session ? !!findLayerForArm(session, slotArm) : false;
      const chip = document.createElement('span');
      chip.className = `mt-mini-slot mt-mini-slot-${meta.css}${filled ? ' filled' : ''}`;
      chip.innerHTML = layerIconHtml(slotArm, 'sm');
      chip.title = filled ? `${meta.label} recorded` : `${meta.label} empty`;
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onArm(slotArm);
      });
      collapsedSummary.appendChild(chip);
    }
  }

  function render(args: {
    session: MultitrackSession | null;
    arm: LayerArm;
    recording: boolean;
    recordSec: number;
    loopPlaying: boolean;
    loopPaused: boolean;
    atMaxLayers: boolean;
    reRecordArm: LayerArm | null;
    expanded: boolean;
    previewPlayingArm: LayerArm | null;
    previewPausedArm: LayerArm | null;
    canSubmit: boolean;
  }): void {
    const {
      session,
      arm,
      recording,
      recordSec,
      loopPlaying,
      loopPaused,
      atMaxLayers,
      reRecordArm,
      expanded,
      previewPlayingArm,
      previewPausedArm,
      canSubmit,
    } = args;

    root.classList.toggle('recording', recording);
    root.classList.toggle('expanded', expanded);
    root.classList.toggle('collapsed', !expanded);
    collapseToggle.disabled = recording;
    collapseToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    collapseToggle.title = recording
      ? 'Recording in progress'
      : expanded
        ? 'Hide layer controls'
        : 'Expand multitrack recorder';
    collapsedSummary.setAttribute('aria-hidden', expanded ? 'true' : 'false');

    armRow.querySelectorAll<HTMLButtonElement>('.mt-arm').forEach((btn) => {
      const a = btn.dataset.arm as LayerArm | undefined;
      const filled = a ? !!session && !!findLayerForArm(session, a) : false;
      btn.classList.toggle('active', a === arm);
      btn.classList.toggle('filled', filled);
      btn.setAttribute('aria-pressed', a === arm ? 'true' : 'false');
    });

    submitBtn.classList.toggle('hidden', !canSubmit);
    submitBtn.disabled = !canSubmit || recording;

    if (loopPlaying && !loopPaused) {
      playLoopBtn.textContent = '⏸ Pause';
      playLoopBtn.dataset.playing = 'true';
      playLoopBtn.setAttribute('aria-label', 'Pause mix playback');
      playLoopBtn.disabled = false;
    } else if (loopPlaying && loopPaused) {
      playLoopBtn.textContent = '▶ Play';
      playLoopBtn.dataset.playing = 'paused';
      playLoopBtn.setAttribute('aria-label', 'Resume mix playback');
      playLoopBtn.disabled = false;
    } else {
      playLoopBtn.textContent = '▶ Play';
      playLoopBtn.dataset.playing = 'false';
      playLoopBtn.disabled = !session || session.layers.length === 0;
      playLoopBtn.setAttribute('aria-label', 'Play all recorded layers');
    }

    const filledCount = session?.layers.length ?? 0;
    if (recording) {
      loopLabel.textContent = `● Recording ${LAYER_META[arm].label} · ${recordSec.toFixed(1)}s`;
    } else if (!expanded) {
      loopLabel.textContent =
        filledCount > 0
          ? `${filledCount} layer${filledCount === 1 ? '' : 's'} recorded · tap to expand`
          : 'Tap to expand · up to 4 layers';
    } else if (!session || filledCount === 0) {
      loopLabel.textContent = 'Choose a layer, then tap ● Record on that track';
    } else {
      loopLabel.textContent = `${filledCount}/${MAX_TRACK_LAYERS} layers · ${session.loopSec.toFixed(1)}s total`;
    }
    renderCollapsedSummary(session);

    if (!expanded) {
      slotsGrid.innerHTML = '';
      return;
    }

    slotsGrid.innerHTML = '';
    for (const slotArm of TRACK_SLOTS) {
      const meta = LAYER_META[slotArm];
      const layer = session ? findLayerForArm(session, slotArm) : undefined;
      const isActive = arm === slotArm;
      const isReRecord = reRecordArm === slotArm;
      const isRecordingNow = recording && arm === slotArm;
      const isPlaying = previewPlayingArm === slotArm;
      const isPaused = previewPausedArm === slotArm;

      const card = document.createElement('div');
      card.className = `mt-slot mt-slot-${meta.css}${layer ? ' has-layer' : ' empty'}${isActive ? ' active' : ''}${isReRecord ? ' re-recording' : ''}${isRecordingNow ? ' recording-now' : ''}`;
      card.dataset.slotArm = slotArm;

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'mt-slot-head';
      head.disabled = recording;
      head.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      head.setAttribute('aria-label', `Select ${meta.label}`);
      head.innerHTML = `${layerIconHtml(slotArm, 'md')}<span class="mt-slot-name">${meta.label}</span>`;
      head.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!recording) opts.onArm(slotArm);
      });

      const body = document.createElement('div');
      body.className = 'mt-slot-body';
      if (layer) {
        body.textContent = isRecordingNow ? 'Recording now…' : layerSummary(layer);
      } else if (isActive) {
        body.textContent = isRecordingNow ? 'Recording now…' : 'Selected — tap ● Record below';
      } else {
        body.textContent = 'Tap to select this layer';
      }

      const actions = document.createElement('div');
      actions.className = 'mt-slot-actions';

      if (isActive) {
        const rec = document.createElement('button');
        rec.type = 'button';
        rec.className = `mt-slot-btn record-layer${isRecordingNow ? ' recording' : ''}`;
        if (isRecordingNow) {
          rec.textContent = `■ Stop (${recordSec.toFixed(1)}s)`;
          rec.title = 'Stop and save this layer';
        } else {
          rec.textContent = reRecordArm === slotArm ? '● Re-record' : '● Record';
          rec.title = `Record ${meta.label}`;
          rec.disabled = atMaxLayers && !layer && !reRecordArm;
        }
        rec.setAttribute('aria-label', isRecordingNow ? `Stop ${meta.label} recording` : `Record ${meta.label}`);
        rec.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onRecordLayer(slotArm);
        });
        actions.appendChild(rec);
      }

      if (layer) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = `mt-slot-btn play${isPlaying ? ' playing' : ''}${isPaused ? ' paused' : ''}`;
        play.textContent = isPlaying ? '⏸' : '▶';
        play.title = isPlaying ? `Pause ${meta.label}` : isPaused ? `Resume ${meta.label}` : `Play ${meta.label}`;
        play.setAttribute(
          'aria-label',
          isPlaying ? `Pause ${meta.label}` : isPaused ? `Resume ${meta.label}` : `Play ${meta.label}`,
        );
        play.disabled = recording;
        play.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onPreviewLayer(slotArm);
        });

        const redo = document.createElement('button');
        redo.type = 'button';
        redo.className = 'mt-slot-btn redo';
        redo.textContent = '↻';
        redo.title = 'Re-record this layer';
        redo.setAttribute('aria-label', `Re-record ${meta.label}`);
        redo.disabled = recording;
        redo.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onReRecord(slotArm);
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mt-slot-btn remove';
        remove.textContent = '✕';
        remove.title = 'Remove this layer';
        remove.setAttribute('aria-label', `Remove ${meta.label}`);
        remove.disabled = recording;
        remove.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onRemoveLayer(layer.id);
        });

        actions.appendChild(play);
        actions.appendChild(redo);
        actions.appendChild(remove);
      } else if (!isActive) {
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'mt-slot-btn add';
        select.textContent = '+';
        select.title = `Select ${meta.label}`;
        select.setAttribute('aria-label', `Select ${meta.label}`);
        select.disabled = recording;
        select.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onArm(slotArm);
        });
        actions.appendChild(select);
      }

      card.appendChild(head);
      card.appendChild(body);
      card.appendChild(actions);
      card.addEventListener('click', (ev) => {
        if (recording) return;
        if ((ev.target as HTMLElement).closest('.mt-slot-btn')) return;
        if ((ev.target as HTMLElement).closest('.mt-slot-head')) return;
        opts.onArm(slotArm);
      });
      slotsGrid.appendChild(card);
    }
  }

  return { setVisible, render };
}
