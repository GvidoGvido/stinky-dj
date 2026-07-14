import { requestExpandedMode } from '@devvit/web/client';
import type { DrumSound } from '../shared/api';
import type { InitResponse } from '../shared/api';
import { Studio3D } from './studio-3d';

const startButton = document.getElementById('start-button') as HTMLButtonElement;
const trackEl = document.getElementById('daily-track') as HTMLSpanElement;
const subEl = document.getElementById('daily-sub') as HTMLSpanElement;
const streakEl = document.getElementById('streak') as HTMLDivElement;
const backdropEl = document.getElementById('studio-backdrop') as HTMLDivElement;

const emptyPattern = (): Record<DrumSound, number[]> => ({
  kick: Array.from({ length: 16 }, () => 0),
  snare: Array.from({ length: 16 }, () => 0),
  hat: Array.from({ length: 16 }, () => 0),
  clap: Array.from({ length: 16 }, () => 0),
});

function mountStudioBackdrop(): void {
  const studio = new Studio3D(backdropEl);
  studio.setCallbacks({
    onNoteDown: () => {},
    onNoteUp: () => {},
    onStepToggle: () => {},
    onRecPress: () => {},
    onCtrl: () => {},
    onPatternPlayToggle: () => {},
    getPatternPlaying: () => false,
    getRecordingProgress: () => 0,
    isRecording: () => false,
    getPattern: emptyPattern,
    getStepHighlight: () => -1,
    getPresetLabel: () => 'Piano',
    getBassLabel: () => 'Sub',
    getBpmLabel: () => '120',
    getDrumsLabel: () => 'ON',
    getDrumKitLabel: () => 'Classic',
    getDrumPatternLabel: () => 'Blank',
    getEchoLabel: () => '22%',
    getReverbLabel: () => '18%',
    getAttackLabel: () => '35%',
    getDubLabel: () => 'OFF',
    getSustainLabel: () => 'OFF',
    getLeadVolLabel: () => '100%',
    getBassVolLabel: () => '100%',
    getDrumVolLabel: () => '100%',
  });
  studio.start();
}

startButton.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});

async function init(): Promise<void> {
  mountStudioBackdrop();

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
