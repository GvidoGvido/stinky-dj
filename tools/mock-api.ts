import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ActionResponse, HookData, InitResponse, SubmitHookRequest, VoteRequest } from '../src/shared/api';
import { buildRoundState, mulberry32, previousRoundId, seedFromString } from '../src/server/core/daily';

const USERNAME = 'local-driver';

type StoredHook = {
  hookId: string;
  hook: HookData;
  authorUsername: string;
  createdAt: number;
};

const hooksByRound = new Map<string, Record<string, StoredHook>>();
const hookByUserByRound = new Map<string, Record<string, string>>();
const votesByRound = new Map<string, Record<string, string>>();
const voteCountsByRound = new Map<string, Record<string, number>>();

function getHooks(roundId: string): Record<string, StoredHook> {
  return hooksByRound.get(roundId) ?? {};
}

function getHookByUser(roundId: string): Record<string, string> {
  return hookByUserByRound.get(roundId) ?? {};
}

function getVotes(roundId: string): Record<string, string> {
  return votesByRound.get(roundId) ?? {};
}

function getVoteCounts(roundId: string): Record<string, number> {
  return voteCountsByRound.get(roundId) ?? {};
}

function deterministicHookId(roundId: string, username: string): string {
  return `hook_${seedFromString(`${roundId}|${username}`).toString(16)}`;
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

function listHooksTop(roundId: string, username: string) {
  const hooks = getHooks(roundId);
  const voteCounts = getVoteCounts(roundId);
  const byUser = getHookByUser(roundId);
  const votes = getVotes(roundId);

  const entries = Object.values(hooks).map((h) => {
    const upvotes = voteCounts[h.hookId] ?? 0;
    return {
      hookId: h.hookId,
      authorUsername: h.authorUsername,
      ...(h.hook.title?.trim() ? { title: h.hook.title.trim() } : {}),
      upvotes,
      isMine: byUser[username] === h.hookId,
      isVoted: votes[username] === h.hookId,
    };
  });

  entries.sort((a, b) => (b.upvotes - a.upvotes) || a.hookId.localeCompare(b.hookId));
  return entries.slice(0, 12);
}

function getPlayerState(roundId: string, username: string) {
  const byUser = getHookByUser(roundId);
  const votes = getVotes(roundId);
  return {
    username,
    myHookId: byUser[username] ?? null,
    myVoteHookId: votes[username] ?? null,
  };
}

function computePrevReveal(prevRoundId: string) {
  const hooks = getHooks(prevRoundId);
  if (Object.keys(hooks).length === 0) return null;

  const voteCounts = getVoteCounts(prevRoundId);
  const entries = Object.values(hooks).map((h) => ({
    hookId: h.hookId,
    authorUsername: h.authorUsername,
    upvotes: voteCounts[h.hookId] ?? 0,
  }));

  const topUpvotes = entries.reduce((m, e) => Math.max(m, e.upvotes), 0);
  const top = entries.filter((e) => e.upvotes === topUpvotes);
  const coWinners = top.length <= 3 ? top : deterministicSample3(top, seedFromString(prevRoundId));

  return {
    roundId: prevRoundId,
    topUpvotes,
    coWinners,
  };
}

const app = new Hono();

app.get('/api/init', (c) => {
  const now = buildRoundState();
  const prevRound = previousRoundId(now.roundId);

  const player = getPlayerState(now.roundId, USERNAME);
  const hooks = listHooksTop(now.roundId, USERNAME);
  const prevReveal = computePrevReveal(prevRound);

  const res: InitResponse = {
    type: 'init',
    postId: 'local-dev',
    now,
    prevReveal,
    player,
    hooks,
  };
  return c.json(res);
});

app.post('/api/submit-hook', async (c) => {
  const body = await c.req.json<SubmitHookRequest>();
  const now = buildRoundState();
  const prevRound = previousRoundId(now.roundId);

  const byUser = getHookByUser(now.roundId);
  if (byUser[USERNAME]) {
    return c.json({ status: 'error', message: 'You already submitted a hook for this round' }, 400);
  }

  const hookId = deterministicHookId(now.roundId, USERNAME);
  const hooks = getHooks(now.roundId);
  hooks[hookId] = {
    hookId,
    hook: body.hook,
    authorUsername: USERNAME,
    createdAt: Date.now(),
  };
  hooksByRound.set(now.roundId, hooks);

  const nextByUser = { ...byUser, [USERNAME]: hookId };
  hookByUserByRound.set(now.roundId, nextByUser);

  const voteCounts = getVoteCounts(now.roundId);
  voteCounts[hookId] = voteCounts[hookId] ?? 0;
  voteCountsByRound.set(now.roundId, voteCounts);

  const player = getPlayerState(now.roundId, USERNAME);
  const hooksTop = listHooksTop(now.roundId, USERNAME);
  const prevReveal = computePrevReveal(prevRound);

  const res: ActionResponse = {
    type: 'action',
    postId: 'local-dev',
    player,
    hooks: hooksTop,
    applause: true,
    prevReveal,
  };
  return c.json(res);
});

app.post('/api/vote', async (c) => {
  const body = await c.req.json<VoteRequest>();
  const now = buildRoundState();
  const prevRound = previousRoundId(now.roundId);

  const hooks = getHooks(now.roundId);
  if (!hooks[body.hookId]) {
    return c.json({ status: 'error', message: 'Unknown hook' }, 400);
  }

  const votes = getVotes(now.roundId);
  const voteCounts = getVoteCounts(now.roundId);

  const prev = votes[USERNAME] ?? null;
  if (prev !== body.hookId) {
    if (prev) voteCounts[prev] = Math.max(0, (voteCounts[prev] ?? 0) - 1);
    voteCounts[body.hookId] = (voteCounts[body.hookId] ?? 0) + 1;
    votes[USERNAME] = body.hookId;
    votesByRound.set(now.roundId, votes);
    voteCountsByRound.set(now.roundId, voteCounts);
  }

  const player = getPlayerState(now.roundId, USERNAME);
  const hooksTop = listHooksTop(now.roundId, USERNAME);
  const prevReveal = computePrevReveal(prevRound);

  const res: ActionResponse = {
    type: 'action',
    postId: 'local-dev',
    player,
    hooks: hooksTop,
    applause: false,
    prevReveal,
  };
  return c.json(res);
});

app.get('/api/hook/:hookId', (c) => {
  const now = buildRoundState();
  const hookId = c.req.param('hookId');
  const hooks = getHooks(now.roundId);
  const hook = hooks[hookId]?.hook;
  if (!hook) return c.json({ status: 'error', message: 'Hook not found' }, 404);
  return c.json({ hookId, hook });
});

export function startMockApi(port = 8787): void {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Mock API  http://localhost:${port}/api/init`);
  });
}
