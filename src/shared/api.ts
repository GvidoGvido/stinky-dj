export type PlayerState = {
  username: string;
  /** Hook id for the current round (if already submitted). */
  myHookId: string | null;
  /** The hook id this user voted for (if already voted). */
  myVoteHookId: string | null;
};

export type { BassPreset, DrumKit, SynthPreset } from './synth';
import type { BassPreset, DrumKit, SynthPreset } from './synth';

export type MixSettings = {
  /** Delay wet mix 0..1 */
  echo: number;
  /** Reverb wet mix 0..1 */
  reverb: number;
  /** Envelope attack scale 0..1 (0 = snappy, 1 = soft) */
  attack: number;
  /** Vocal level 0..1 */
  vox: number;
};

export type VoiceTrack = {
  /** Base64-encoded audio (webm/opus). */
  data: string;
  mime: string;
};

export type DrumSound = 'kick' | 'snare' | 'hat' | 'clap';

export type DrumHitEvent = {
  /** Seconds from recording start. */
  t: number;
  sound: DrumSound;
  /** Velocity 0..1 */
  v?: number;
};

export type DrumPattern = Record<DrumSound, number[]>; // 0/1 steps, length = stepsPerBar

export type NoteEvent = {
  /** Seconds from recording start. */
  t: number;
  /** Seconds duration. */
  d: number;
  /** MIDI note number, e.g. 60 = C4. */
  n: number;
  /** Velocity 0..1 */
  v: number;
  /** @deprecated Legacy — bass notes now live in `bass.notes`. */
  bass?: boolean;
};

export type HookData = {
  /** User-chosen track name shown in the hooks list (max 40 chars). */
  title?: string;
  bpm: number;
  stepsPerBar: number; // e.g. 16
  bars: number; // e.g. 2, 4
  synth: {
    preset: SynthPreset;
    detune: number; // cents
    tone: number; // 0..1 (filter-ish)
    gain?: number; // 0..1 lead/piano volume
  };
  /** Separate bass line (recorded via lower keys / Z-row). */
  bass: {
    preset: BassPreset;
    gain: number; // 0..1
    notes: NoteEvent[];
  };
  drum: {
    swing: number; // 0..0.5
    pattern: DrumPattern;
    gain: number; // 0..1
    kit?: DrumKit;
    /** Timestamped hits captured during recording (preferred for playback). */
    hits?: DrumHitEvent[];
  };
  mix?: MixSettings;
  voice?: VoiceTrack;
  notes: NoteEvent[];
  /** Multitrack / full-take length in seconds (drives drum loop in review). */
  recordedSec?: number;
};

export type HookPreview = {
  hookId: string;
  authorUsername: string;
  /** Display title from the submitted hook, if set. */
  title?: string;
  upvotes: number;
  isMine: boolean;
  /** Whether *this user* voted for this submission. */
  isVoted: boolean;
};

export type RevealState = {
  roundId: string;
  topUpvotes: number;
  coWinners: Array<{
    hookId: string;
    authorUsername: string;
    upvotes: number;
  }>;
};

export type RoundState = {
  roundId: string;
  seed: number;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  now: RoundState;
  prevReveal: RevealState | null;
  player: PlayerState;
  hooks: HookPreview[];
};

export type SubmitHookRequest = {
  hook: HookData;
};

export type VoteRequest = {
  hookId: string;
};

export type ActionResponse = {
  type: 'action';
  postId?: string;
  player: PlayerState;
  hooks: HookPreview[];
  /** Only true for a successful record+submit, to trigger thumbs-up + applause. */
  applause?: boolean;
  /** Non-null when the previous day was revealed as part of this load. */
  prevReveal: RevealState | null;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};

/** Maximum hook recording length in seconds. */
export const MAX_RECORD_SEC = 60;

/** Max base64 chars for stored voice audio (~1.8MB binary — full 60s @192kbps Opus). */
export const VOICE_MAX_B64 = 2_400_000;
