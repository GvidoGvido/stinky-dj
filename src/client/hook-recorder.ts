import type { DrumHitEvent, DrumSound, NoteEvent } from '../shared/api';
import { MAX_RECORD_SEC } from '../shared/api';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Direct instrument capture — keys, bass, and drum hits. Voice is recorded separately. */
export type InstrumentTake = {
  notes: NoteEvent[];
  bassNotes: NoteEvent[];
  drumHits: DrumHitEvent[];
};

export class HookRecorder {
  private recording = false;
  private notes: NoteEvent[] = [];
  private bassNotes: NoteEvent[] = [];
  private drumHits: DrumHitEvent[] = [];
  private down = new Map<string, { midi: number; t: number; v: number; layer: 'melody' | 'bass' }>();

  constructor(
    /** Sample-accurate clock (seconds since REC start). */
    private getTimeSec: () => number,
  ) {}

  get active(): boolean {
    return this.recording;
  }

  timeSec(): number {
    if (!this.recording) return 0;
    return this.getTimeSec();
  }

  start(): void {
    this.recording = true;
    this.notes = [];
    this.bassNotes = [];
    this.drumHits = [];
    this.down.clear();
  }

  stop(): InstrumentTake {
    this.finalizeOpenNotes();
    this.recording = false;
    return {
      notes: this.notes,
      bassNotes: this.bassNotes,
      drumHits: this.drumHits,
    };
  }

  cancel(): void {
    this.recording = false;
    this.down.clear();
  }

  noteDown(slot: string, midi: number, v: number, layer: 'melody' | 'bass'): void {
    if (!this.recording) return;
    this.finalizeNote(slot);
    this.down.set(slot, { midi, t: this.timeSec(), v, layer });
  }

  noteUp(slot: string): void {
    if (!this.recording) return;
    this.finalizeNote(slot);
  }

  drumHit(sound: DrumSound, v = 0.9): void {
    if (!this.recording) return;
    this.drumHits.push({ t: this.timeSec(), sound, v: clamp(v, 0, 1) });
  }

  private finalizeNote(slot: string): void {
    const started = this.down.get(slot);
    if (!started) return;
    this.down.delete(slot);
    const d = clamp(this.timeSec() - started.t, 0.03, MAX_RECORD_SEC);
    const ev: NoteEvent = { t: started.t, d, n: started.midi, v: started.v };
    if (started.layer === 'bass') this.bassNotes.push(ev);
    else this.notes.push(ev);
  }

  private finalizeOpenNotes(): void {
    for (const slot of [...this.down.keys()]) this.finalizeNote(slot);
  }
}
