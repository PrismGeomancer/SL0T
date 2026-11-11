/** Synthesised casino sounds. Off by default; nothing plays until the user turns sound on. */
let ctx: AudioContext | null = null;
let enabled = false;

export function setSoundEnabled(on: boolean) {
  enabled = on;
  if (on) ac();
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.15, when = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.2, when = 0, lowpass = 900) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  hum() {
    tone(60, 1.4, 'sawtooth', 0.04);
    tone(120, 1.4, 'sine', 0.03);
  },
  clunk() {
    noise(0.12, 0.35, 0, 500);
    tone(90, 0.15, 'square', 0.08, 0, 50);
  },
  tick() {
    tone(1800, 0.025, 'square', 0.03);
  },
  thunk() {
    noise(0.08, 0.25, 0, 300);
    tone(140, 0.12, 'sine', 0.12, 0, 70);
  },
  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.45, 'triangle', 0.1, i * 0.09));
  },
  buzz() {
    tone(110, 0.5, 'sawtooth', 0.08, 0, 80);
    tone(116, 0.5, 'sawtooth', 0.06);
  },
  pop() {
    noise(0.05, 0.3, 0, 4000);
  },
};
