import { reddit } from '@devvit/web/server';
import { buildRoundState } from './daily';

export const createPost = async () => {
  const now = buildRoundState();
  return await reddit.submitCustomPost({
    title: `🖼️ Stinky DJ — Today’s Mystery Sleeve (${now.roundId})`,
  });
};
