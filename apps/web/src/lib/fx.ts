/** Sound, confetti and floating numbers. All of it is decoration: nothing here may throw into the game. */

export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- sound (WebAudio, no files) ---------- */
export class Sfx {
  private ac: AudioContext | null = null;
  constructor(private readonly isMuted: () => boolean) {}

  private ctx(): AudioContext | null {
    if (this.isMuted()) return null;
    try {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      this.ac ??= new C();
      if (this.ac.state === "suspended") void this.ac.resume();
      return this.ac;
    } catch {
      return null;
    }
  }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  private sweep(f1: number, f2: number, dur: number, vol: number) {
    const c = this.ctx();
    if (!c) return;
    const t0 = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f1, t0);
    o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }
  right(combo: number) {
    const base = 523.25 * Math.pow(2, Math.min(7, combo - 1) / 12);
    this.tone(base, 0.13, "triangle", 0.17);
    this.tone(base * 1.5, 0.16, "triangle", 0.12, 0.055);
  }
  wrong() {
    this.sweep(220, 90, 0.22, 0.12);
  }
  crown() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, "triangle", 0.16, i * 0.09));
  }
  finish() {
    [440, 554, 659].forEach((f, i) => this.tone(f, 0.24, "sine", 0.14, i * 0.08));
  }
  tap() {
    this.tone(660, 0.05, "square", 0.05);
  }
}

export function buzz(pattern: number | number[]) {
  try {
    if (!reducedMotion()) navigator.vibrate?.(pattern);
  } catch {
    /* no vibration on this device */
  }
}

/* ---------- confetti ---------- */
interface Bit { x: number; y: number; vx: number; vy: number; w: number; h: number; c: string; r: number; vr: number; life: number }
const COLORS = ["#E4BA55", "#15805F", "#C21B33", "#F0CC79", "#3FC79A", "#FFFFFF"];

let canvas: HTMLCanvasElement | null = null;
let bits: Bit[] = [];
let raf: number | null = null;

export function registerCanvas(c: HTMLCanvasElement | null) {
  canvas = c;
  if (!c) {
    bits = [];
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }
}

function sizeCanvas(): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== innerWidth * dpr) {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function tick() {
  const ctx = sizeCanvas();
  if (!ctx) {
    raf = null;
    return;
  }
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  bits = bits.filter((b) => b.life > 0 && b.y < innerHeight + 40);
  for (const b of bits) {
    b.vy += 0.28;
    b.x += b.vx;
    b.y += b.vy;
    b.r += b.vr;
    b.life -= 0.006;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.r);
    ctx.globalAlpha = Math.max(0, Math.min(1, b.life * 1.6));
    ctx.fillStyle = b.c;
    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
  }
  if (bits.length) raf = requestAnimationFrame(tick);
  else {
    raf = null;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }
}

const pick = () => COLORS[(Math.random() * COLORS.length) | 0]!;

export function burst(x: number, y: number, n = 26) {
  if (reducedMotion() || !canvas) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 7;
    bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, w: 4 + Math.random() * 7, h: 4 + Math.random() * 9, c: pick(), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1 });
  }
  raf ??= requestAnimationFrame(tick);
}

export function rain() {
  if (reducedMotion() || !canvas) return;
  for (let i = 0; i < 70; i++) {
    bits.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 220, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 4, w: 5 + Math.random() * 7, h: 6 + Math.random() * 10, c: pick(), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 1 });
  }
  raf ??= requestAnimationFrame(tick);
}

/* ---------- floating +XP ---------- */
export function floatXP(text: string, x: number, y: number) {
  if (reducedMotion() || typeof document === "undefined") return;
  const n = document.createElement("div");
  n.className = "floatxp";
  n.setAttribute("aria-hidden", "true");
  n.textContent = text;
  n.style.left = x + "px";
  n.style.top = y + "px";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 950);
}

/* ---------- where the last tap was, so the burst comes from the button ---------- */
let lastPoint: { x: number; y: number } | null = null;
export function trackPointer() {
  const on = (e: PointerEvent) => (lastPoint = { x: e.clientX, y: e.clientY });
  addEventListener("pointerdown", on, true);
  return () => removeEventListener("pointerdown", on, true);
}
export function burstPoint(): { x: number; y: number } {
  return lastPoint ?? { x: innerWidth / 2, y: innerHeight * 0.45 };
}
