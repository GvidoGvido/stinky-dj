import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  ErrorResponse,
  InitResponse,
  ActionResponse,
  SubmitHookRequest,
  VoteRequest,
} from '../../shared/api';
import { buildRoundState, previousRoundId } from '../core/daily';
import {
  computePrevReveal,
  getPlayerState,
  listHooksTop,
  submitHook,
  vote,
  getHook,
} from '../core/leaderboard';

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId is required but missing from context' },
      400
    );
  }

  try {
    const now = buildRoundState();
    const prevRound = previousRoundId(now.roundId);
    const username = (await reddit.getCurrentUsername()) ?? 'stinky-driver';

    const [player, submissions, prevReveal] = await Promise.all([
      getPlayerState(now.roundId, username),
      listHooksTop(now.roundId, username),
      computePrevReveal(prevRound),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      now,
      prevReveal,
      player,
      hooks: submissions,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown init error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/submit-hook', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  try {
    const body = await c.req.json<SubmitHookRequest>();
    const now = buildRoundState();
    const prevRound = previousRoundId(now.roundId);
    const username = (await reddit.getCurrentUsername()) ?? 'stinky-driver';

    const action = await submitHook(now.roundId, username, body.hook);
    const prevReveal = await computePrevReveal(prevRound);

    const res: ActionResponse = {
      ...action,
      postId,
      prevReveal,
    };
    return c.json(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown submit error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.post('/vote', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  try {
    const body = await c.req.json<VoteRequest>();
    const now = buildRoundState();
    const prevRound = previousRoundId(now.roundId);
    const username = (await reddit.getCurrentUsername()) ?? 'stinky-driver';

    const action = await vote(now.roundId, username, body.hookId);
    const prevReveal = await computePrevReveal(prevRound);

    const res: ActionResponse = {
      ...action,
      postId,
      prevReveal,
    };
    return c.json(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown vote error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});

api.get('/hook/:hookId', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }

  try {
    const hookId = c.req.param('hookId');
    const now = buildRoundState();
    const hook = await getHook(now.roundId, hookId);
    if (!hook) {
      return c.json<ErrorResponse>({ status: 'error', message: 'Hook not found' }, 404);
    }
    return c.json({ hookId, hook });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown hook fetch error';
    return c.json<ErrorResponse>({ status: 'error', message }, 400);
  }
});
