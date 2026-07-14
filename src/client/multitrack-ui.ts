import type { DrumHitEvent, HookData, NoteEvent, VoiceTrack } from '../shared/api';
import type { InstrumentTake } from './hook-recorder';
import { layerIconHtml, mountLayerArmIcons } from './layer-icons';

export type LayerArm = 'drums' | 'keys' | 'bass';

export type LayerKind = LayerArm | 'mix' | 'vox';

export const MAX_TRACK_LAYERS = 3;

export const TRACK_SLOTS: LayerArm[] = ['drums', 'keys', 'bass'];

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

export function classifyLayer(pass: InstrumentTake, arm: LayerArm): LayerKind {
  const hasKeys = pass.notes.length > 0;
  const hasBass = pass.bassNotes.length > 0;
  const hasDrums = pass.drumHits.length > 0 || arm === 'drums';
  const typeCount = (hasKeys ? 1 : 0) + (hasBass ? 1 : 0) + (hasDrums ? 1 : 0);
  if (typeCount === 1) {
    if (hasDrums) return 'drums';
    if (hasKeys) return 'keys';
    if (hasBass) return 'bass';
  }
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
  if (layer.voice) bits.push('legacy voice');
  return bits.length ? bits.join(' · ') : `${layer.durationSec.toFixed(1)}s`;
}

export type BackingTrackChip = {
  arm: LayerArm;
  trackNum: number;
  label: string;
  status: 'playing' | 'paused' | 'muted' | 'idle';
};

export type MultitrackPanelOptions = {
  root: HTMLElement;
  loopLabel: HTMLElement;
  collapsedSummary: HTMLElement;
  collapseToggle: HTMLButtonElement;
  backingStrip: HTMLElement;
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
  onToggleBackingMute: (arm: LayerArm) => void;
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
    previewPlayingArms: LayerArm[];
    previewPausedArms: LayerArm[];
    canSubmit: boolean;
    backingTracks: BackingTrackChip[];
    showBackingStrip: boolean;
  }) => void;
} {
  const {
    root,
    loopLabel,
    collapsedSummary,
    collapseToggle,
    backingStrip,
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
  const closeBtn = root.querySelector<HTMLButtonElement>('#mt-close-btn')!;
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    opts.onToggleExpanded();
  });
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
    previewPlayingArms: LayerArm[];
    previewPausedArms: LayerArm[];
    canSubmit: boolean;
    backingTracks: BackingTrackChip[];
    showBackingStrip: boolean;
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
      previewPlayingArms,
      previewPausedArms,
      canSubmit,
      backingTracks,
      showBackingStrip,
    } = args;

    root.classList.toggle('recording', recording);
    root.classList.toggle('expanded', expanded);
    root.classList.toggle('collapsed', !expanded);
    collapseToggle.disabled = recording;
    closeBtn.disabled = recording || !expanded;
    closeBtn.setAttribute('aria-hidden', expanded ? 'false' : 'true');
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

    const backingCount = backingTracks.length;
    const audibleBackingCount = backingTracks.filter((t) => t.status !== 'muted').length;

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
      playLoopBtn.disabled = audibleBackingCount === 0;
      playLoopBtn.setAttribute('aria-label', recording ? 'Play backing tracks while recording' : 'Play all recorded layers');
    }

    const filledCount = session?.layers.length ?? 0;
    if (recording) {
      const mutedCount = backingTracks.filter((t) => t.status === 'muted').length;
      loopLabel.textContent =
        backingCount > 0
          ? mutedCount > 0
            ? `● Recording ${LAYER_META[arm].label} · ${recordSec.toFixed(1)}s · ${audibleBackingCount}/${backingCount} backing`
            : `● Recording ${LAYER_META[arm].label} · ${recordSec.toFixed(1)}s · ${backingCount} backing`
          : `● Recording ${LAYER_META[arm].label} · ${recordSec.toFixed(1)}s`;
    } else if (!expanded) {
      loopLabel.textContent =
        filledCount > 0
          ? `${filledCount} layer${filledCount === 1 ? '' : 's'} recorded · tap to expand`
          : 'Tap to expand · up to 3 layers';
    } else if (!session || filledCount === 0) {
      loopLabel.textContent = 'Choose a layer, then tap ● Record · ▶ Play hears all layers together';
    } else {
      loopLabel.textContent = `${filledCount}/${MAX_TRACK_LAYERS} layers · ${session.loopSec.toFixed(1)}s total`;
    }
    renderCollapsedSummary(session);

    const renderBackingStrip = (): void => {
      backingStrip.classList.toggle('hidden', !showBackingStrip || backingTracks.length === 0);
      backingStrip.innerHTML = '';
      if (!showBackingStrip || backingTracks.length === 0) return;

      const head = document.createElement('div');
      head.className = 'mt-backing-head';
      const title = document.createElement('div');
      title.className = 'mt-backing-title';
      title.textContent = recording ? 'Backing while you record' : 'Layer mix';
      const hint = document.createElement('div');
      hint.className = 'mt-backing-hint';
      hint.textContent = recording ? '⏸ mutes from the mix' : 'Per-track mute';
      head.appendChild(title);
      head.appendChild(hint);
      backingStrip.appendChild(head);

      const chips = document.createElement('div');
      chips.className = 'mt-backing-chips';
      for (const track of backingTracks) {
        const chip = document.createElement('div');
        chip.className = `mt-backing-chip ${track.status}`;
        chip.dataset.arm = track.arm;

        const num = document.createElement('span');
        num.className = 'mt-backing-chip-num';
        num.textContent = `Track ${track.trackNum}`;

        const label = document.createElement('span');
        label.className = 'mt-backing-chip-label';
        label.textContent = track.label;

        const status = document.createElement('span');
        status.className = 'mt-backing-chip-status';
        status.textContent =
          track.status === 'playing'
            ? 'Playing'
            : track.status === 'paused'
              ? 'Paused'
              : track.status === 'muted'
                ? 'Muted'
                : 'Ready';

        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'mt-backing-chip-btn';
        if (track.status === 'muted') {
          muteBtn.textContent = '▶';
          muteBtn.title = `Unmute ${track.label}`;
          muteBtn.setAttribute('aria-label', `Unmute ${track.label} in the mix`);
        } else {
          muteBtn.textContent = '⏸';
          muteBtn.title = `Mute ${track.label} from the mix`;
          muteBtn.setAttribute('aria-label', `Mute ${track.label} from the mix`);
        }
        muteBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          opts.onToggleBackingMute(track.arm);
        });

        chip.appendChild(num);
        chip.appendChild(label);
        chip.appendChild(status);
        chip.appendChild(muteBtn);
        chips.appendChild(chip);
      }
      backingStrip.appendChild(chips);
    };

    const compactBacking = recording && showBackingStrip && backingTracks.length > 0;

    if (!expanded) {
      slotsGrid.innerHTML = '';
      if (compactBacking) {
        renderBackingStrip();
      } else {
        backingStrip.classList.add('hidden');
        backingStrip.innerHTML = '';
      }
      return;
    }

    renderBackingStrip();

    slotsGrid.innerHTML = '';
    for (const slotArm of TRACK_SLOTS) {
      const meta = LAYER_META[slotArm];
      const layer = session ? findLayerForArm(session, slotArm) : undefined;
      const isActive = arm === slotArm;
      const isReRecord = reRecordArm === slotArm;
      const isRecordingNow = recording && arm === slotArm;
      const isPlaying = previewPlayingArms.includes(slotArm);
      const isPaused = previewPausedArms.includes(slotArm);

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

      if (layer && !isRecordingNow) {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = `mt-slot-btn play${isPlaying ? ' playing' : ''}${isPaused ? ' paused' : ''}`;
        play.textContent = isPlaying ? '⏸' : '▶';
        play.title = isPlaying ? `Pause ${meta.label}` : isPaused ? `Resume ${meta.label}` : `Play ${meta.label}`;
        play.setAttribute(
          'aria-label',
          isPlaying ? `Pause ${meta.label}` : isPaused ? `Resume ${meta.label}` : `Play ${meta.label}`,
        );
        play.disabled = false;
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
        remove.disabled = isRecordingNow;
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

      if (actions.childNodes.length) {
        card.appendChild(actions);
      }

      if (isActive) {
        const recRow = document.createElement('div');
        recRow.className = 'mt-slot-actions mt-slot-actions-record';
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
        recRow.appendChild(rec);
        card.appendChild(recRow);
      }

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
