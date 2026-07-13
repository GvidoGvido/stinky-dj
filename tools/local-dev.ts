import { spawn } from 'node:child_process';
import { startMockApi } from './mock-api';

const API_PORT = 8788;
const VITE_PORT = 5174;

startMockApi(API_PORT);

const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--config', 'vite.config.local.ts'],
  { stdio: 'inherit', cwd: process.cwd() }
);

vite.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => {
  vite.kill('SIGINT');
  process.exit(0);
});

console.log(`\n  Hook of the Day — local dev`);
console.log(`  Game:   http://localhost:${VITE_PORT}/game.html`);
console.log(`  Splash: http://localhost:${VITE_PORT}/splash.html`);
console.log(`  Ctrl+C to stop\n`);
