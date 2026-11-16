// Seeded randomness. Two kinds:
//  - Rng: a sequential stream (mulberry32) for things owned by one simulation arm.
//  - hash*: stateless functions of (seed, keys). Used for everything that must be IDENTICAL in the
//    baseline and Samam arms regardless of what the controller does (traffic, passengers, tickets).

export function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash4(a: number, b: number, c: number, d: number): number {
  let h = mix32((a | 0) ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul(b | 0, 0x85ebca6b) ^ 0x7f4a7c15);
  h = mix32(h ^ Math.imul(c | 0, 0xc2b2ae35) ^ 0x94d049bb);
  h = mix32(h ^ Math.imul(d | 0, 0x27d4eb2f) ^ 0x165667b1);
  return h;
}

/** Uniform in [0,1) from integer keys. */
export function hashUnit(a: number, b: number, c = 0, d = 0): number {
  return hash4(a, b, c, d) / 4294967296;
}

/** Standard normal from integer keys (Box–Muller). */
export function hashNormal(a: number, b: number, c = 0, d = 0): number {
  const u1 = (hash4(a, b, c, d) + 0.5) / 4294967296;
  const u2 = hash4(a ^ 0x5bd1e995, b, c, d + 7919) / 4294967296;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = mix32(seed | 0) || 0x1234567;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
