// Synthesized sounds (Web Audio API) — no music files. Plus Thai voice call-out.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;
let enabled = true;

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio() {
  ac();
}
export function audioUnlocked() {
  return !!ctx && ctx.state === 'running';
}

export function setAudio(on: boolean, vol: number) {
  enabled = on;
  volume = vol;
  if (master) master.gain.value = on ? vol : 0;
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function hit(c: AudioContext, at: number, gain: number, freq = 1400) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
  src.connect(bp).connect(g).connect(master!);
  src.start(at);
  src.stop(at + 0.12);
  // body thump
  const o = c.createOscillator();
  o.frequency.setValueAtTime(180, at);
  o.frequency.exponentialRampToValueAtTime(90, at + 0.08);
  const og = c.createGain();
  og.gain.setValueAtTime(gain * 0.5, at);
  og.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
  o.connect(og).connect(master!);
  o.start(at);
  o.stop(at + 0.12);
}

/** Snare roll that accelerates and swells for `ms` milliseconds */
export function drumRoll(ms: number) {
  const c = ac();
  if (!c) return;
  const start = c.currentTime + 0.02;
  const dur = ms / 1000;
  let t = 0;
  while (t < dur) {
    const p = t / dur;
    hit(c, start + t, 0.12 + 0.35 * p, 1200 + 800 * p);
    t += 0.085 - 0.05 * p;
  }
}

/** Short ticks for the slot machine, slowing down */
export function spinTicks(ms: number) {
  const c = ac();
  if (!c) return;
  const start = c.currentTime + 0.02;
  const dur = ms / 1000;
  let t = 0;
  let step = 0.045;
  while (t < dur) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 2200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, start + t);
    g.gain.exponentialRampToValueAtTime(0.0005, start + t + 0.03);
    o.connect(g).connect(master!);
    o.start(start + t);
    o.stop(start + t + 0.04);
    t += step;
    step = 0.045 + 0.35 * Math.pow(t / dur, 3);
  }
}

export function ding() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.01;
  [880, 1320, 2640].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4 / (i + 1), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / (i + 1));
    o.connect(g).connect(master!);
    o.start(t);
    o.stop(t + 1.7);
  });
}

export function whoosh() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  src.connect(f).connect(g).connect(master!);
  src.start(t);
  src.stop(t + 0.5);
}

function brass(c: AudioContext, f: number, at: number, len: number, gain = 0.16) {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(600, at);
  lp.frequency.linearRampToValueAtTime(3200, at + 0.06);
  lp.frequency.linearRampToValueAtTime(1800, at + len);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.04);
  g.gain.setValueAtTime(gain, at + len - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.25);
  lp.connect(g).connect(master!);
  [-6, 0, 7].forEach((det) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(at);
    o.stop(at + len + 0.3);
  });
}

/** Original triumphant fanfare (C major arpeggio) */
export function fanfare() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.03;
  const N = { C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, E5: 659.3, G5: 784 };
  const seq: [number, number, number][] = [
    [N.G4, 0, 0.14], [N.C5, 0.16, 0.14], [N.E5, 0.32, 0.14], [N.G5, 0.48, 0.5],
    [N.E5, 1.02, 0.16], [N.G5, 1.2, 1.1],
  ];
  seq.forEach(([f, at, len]) => brass(c, f, t + at, len));
  // chord pad under the last note
  [N.C4, N.E4, N.G4, N.C5].forEach((f) => brass(c, f, t + 1.2, 1.1, 0.06));
  hit(c, t + 1.2, 0.5, 900);
}

export function chime() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  [1046, 1318, 1568].forEach((f, i) => {
    const o = c.createOscillator();
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.09 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.6);
    o.connect(g).connect(master!);
    o.start(t + i * 0.09);
    o.stop(t + i * 0.09 + 0.7);
  });
}

// ---------- voice ----------
let thaiVoice: SpeechSynthesisVoice | null | undefined;
function findVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  if (thaiVoice) return thaiVoice;
  const v = speechSynthesis.getVoices().find((x) => x.lang?.toLowerCase().startsWith('th'));
  thaiVoice = v ?? null;
  return thaiVoice;
}
if (typeof speechSynthesis !== 'undefined') {
  try {
    speechSynthesis.onvoiceschanged = () => {
      thaiVoice = undefined;
      findVoice();
    };
  } catch {
    /* ignore */
  }
}

export function hasThaiVoice(): boolean {
  return !!findVoice();
}

/** Speak Thai text if a Thai voice exists; silently does nothing otherwise. */
export function speak(text: string, vol = 1) {
  try {
    const v = findVoice();
    if (!v || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = v.lang;
    u.rate = 0.9;
    u.volume = Math.max(0, Math.min(1, vol));
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}
