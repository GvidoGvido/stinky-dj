import { reddit } from '@devvit/web/server';
import { buildRoundState } from './daily';

export const createPost = async () => {
  const now = buildRoundState();
  return await reddit.submitCustomPost({
    title: `🖼️ Hook of the Day: Today's Mystery Sleeve (${now.roundId})`,
  });
};
