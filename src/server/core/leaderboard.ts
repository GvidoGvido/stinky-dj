import { redis } from '@devvit/web/server';
import {
  MAX_RECORD_SEC,
  VOICE_MAX_B64,
  type ActionResponse,
  type DrumSound,
  type HookData,
  type HookPreview,
  type NoteEvent,
  type PlayerState,
  type RevealState,
} from '../../shared/api';
import { isBassPreset, isDrumKit, isLeadPreset } from '../../shared/synth';
import { mulberry32, seedFromString } from './daily';

type StoredHook = {
  hookId: string;
  hook: HookData;
  authorUsername: string;
  createdAt: number;
};

function hooksKey(roundId: string): string {
  return `round:${roundId}:hooks`;
}

function hookByUserKey(roundId: string): string {
  return `round:${roundId}:hookByUser`;
}

function votesKey(roundId: string): string {
  return `round:${roundId}:votes`;
}

function voteCountsKey(roundId: string): string {
  return `round:${roundId}:voteCounts`;
}

const MAX_HOOKS = 500;
const MAX_LIST = 12;

function toJson<T>(value: T): string {
  return JSON.stringify(value);
}

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await redis.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function getPlayerState(roundId: string, username: string): Promise<PlayerState> {
  const [byUser, votes] = await Promise.all([
    loadJson<Record<string, string>>(hookByUserKey(roundId), {}),
    loadJson<Record<string, string>>(votesKey(roundId), {}),
  ]);
  return {
    username,
    myHookId: byUser[username] ?? null,
    myVoteHookId: votes[username] ?? null,
  };
}

export async function listHooksTop(roundId: string, username: string): Promise<HookPreview[]> {
  const [hooks, voteCounts, byUser, votes] = await Promise.all([
    loadJson<Record<string, StoredHook>>(hooksKey(roundId), {}),
    loadJson<Record<string, number>>(voteCountsKey(roundId), {}),
    loadJson<Record<string, string>>(hookByUserKey(roundId), {}),
    loadJson<Record<string, string>>(votesKey(roundId), {}),
  ]);

  const entries: HookPreview[] = Object.values(hooks).map((h) => {
    const upvotes = voteCounts[h.hookId] ?? 0;
    const isMine = byUser[username] === h.hookId;
    const isVoted = votes[username] === h.hookId;
    return {
      hookId: h.hookId,
      authorUsername: h.authorUsername,
      ...(h.hook.title?.trim() ? { title: h.hook.title.trim() } : {}),
      upvotes,
      isMine,
      isVoted,
    };
  });

  // Ranking in-app is based on upvotes only (ties are shown as ties; we still need a stable order).
  entries.sort((a, b) => (b.upvotes - a.upvotes) || a.hookId.localeCompare(b.hookId));

  return entries.slice(0, MAX_LIST);
}

function deterministicHookId(roundId: string, username: string): string {
  // Stable per-user per-round.
  return `hook_${seedFromString(`${roundId}|${username}`).toString(16)}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeHook(hook: HookData): HookData {
  const bpm = clamp(Math.round(hook.bpm || 120), 60, 190);
  const stepsPerBar = clamp(Math.round(hook.stepsPerBar || 16), 8, 32);
  const bars = clamp(Math.round(hook.bars || 2), 1, 8);
  const detune = clamp(Math.round(hook.synth?.detune ?? 0), -50, 50);
  const tone = clamp(hook.synth?.tone ?? 0.6, 0, 1);
  const leadGain = clamp(hook.synth?.gain ?? 0.95, 0, 1);
  const presetRaw = hook.synth?.preset ?? 'square';
  const preset = isLeadPreset(presetRaw) ? presetRaw : 'square';

  const bassPresetRaw = hook.bass?.preset ?? 'sub';
  const bassPreset = isBassPreset(bassPresetRaw) ? bassPresetRaw : 'sub';
  const bassGain = clamp(hook.bass?.gain ?? 0.85, 0, 1);

  const swing = clamp(hook.drum?.swing ?? 0, 0, 0.5);
  const drumGain = clamp(hook.drum?.gain ?? 0.8, 0, 1);
  const kitRaw = hook.drum?.kit ?? '808';
  const kit = isDrumKit(kitRaw) ? kitRaw : '808';
  const pattern = hook.drum?.pattern ?? { kick: [], snare: [], hat: [], clap: [] };

  const mixEcho = clamp(hook.mix?.echo ?? 0.22, 0, 1);
  const mixReverb = clamp(hook.mix?.reverb ?? 0.18, 0, 1);
  const mixAttack = clamp(hook.mix?.attack ?? 0.35, 0, 1);
  const mixVox = clamp(hook.mix?.vox ?? 0.55, 0, 1);

  const titleRaw = typeof hook.title === 'string' ? hook.title.trim() : '';
  const title = titleRaw
    ? [...titleRaw]
        .filter((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 32 && ch !== '<' && ch !== '>';
        })
        .join('')
        .slice(0, 40)
    : undefined;

  let voice: HookData['voice'];
  if (hook.voice?.data && typeof hook.voice.data === 'string') {
    const maxB64 = VOICE_MAX_B64;
    const data = hook.voice.data.slice(0, maxB64);
    const mime = hook.voice.mime?.startsWith('audio/') ? hook.voice.mime : 'audio/webm';
    if (data.length > 100) voice = { data, mime };
  }

  const cleanPattern: HookData['drum']['pattern'] = {
    kick: Array.from({ length: stepsPerBar }, (_, i) => (pattern.kick?.[i] ? 1 : 0)),
    snare: Array.from({ length: stepsPerBar }, (_, i) => (pattern.snare?.[i] ? 1 : 0)),
    hat: Array.from({ length: stepsPerBar }, (_, i) => (pattern.hat?.[i] ? 1 : 0)),
    clap: Array.from({ length: stepsPerBar }, (_, i) => (pattern.clap?.[i] ? 1 : 0)),
  };

  const hitsRaw = Array.isArray(hook.drum?.hits) ? hook.drum.hits : [];
  const cleanHits = hitsRaw
    .filter((h) => typeof h?.t === 'number' && typeof h?.sound === 'string')
    .map((h) => ({
      t: clamp(h.t, 0, MAX_RECORD_SEC),
      sound: (['kick', 'snare', 'hat', 'clap'] as DrumSound[]).includes(h.sound as DrumSound)
        ? (h.sound as DrumSound)
        : 'kick',
      v: clamp(h.v ?? 0.9, 0, 1),
    }))
    .slice(0, 512);

  const notesRaw = Array.isArray(hook.notes) ? hook.notes : [];
  const bassNotesRaw = Array.isArray(hook.bass?.notes) ? hook.bass.notes : [];

  const cleanNote = (n: NoteEvent, midiLo: number, midiHi: number) => ({
    t: clamp(n.t, 0, MAX_RECORD_SEC),
    d: clamp(n.d, 0.03, 4),
    n: clamp(Math.round(n.n), midiLo, midiHi),
    v: clamp(n.v ?? 0.8, 0, 1),
  });

  // Melody notes — exclude legacy bass-flagged entries (they migrate to bass track).
  const melodyNotes = notesRaw
    .filter((n) => typeof n?.t === 'number' && typeof n?.d === 'number' && typeof n?.n === 'number')
    .filter((n) => n.bass !== true)
    .map((n) => cleanNote(n, 48, 84))
    .slice(0, 192);

  // Bass track + legacy bass-flagged melody notes.
  const legacyBass = notesRaw
    .filter((n) => n.bass === true && typeof n?.t === 'number' && typeof n?.d === 'number' && typeof n?.n === 'number')
    .map((n) => cleanNote(n, 24, 60));

  const bassNotes = [...bassNotesRaw, ...legacyBass]
    .filter((n) => typeof n?.t === 'number' && typeof n?.d === 'number' && typeof n?.n === 'number')
    .map((n) => cleanNote(n, 24, 60))
    .slice(0, 128);

  const usePattern = (['kick', 'snare', 'hat', 'clap'] as DrumSound[]).some(
    (s) => cleanPattern[s]?.some((v) => v),
  );
  const recordedSec =
    typeof hook.recordedSec === 'number'
      ? clamp(hook.recordedSec, 0.5, MAX_RECORD_SEC)
      : undefined;

  return {
    ...(title ? { title } : {}),
    bpm,
    stepsPerBar,
    bars,
    synth: { preset, detune, tone, gain: leadGain },
    bass: { preset: bassPreset, gain: bassGain, notes: bassNotes },
    drum: {
      swing,
      pattern: cleanPattern,
      gain: drumGain,
      kit,
      ...( !usePattern && cleanHits.length > 0 ? { hits: cleanHits } : {}),
    },
    mix: { echo: mixEcho, reverb: mixReverb, attack: mixAttack, vox: mixVox },
    ...(voice ? { voice } : {}),
    notes: melodyNotes,
    ...(recordedSec !== undefined ? { recordedSec } : {}),
  };
}

export async function submitHook(roundId: string, username: string, hook: HookData): Promise<ActionResponse> {
  const cleaned = sanitizeHook(hook);

  const [hooks, byUser, voteCounts] = await Promise.all([
    loadJson<Record<string, StoredHook>>(hooksKey(roundId), {}),
    loadJson<Record<string, string>>(hookByUserKey(roundId), {}),
    loadJson<Record<string, number>>(voteCountsKey(roundId), {}),
  ]);

  if (byUser[username]) {
    throw new Error('You already submitted a hook for this round');
  }

  const hookId = deterministicHookId(roundId, username);
  const now = Date.now();
  const stored: StoredHook = {
    hookId,
    hook: cleaned,
    authorUsername: username,
    createdAt: now,
  };

  const nextHooks = { ...hooks, [hookId]: stored };
  const values = Object.values(nextHooks);
  if (values.length > MAX_HOOKS) {
    // Trim oldest hooks to keep redis payload small.
    values.sort((a, b) => a.createdAt - b.createdAt);
    const trimmed = values.slice(values.length - MAX_HOOKS);
    const rebuilt: Record<string, StoredHook> = {};
    for (const h of trimmed) rebuilt[h.hookId] = h;
    await redis.set(hooksKey(roundId), toJson(rebuilt));
  } else {
    await redis.set(hooksKey(roundId), toJson(nextHooks));
  }

  await redis.set(hookByUserKey(roundId), toJson({ ...byUser, [username]: hookId }));
  await redis.set(voteCountsKey(roundId), toJson({ ...voteCounts, [hookId]: voteCounts[hookId] ?? 0 }));

  // Update UI immediately with latest top list.
  const player = await getPlayerState(roundId, username);
  const hooksTop = await listHooksTop(roundId, username);
  return {
    type: 'action',
    player,
    hooks: hooksTop,
    applause: true,
    prevReveal: null,
  };
}

export async function vote(roundId: string, username: string, hookId: string): Promise<ActionResponse> {
  const [hooks, votes, voteCounts] = await Promise.all([
    loadJson<Record<string, StoredHook>>(hooksKey(roundId), {}),
    loadJson<Record<string, string>>(votesKey(roundId), {}),
    loadJson<Record<string, number>>(voteCountsKey(roundId), {}),
  ]);

  if (!hooks[hookId]) {
    throw new Error('Unknown hook');
  }

  const prev = votes[username] ?? null;
  if (prev === hookId) {
    const player = await getPlayerState(roundId, username);
    const hooksTop = await listHooksTop(roundId, username);
    return {
      type: 'action',
      player,
      hooks: hooksTop,
      applause: false,
      prevReveal: null,
    };
  }

  const nextVotes = { ...votes, [username]: hookId };
  const nextCounts = { ...voteCounts };
  if (prev) nextCounts[prev] = Math.max(0, (nextCounts[prev] ?? 0) - 1);
  nextCounts[hookId] = (nextCounts[hookId] ?? 0) + 1;

  await Promise.all([
    redis.set(votesKey(roundId), toJson(nextVotes)),
    redis.set(voteCountsKey(roundId), toJson(nextCounts)),
  ]);

  const player = await getPlayerState(roundId, username);
  const hooksTop = await listHooksTop(roundId, username);
  return {
    type: 'action',
    player,
    hooks: hooksTop,
    applause: false,
    prevReveal: null,
  };
}

function deterministicSample3<T>(items: T[], seed: number): T[] {
  if (items.length <= 3) return items.slice();
  const rand = mulberry32(seed);

  // Deterministic shuffle then take 3.
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, 3);
}

export async function computePrevReveal(prevRoundId: string): Promise<RevealState | null> {
  const hooks = await loadJson<Record<string, StoredHook>>(hooksKey(prevRoundId), {});
  if (Object.keys(hooks).length === 0) return null;

  const voteCounts = await loadJson<Record<string, number>>(voteCountsKey(prevRoundId), {});
  const entries = Object.values(hooks).map((h) => ({
    hookId: h.hookId,
    authorUsername: h.authorUsername,
    upvotes: voteCounts[h.hookId] ?? 0,
  }));

  const topUpvotes = entries.reduce((m, e) => Math.max(m, e.upvotes), 0);
  const top = entries.filter((e) => e.upvotes === topUpvotes);

  const coWinners =
    top.length <= 3
      ? top
      : deterministicSample3(top, seedFromString(prevRoundId));

  return {
    roundId: prevRoundId,
    topUpvotes,
    coWinners: coWinners.map((e) => ({
      hookId: e.hookId,
      authorUsername: e.authorUsername,
      upvotes: e.upvotes,
    })),
  };
}

export async function getHook(roundId: string, hookId: string): Promise<HookData | null> {
  const hooks = await loadJson<Record<string, StoredHook>>(hooksKey(roundId), {});
  return hooks[hookId]?.hook ?? null;
}
