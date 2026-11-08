// Seeded PRNG (cyrb128 -> sfc32) plus crypto helpers.

export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Deterministic RNG from any key parts. */
export function seededRng(...parts: (string | number)[]): () => number {
  const [a, b, c, d] = cyrb128(parts.join('|'));
  const r = sfc32(a, b, c, d);
  for (let i = 0; i < 12; i++) r(); // warm up
  return r;
}

export function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates shuffle (in place) */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.getRandomValues) throw new Error('crypto.getRandomValues is not available');
  return c;
}

/** 128-bit random seed as hex, generated with crypto */
export function newSeed(): string {
  const a = new Uint32Array(4);
  getCrypto().getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** Unbiased secure integer in [0, n) via rejection sampling */
export function secureRandomInt(n: number): number {
  if (n <= 0) throw new Error('n must be > 0');
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    getCrypto().getRandomValues(buf);
    if (buf[0] < max) return buf[0] % n;
  }
}

export function newId(prefix = ''): string {
  return prefix + newSeed().slice(0, 12);
}
