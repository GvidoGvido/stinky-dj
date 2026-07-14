# Tunebox

A Reddit Devvit game where players spin up a short jingle (drums, keys, bass, and optional vocals), submit it to a daily leaderboard, and vote on other submissions.

Built with [Devvit Web](https://developers.reddit.com/), Three.js, and the Web Audio API.

## Features

- **3D studio:** PS1-style desk with drum machine, synth, and tape deck
- **Touch-friendly compose UI:** mobile console, drum grid, and two-row keyboard (melody + bass)
- **Multitrack overdub:** record drums, keys, bass, and vox as separate layers, then submit the mix
- **Daily jingles:** one submission per user per round; vote on today's takes
- **Local dev:** full game loop with a mock API, no Reddit login required

## Requirements

- Node.js **≥ 22.2**
- npm

## Local development

```bash
npm install
npm run local
```

Open [http://localhost:5174/game.html](http://localhost:5174/game.html) for the game, or [http://localhost:5174/splash.html](http://localhost:5174/splash.html) for the splash screen.

Other useful commands:

```bash
npm run type-check   # TypeScript
npm run lint         # ESLint
npm run build        # Production client + server bundle
npm run preview      # Serve dist/client on port 5173
```

## Deploy to Reddit (Devvit)

```bash
npm run login      # one-time Devvit auth
npm run deploy     # type-check, lint, build, upload
npm run dev        # playtest in a subreddit
npm run launch     # deploy + publish
```

On first upload, the CLI opens a browser link to register the app on Reddit.

## Project layout

```
src/
  client/     Game UI, audio engine, 3D studio, touch controls
  server/     Hono API, Redis leaderboard, Reddit post triggers
  shared/     Jingle schema, drum patterns, synth presets
tools/        Local dev server and Devvit client stub
```

## License

[BSD-3-Clause](LICENSE)
