<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  /* ── types ─────────────────────────────────────────────── */

  interface Rgb {
    r: number;
    g: number;
    b: number;
  }

  interface Target {
    x: number;
    y: number;
    alpha: number;
  }

  interface Particle {
    x: number;
    y: number;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    size: number;
    color: string;
    seed: number;
    depth: number;
    delay: number;
  }

  interface Pointer {
    active: boolean;
    x: number;
    y: number;
    smoothX: number;
    smoothY: number;
  }

  export interface ParticleTextProps {
    text?: string;
    particleSize?: number;
    density?: number;
    color?: string;
    highlightColor?: string;
    scatter?: number;
    gatherDuration?: number;
    stagger?: number;
    pointerRepel?: number;
    repelRadius?: number;
    idleDrift?: number;
    trigger?: 'mount' | 'hover' | 'click';
    fontSize?: number | string;
    fontWeight?: number | string;
    fontFamily?: string;
    glow?: boolean;
    className?: string;
    style?: Record<string, string | number> | string;
  }

  /* ── props (Svelte 5 Runes) ──────────────────────────────── */

  let {
    text = 'BUP CSE Fest 2026 CTF',
    particleSize = 2,
    density = 4,
    color = '#ff9d9d',
    highlightColor = '#ff0000',
    scatter = 180,
    gatherDuration = 1600,
    stagger = 420,
    pointerRepel = 20,
    repelRadius = 120,
    idleDrift = 0.7,
    trigger = 'mount',
    fontSize = 'clamp(3rem, 12vw, 8rem)',
    fontWeight = 800,
    fontFamily = 'inherit',
    glow = true,
    className = '',
    style = undefined,
  }: ParticleTextProps = $props();

  /* ── state ─────────────────────────────────────────────── */

  let container = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);

  let particles: Particle[] = [];
  let animationFrame = 0;
  let resizeFrame = 0;
  let buildId = 0;
  let gathering = false;
  let gatherStart = 0;
  let reducedMotion = false;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let isVisible = true;
  let isPageVisible = true;

  let reduceMotionQuery: MediaQueryList | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;

  const pointer: Pointer = {
    active: false,
    x: 0,
    y: 0,
    smoothX: 0,
    smoothY: 0,
  };

  /* ── helpers ───────────────────────────────────────────── */

  const hexToRgb = (hex: string): Rgb | null => {
    const c = hex.replace('#', '').trim();
    if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
    return {
      r: parseInt(c.slice(0, 2), 16),
      g: parseInt(c.slice(2, 4), 16),
      b: parseInt(c.slice(4, 6), 16),
    };
  };

  const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  });

  const rgbCss = (c: Rgb): string => `rgb(${c.r},${c.g},${c.b})`;
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3);

  const resolveFontSize = (
    val: number | string,
    fw: number | string,
    fam: string,
    parentEl: HTMLElement
  ): number => {
    if (typeof val === 'number') return val;
    const el = document.createElement('span');
    el.textContent = 'M';
    el.style.position = 'absolute';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.fontSize = val;
    el.style.fontWeight = String(fw);
    el.style.fontFamily = fam;
    parentEl.appendChild(el);
    const px = parseFloat(getComputedStyle(el).fontSize) || 96;
    el.remove();
    return px;
  };

  const toStyleStr = (s: Record<string, string | number> | string | undefined): string => {
    if (!s) return '';
    if (typeof s === 'string') return s;
    return Object.entries(s)
      .map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`)
      .join(';');
  };

  /* ── animation logic ────────────────────────────────────── */

  const startGather = (fromScatter = true): void => {
    if (!particles.length) return;
    const now = performance.now();
    const sp = reducedMotion ? 0 : scatter;

    for (const p of particles) {
      if (fromScatter) {
        const a = p.seed * Math.PI * 2;
        const d = sp * (0.35 + p.depth * 0.75);
        p.x = p.targetX + Math.cos(a) * d + (p.depth - 0.5) * sp * 0.55;
        p.y = p.targetY + Math.sin(a) * d + (p.seed - 0.5) * sp * 0.55;
      }
      p.startX = p.x;
      p.startY = p.y;
      p.delay = reducedMotion ? 0 : p.seed * stagger;
    }
    gatherStart = now;
    gathering = true;
  };

  const loop = (now: number): void => {
    if (!canvas || !isVisible || !isPageVisible) {
      animationFrame = 0;
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      animationFrame = 0;
      return;
    }

    ctx.clearRect(0, 0, width, height);

    const isGlow = glow && !reducedMotion;
    if (isGlow) {
      ctx.shadowBlur = particleSize * 2.5;
      ctx.shadowColor = highlightColor;
    } else {
      ctx.shadowBlur = 0;
    }

    pointer.smoothX += (pointer.x - pointer.smoothX) * 0.18;
    pointer.smoothY += (pointer.y - pointer.smoothY) * 0.18;

    let done = true;

    for (const p of particles) {
      let bx = p.targetX;
      let by = p.targetY;
      let prog = 1;

      if (gathering) {
        const t = (now - gatherStart - p.delay) / Math.max(1, reducedMotion ? 1 : gatherDuration);
        prog = clamp(t, 0, 1);
        const e = ease(prog);
        bx = p.startX + (p.targetX - p.startX) * e;
        by = p.startY + (p.targetY - p.startY) * e;
        if (prog < 1) done = false;
      } else if (!reducedMotion && idleDrift > 0) {
        const s = now * 0.001;
        bx += Math.sin(s * 0.9 + p.seed * 10) * idleDrift * p.depth;
        by += Math.cos(s * 0.75 + p.depth * 10) * idleDrift * p.depth;
      }

      if (pointer.active && !reducedMotion && pointerRepel > 0 && repelRadius > 0) {
        const dx = bx - pointer.smoothX;
        const dy = by - pointer.smoothY;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < repelRadius) {
          const f = Math.pow(1 - dist / repelRadius, 2) * pointerRepel;
          bx += (dx / dist) * f;
          by += (dy / dist) * f;
        }
      }

      const lerp = reducedMotion ? 1 : 0.22;
      p.x += (bx - p.x) * lerp;
      p.y += (by - p.y) * lerp;

      ctx.globalAlpha = clamp(0.35 + prog * 0.65, 0, 1);

      ctx.fillStyle = p.color;
      if (p.size <= 2.1) {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (gathering && done) gathering = false;

    animationFrame = requestAnimationFrame(loop);
  };

  const startLoop = (): void => {
    if (animationFrame === 0 && isVisible && isPageVisible) {
      animationFrame = requestAnimationFrame(loop);
    }
  };

  const stopLoop = (): void => {
    if (animationFrame !== 0) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };

  /* ── text sampling ─────────────────────────────────────── */

  const sample = (): void => {
    const id = ++buildId;
    const el = container;
    const cv = canvas;
    if (!el || !cv) return;

    const rect = el.getBoundingClientRect();
    width = Math.floor(rect.width);
    height = Math.floor(rect.height);
    if (width <= 0 || height <= 0) return;

    const ctx = cv.getContext('2d');
    if (!ctx) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.max(1, Math.floor(width * dpr));
    cv.height = Math.max(1, Math.floor(height * dpr));
    cv.style.width = '100%';
    cv.style.height = '100%';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cs = getComputedStyle(el);
    const fam = fontFamily === 'inherit' ? cs.fontFamily || 'sans-serif' : fontFamily;
    let sz = resolveFontSize(fontSize, fontWeight, fam, el);
    let fontStr = `${fontWeight} ${sz}px ${fam}`;

    const off = document.createElement('canvas');
    const oc = off.getContext('2d', { willReadFrequently: true });
    if (!oc) return;

    const str = String(text || ' ');
    const maxW = width * 0.92;
    oc.font = fontStr;
    let m = oc.measureText(str);

    if (Math.max(1, m.width) > maxW) {
      sz = Math.max(16, sz * (maxW / Math.max(1, m.width)));
      fontStr = `${fontWeight} ${sz}px ${fam}`;
      oc.font = fontStr;
      m = oc.measureText(str);
    }

    if (id !== buildId) return;

    const bl = Math.ceil(m.actualBoundingBoxLeft || 0);
    const br = Math.ceil(m.actualBoundingBoxRight || m.width);
    const ba = Math.ceil(m.actualBoundingBoxAscent || sz * 0.8);
    const bd = Math.ceil(m.actualBoundingBoxDescent || sz * 0.2);
    const pad = Math.max(12, Math.ceil(sz * 0.1));
    const tw = Math.max(1, Math.abs(bl) + br);
    const th = Math.max(1, ba + bd);

    off.width = tw + pad * 2;
    off.height = th + pad * 2;

    oc.font = fontStr;
    oc.textAlign = 'left';
    oc.textBaseline = 'alphabetic';
    oc.fillStyle = '#ffffff';
    oc.fillText(str, pad + Math.max(0, -bl), pad + ba);

    const img = oc.getImageData(0, 0, off.width, off.height);
    const targets: Target[] = [];
    const step = Math.max(2, Math.floor(density));

    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const a = img.data[(y * off.width + x) * 4 + 3] ?? 0;
        if (a > 30) {
          targets.push({
            x: width / 2 - off.width / 2 + x,
            y: height / 2 - off.height / 2 + y,
            alpha: a / 255,
          });
        }
      }
    }

    const cap = clamp((width * height) / 80 | 0, 800, 4500);
    const stride = Math.max(1, Math.ceil(targets.length / cap));
    const base = hexToRgb(color);
    const hi = hexToRgb(highlightColor);
    const pts = targets.filter((_, i) => i % stride === 0);

    particles = pts.map((t, i) => {
      const seed = ((i * 9301 + 49297) % 233280) / 233280;
      const depth = 0.45 + (((i * 233 + 97) % 1000) / 1000) * 0.9;
      const blend = base && hi
        ? clamp(t.x / Math.max(1, width) + (seed - 0.5) * 0.35, 0, 1)
        : 0;
      const col = base && hi ? rgbCss(mixRgb(base, hi, blend)) : color;
      const ang = seed * Math.PI * 2;
      const dist = (reducedMotion ? 0 : scatter) * (0.35 + depth * 0.75);
      const sx = t.x + Math.cos(ang) * dist + (seed - 0.5) * scatter * 0.45;
      const sy = t.y + Math.sin(ang) * dist + (depth - 0.9) * scatter * 0.45;

      return {
        x: reducedMotion ? t.x : sx,
        y: reducedMotion ? t.y : sy,
        startX: sx,
        startY: sy,
        targetX: t.x,
        targetY: t.y,
        size: Math.max(0.6, particleSize * (0.75 + t.alpha * 0.45)),
        color: col,
        seed,
        depth,
        delay: seed * stagger,
      };
    });

    pointer.x = pointer.smoothX = width / 2;
    pointer.y = pointer.smoothY = height / 2;

    if (reducedMotion) {
      for (const p of particles) {
        p.x = p.startX = p.targetX;
        p.y = p.startY = p.targetY;
        p.delay = 0;
      }
      gathering = false;
    } else {
      startGather(false);
    }

    startLoop();
  };

  const queueSample = (): void => {
    if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(sample);
  };

  /* ── pointer handlers ──────────────────────────────────── */

  const onMove = (e: PointerEvent): void => {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.active = true;
  };

  const onLeave = (): void => {
    pointer.active = false;
  };

  const onEnter = (e: PointerEvent): void => {
    onMove(e);
    if (trigger === 'hover') startGather(true);
  };

  const onClick = (): void => {
    if (trigger === 'click') startGather(true);
  };

  const onMotionChange = (e: MediaQueryListEvent): void => {
    reducedMotion = e.matches;
    queueSample();
  };

  const onVisibilityChange = (): void => {
    isPageVisible = !document.hidden;
    if (isPageVisible) startLoop();
    else stopLoop();
  };

  /* ── lifecycle & effects ───────────────────────────────── */

  onMount(() => {
    const el = container;
    const cv = canvas;
    if (!el || !cv) return;

    reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    reduceMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotionQuery.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    cv.addEventListener('pointerenter', onEnter);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('click', onClick);

    resizeObserver = new ResizeObserver(queueSample);
    resizeObserver.observe(el);

    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        isVisible = entry.isIntersecting;
        if (isVisible) startLoop();
        else stopLoop();
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(el);

    queueSample();

    return () => {
      stopLoop();
      if (resizeFrame !== 0) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      reduceMotionQuery?.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);

      cv.removeEventListener('pointerenter', onEnter);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('click', onClick);
    };
  });

  $effect(() => {
    // Reactive tracking for props
    const _t = text;
    const _ps = particleSize;
    const _d = density;
    const _c = color;
    const _hc = highlightColor;
    const _sc = scatter;
    const _gd = gatherDuration;
    const _st = stagger;
    const _pr = pointerRepel;
    const _rr = repelRadius;
    const _id = idleDrift;
    const _tr = trigger;
    const _fs = fontSize;
    const _fw = fontWeight;
    const _ff = fontFamily;
    const _gl = glow;

    if (container && canvas) {
      queueSample();
    }
  });
</script>

<div
  class="particle-text {className}"
  style={toStyleStr(style)}
  aria-label={text}
  bind:this={container}
>
  <canvas class="particle-text__canvas" aria-hidden="true" bind:this={canvas}></canvas>
  <span class="particle-text__sr">{text}</span>
</div>

<style>
  .particle-text {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 240px;
    overflow: hidden;
    touch-action: none;
    isolation: isolate;
  }

  .particle-text__canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .particle-text__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>