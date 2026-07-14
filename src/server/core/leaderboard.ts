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

type HookMeta = {
  a: string;
  t?: string;
};

const V = 'v2';

function hooksKey(roundId: string): string {
  return `round:${roundId}:${V}:hooks`;
}
function metaKey(roundId: string): string {
  return `round:${roundId}:${V}:meta`;
}
function byUserKey(roundId: string): string {
  return `round:${roundId}:${V}:byUser`;
}
function votesKey(roundId: string): string {
  return `round:${roundId}:${V}:votes`;
}
function scoresKey(roundId: string): string {
  return `round:${roundId}:${V}:scores`;
}

const LIST_LIMIT = 100;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function deterministicHookId(roundId: string, username: string): string {
  return `hook_${seedFromString(`${roundId}|${username}`).toString(16)}`;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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

  const melodyNotes = notesRaw
    .filter((n) => typeof n?.t === 'number' && typeof n?.d === 'number' && typeof n?.n === 'number')
    .filter((n) => n.bass !== true)
    .map((n) => cleanNote(n, 48, 84))
    .slice(0, 192);

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

export async function getPlayerState(roundId: string, username: string): Promise<PlayerState> {
  const [myHookId, myVoteHookId] = await Promise.all([
    redis.hGet(byUserKey(roundId), username),
    redis.hGet(votesKey(roundId), username),
  ]);
  return {
    username,
    myHookId: myHookId ?? null,
    myVoteHookId: myVoteHookId ?? null,
  };
}

export async function listHooksTop(roundId: string, username: string): Promise<HookPreview[]> {
  const ranked = await redis.zRange(scoresKey(roundId), 0, LIST_LIMIT - 1, {
    reverse: true,
    by: 'rank',
  });
  if (ranked.length === 0) return [];

  const hookIds = ranked.map((r) => r.member);
  const [metaRaw, myHookId, myVoteHookId] = await Promise.all([
    redis.hMGet(metaKey(roundId), hookIds),
    redis.hGet(byUserKey(roundId), username),
    redis.hGet(votesKey(roundId), username),
  ]);

  const previews: HookPreview[] = [];
  ranked.forEach((entry, i) => {
    const meta = parseJson<HookMeta>(metaRaw[i]);
    if (!meta) return;
    const title = meta.t?.trim();
    previews.push({
      hookId: entry.member,
      authorUsername: meta.a,
      ...(title ? { title } : {}),
      upvotes: Math.max(0, Math.round(entry.score)),
      isMine: entry.member === myHookId,
      isVoted: entry.member === myVoteHookId,
    });
  });

  return previews;
}

export async function submitHook(roundId: string, username: string, hook: HookData): Promise<ActionResponse> {
  const cleaned = sanitizeHook(hook);
  const hookId = deterministicHookId(roundId, username);

  const claimed = await redis.hSetNX(byUserKey(roundId), username, hookId);
  if (claimed === 0) {
    throw new Error('You already submitted a jingle for this round');
  }

  const stored: StoredHook = {
    hookId,
    hook: cleaned,
    authorUsername: username,
    createdAt: Date.now(),
  };
  const meta: HookMeta = { a: username, ...(cleaned.title ? { t: cleaned.title } : {}) };

  try {
    await Promise.all([
      redis.hSet(hooksKey(roundId), { [hookId]: JSON.stringify(stored) }),
      redis.hSet(metaKey(roundId), { [hookId]: JSON.stringify(meta) }),
      redis.zAdd(scoresKey(roundId), { member: hookId, score: 0 }),
    ]);
  } catch (error) {
    await redis.hDel(byUserKey(roundId), [username]).catch(() => {});
    throw error;
  }

  const [player, hooksTop] = await Promise.all([
    getPlayerState(roundId, username),
    listHooksTop(roundId, username),
  ]);
  return {
    type: 'action',
    player,
    hooks: hooksTop,
    applause: true,
    prevReveal: null,
  };
}

export async function vote(roundId: string, username: string, hookId: string): Promise<ActionResponse> {
  const targetScore = await redis.zScore(scoresKey(roundId), hookId);
  if (targetScore === undefined) {
    throw new Error('Unknown hook');
  }

  const prev = (await redis.hGet(votesKey(roundId), username)) ?? null;
  if (prev !== hookId) {
    await redis.hSet(votesKey(roundId), { [username]: hookId });
    await redis.zIncrBy(scoresKey(roundId), hookId, 1);
    if (prev) {
      const prevScore = await redis.zScore(scoresKey(roundId), prev);
      if (prevScore !== undefined && prevScore > 0) {
        await redis.zIncrBy(scoresKey(roundId), prev, -1);
      }
    }
  }

  const [player, hooksTop] = await Promise.all([
    getPlayerState(roundId, username),
    listHooksTop(roundId, username),
  ]);
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

  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, 3);
}

export async function computePrevReveal(prevRoundId: string): Promise<RevealState | null> {
  const ranked = await redis.zRange(scoresKey(prevRoundId), 0, -1, {
    reverse: true,
    by: 'rank',
  });
  if (ranked.length === 0) return null;

  const topUpvotes = Math.max(0, Math.round(ranked[0]!.score));
  const topEntries = ranked.filter((e) => Math.round(e.score) === topUpvotes);
  const topIds = topEntries.map((e) => e.member);
  const metaRaw = await redis.hMGet(metaKey(prevRoundId), topIds);

  const winners = topEntries.map((entry, i) => ({
    hookId: entry.member,
    authorUsername: parseJson<HookMeta>(metaRaw[i])?.a ?? 'unknown',
    upvotes: topUpvotes,
  }));

  const coWinners =
    winners.length <= 3 ? winners : deterministicSample3(winners, seedFromString(prevRoundId));

  return {
    roundId: prevRoundId,
    topUpvotes,
    coWinners,
  };
}

export async function getHook(roundId: string, hookId: string): Promise<HookData | null> {
  const raw = await redis.hGet(hooksKey(roundId), hookId);
  return parseJson<StoredHook>(raw)?.hook ?? null;
}
