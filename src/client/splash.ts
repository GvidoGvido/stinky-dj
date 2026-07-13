import { requestExpandedMode } from '@devvit/web/client';
import type { InitResponse } from '../shared/api';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const trackEl = document.getElementById('daily-track') as HTMLSpanElement;
const subEl = document.getElementById('daily-sub') as HTMLSpanElement;
const streakEl = document.getElementById('streak') as HTMLDivElement;

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

async function init(): Promise<void> {
  try {
    const res = await fetch('/api/init');
    if (!res.ok) return;
    const data = (await res.json()) as InitResponse;
    if (data.type !== 'init') return;

    trackEl.textContent = `Round ${data.now.roundId} (GMT+2)`;
    subEl.textContent = `Seed ${data.now.seed.toString(16)}`;

    if (data.prevReveal?.coWinners?.length) {
      const winners = data.prevReveal.coWinners
        .slice(0, 3)
        .map((w) => `u/${w.authorUsername}`)
        .join(', ');
      streakEl.textContent = `Yesterday’s winner(s): ${winners}`;
    }
  } catch {
    /* static copy */
  }
}

void init();
