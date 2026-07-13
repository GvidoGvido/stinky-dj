/** Lead (melody) synth tones — cycle with SYN on the keyboard. */
export const LEAD_PRESETS = [
  'piano',
  'guitar',
  'sax',
  'strings',
  'flute',
  'organ',
  'brass',
  'bell',
  'pluck',
  'square',
  'saw',
  'triangle',
  'fm',
  'pulse',
  'chip',
  'warm',
  'lofi',
] as const;

export type SynthPreset = (typeof LEAD_PRESETS)[number];

/** Bass layer tones — cycle with BAS button. */
export const BASS_PRESETS = ['sub', 'square', 'saw', 'wobble', 'fm', 'pulse', 'fretless', 'acid'] as const;

export type BassPreset = (typeof BASS_PRESETS)[number];

/** Drum kits — cycle with KIT on the drum machine. 'classic' = acoustic rock kit. */
export const DRUM_KITS = ['classic', '808', '909', 'lofi', 'electro'] as const;

export type DrumKit = (typeof DRUM_KITS)[number];

const LEAD_LABELS: Record<SynthPreset, string> = {
  piano: 'PIANO',
  guitar: 'GUITAR',
  sax: 'SAX',
  strings: 'STRINGS',
  flute: 'FLUTE',
  organ: 'ORGAN',
  brass: 'BRASS',
  bell: 'BELL',
  pluck: 'PLUCK',
  square: 'SQUARE',
  saw: 'SAW',
  triangle: 'TRI',
  fm: 'FM',
  pulse: 'PULSE',
  chip: 'CHIP',
  warm: 'WARM',
  lofi: 'LO-FI',
};

const BASS_LABELS: Record<BassPreset, string> = {
  sub: 'SUB',
  square: 'SQR',
  saw: 'SAW',
  wobble: 'WOBBLE',
  fm: 'FM',
  pulse: 'PULSE',
  fretless: 'FRETLESS',
  acid: 'ACID',
};

const KIT_LABELS: Record<DrumKit, string> = {
  classic: 'CLASSIC',
  '808': '808',
  '909': '909',
  lofi: 'LO-FI',
  electro: 'ELECTRO',
};

export function prevLeadPreset(current: SynthPreset): SynthPreset {
  const i = LEAD_PRESETS.indexOf(current);
  return LEAD_PRESETS[(i - 1 + LEAD_PRESETS.length) % LEAD_PRESETS.length]!;
}

export function prevBassPreset(current: BassPreset): BassPreset {
  const i = BASS_PRESETS.indexOf(current);
  return BASS_PRESETS[(i - 1 + BASS_PRESETS.length) % BASS_PRESETS.length]!;
}

export function prevDrumKit(current: DrumKit): DrumKit {
  const i = DRUM_KITS.indexOf(current);
  return DRUM_KITS[(i - 1 + DRUM_KITS.length) % DRUM_KITS.length]!;
}

export function nextLeadPreset(current: SynthPreset): SynthPreset {
  const i = LEAD_PRESETS.indexOf(current);
  return LEAD_PRESETS[(i + 1) % LEAD_PRESETS.length]!;
}

export function nextBassPreset(current: BassPreset): BassPreset {
  const i = BASS_PRESETS.indexOf(current);
  return BASS_PRESETS[(i + 1) % BASS_PRESETS.length]!;
}

export function nextDrumKit(current: DrumKit): DrumKit {
  const i = DRUM_KITS.indexOf(current);
  return DRUM_KITS[(i + 1) % DRUM_KITS.length]!;
}

export function leadPresetLabel(p: SynthPreset): string {
  return LEAD_LABELS[p] ?? p.toUpperCase();
}

export function bassPresetLabel(p: BassPreset): string {
  return BASS_LABELS[p] ?? p.toUpperCase();
}

export function drumKitLabel(k: DrumKit): string {
  return KIT_LABELS[k] ?? k.toUpperCase();
}

export function isLeadPreset(v: string): v is SynthPreset {
  return (LEAD_PRESETS as readonly string[]).includes(v);
}

export function isBassPreset(v: string): v is BassPreset {
  return (BASS_PRESETS as readonly string[]).includes(v);
}

export function isDrumKit(v: string): v is DrumKit {
  return (DRUM_KITS as readonly string[]).includes(v);
}
