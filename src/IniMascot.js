/* IniMascot.js
   Ini, the Easy Duty Rota rota assistant, drawn as a living vector.

   <IniMascot mood="listening" size={48} />

   mood:   'resting' | 'waking' | 'listening' | 'reading' | 'spotted' | 'done'
           Changing the mood melts Ini smoothly from one face to the next.
   size:   width in pixels (height follows). Default 48.
   shadow: true draws the soft shadow under Ini (for large sizes). Default false.
   label:  text for screen readers. Default "Ini".

   Ini blinks now and then and bobs gently. Both stop for anyone who has
   "reduce motion" turned on. Everything is drawn with inline SVG attributes,
   so nothing depends on CSS classes. Ini's colours are fixed in both themes.
   No libraries, no network. */

import { useEffect, useLayoutEffect, useRef } from 'react';

const C = { body: '#9FD068', lid: '#8DBF55', eye: '#FFFFFF', pupil: '#9C6000' };
const SHADOW = 'rgba(29, 43, 38, 0.14)';

/* A blob from four anchor points (top, right, bottom, left), each corner with
   its own roundness. Every mood has the same structure, so one can melt into
   the next. */
function blob(o) {
  const { cx, cy, wl, wr, ht, hb, tx = 0, bx = 0, ry = 0, ly = 0, k = [0.62, 0.62, 0.62, 0.62] } = o;
  const T = [cx + tx, cy - ht];
  const R = [cx + wr, cy + ry];
  const B = [cx + bx, cy + hb];
  const L = [cx - wl, cy + ly];
  const [kTR, kBR, kBL, kTL] = k;
  return [
    T[0], T[1],
    T[0] + (R[0] - T[0]) * kTR, T[1], R[0], R[1] - (R[1] - T[1]) * kTR, R[0], R[1],
    R[0], R[1] + (B[1] - R[1]) * kBR, B[0] + (R[0] - B[0]) * kBR, B[1], B[0], B[1],
    B[0] - (B[0] - L[0]) * kBL, B[1], L[0], L[1] + (B[1] - L[1]) * kBL, L[0], L[1],
    L[0], L[1] - (L[1] - T[1]) * kTL, T[0] - (T[0] - L[0]) * kTL, T[1], T[0], T[1],
  ];
}
const eye = (cx, cy, r, o = {}) => ({ cx, cy, r, sy: 1, lid: 0, tilt: 0, pdx: 0, pdy: 0, pr: r * 0.24, ...o });

export const INI_MOODS = {
  resting: {
    name: 'resting',
    body: blob({ cx: 100, cy: 92, wl: 56, wr: 50, ht: 50, hb: 46, tx: -2, bx: -4, ry: -4, ly: 6, k: [0.6, 0.7, 0.74, 0.6] }),
    eyes: [eye(80, 90, 14, { sy: 0.5, lid: 1 }), eye(116, 90, 14, { sy: 0.5, lid: 1 })],
    mouth: { x: 98, y: 108, w: 0, curve: 0, o: 3 },
  },
  waking: {
    name: 'waking up',
    body: blob({ cx: 100, cy: 86, wl: 54, wr: 54, ht: 60, hb: 56, k: [0.8, 0.78, 0.78, 0.8] }),
    eyes: [eye(80, 114, 15, { sy: 0.55, lid: 0.5, pdx: -5, pr: 3.4 }), eye(120, 114, 15, { sy: 0.55, lid: 0.5, pdx: -5, pr: 3.4 })],
    mouth: { x: 100, y: 128, w: 0, curve: 0, o: 2 },
  },
  listening: {
    name: 'listening',
    body: blob({ cx: 100, cy: 88, wl: 70, wr: 70, ht: 54, hb: 52, k: [0.8, 0.8, 0.8, 0.8] }),
    eyes: [eye(80, 80, 19, { pdx: -3, pdy: -4, pr: 4.4 }), eye(120, 80, 19, { pdx: -3, pdy: -4, pr: 4.4 })],
    mouth: { x: 100, y: 105, w: 12, curve: 3.5, o: 0 },
  },
  reading: {
    name: 'reading your note',
    body: blob({ cx: 100, cy: 104, wl: 72, wr: 72, ht: 44, hb: 36, ry: 6, ly: 6, k: [0.62, 0.8, 0.8, 0.62] }),
    eyes: [eye(84, 90, 12, { sy: 0.75, lid: 0.42, tilt: 14, pdy: 2, pr: 3.4 }), eye(116, 90, 12, { sy: 0.75, lid: 0.42, tilt: -14, pdy: 2, pr: 3.4 })],
    mouth: { x: 100, y: 106, w: 0, curve: 0, o: 1.8 },
  },
  spotted: {
    name: 'spotted something',
    body: blob({ cx: 100, cy: 94, wl: 66, wr: 64, ht: 46, hb: 44, tx: -12, bx: 4, ry: 8, ly: -2, k: [0.7, 0.62, 0.72, 0.7] }),
    eyes: [eye(78, 96, 17, { pr: 6 }), eye(114, 90, 19, { pr: 6.4 })],
    mouth: { x: 97, y: 122, w: 0, curve: 0, o: 4 },
  },
  done: {
    name: 'all done',
    body: blob({ cx: 100, cy: 98, wl: 56, wr: 54, ht: 58, hb: 44, tx: 14, ry: 6, ly: 10, k: [0.5, 0.78, 0.78, 0.6] }),
    eyes: [eye(84, 104, 15, { pdy: -5, pr: 4.2 }), eye(116, 104, 15, { pdy: -5, pr: 4.2 })],
    mouth: { x: 100, y: 124, w: 9, curve: 3, o: 0 },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const lerp = (a, b, t) => {
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) return a.map((x, i) => lerp(x, b[i], t));
  const o = {};
  for (const key of Object.keys(a)) o[key] = typeof a[key] === 'string' ? b[key] : lerp(a[key], b[key], t);
  return o;
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const f = (n) => Math.round(n * 100) / 100;

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) {
    return false;
  }
}

/* The gentle bob needs keyframes, which inline styles can't hold, so they are
   added to the page once. If they are missing (for example in a DOM copy),
   Ini simply stands still. */
const STYLE_ID = 'ini-mascot-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent =
    '@keyframes iniMascotBob{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-4px) scale(1.012,0.99)}}' +
    '@keyframes iniMascotShade{0%,100%{transform:scaleX(1);opacity:1}50%{transform:scaleX(0.9);opacity:0.75}}';
  document.head.appendChild(s);
}

let idCounter = 0;

/* Writes one frame of Ini into the SVG nodes. */
function paint(n, s, blinkAmt) {
  if (!n.body) return;
  const b = s.body.map(f);
  n.body.setAttribute('d',
    `M${b[0]},${b[1]} C${b[2]},${b[3]} ${b[4]},${b[5]} ${b[6]},${b[7]} C${b[8]},${b[9]} ${b[10]},${b[11]} ${b[12]},${b[13]} ` +
    `C${b[14]},${b[15]} ${b[16]},${b[17]} ${b[18]},${b[19]} C${b[20]},${b[21]} ${b[22]},${b[23]} ${b[24]},${b[25]} Z`);
  s.eyes.forEach((e, i) => {
    const node = n.eyes[i];
    if (!node || !node.white) return;
    const ry = e.r * e.sy;
    [node.clip, node.white].forEach((shape) => {
      if (!shape) return;
      shape.setAttribute('cx', f(e.cx));
      shape.setAttribute('cy', f(e.cy));
      shape.setAttribute('rx', f(e.r));
      shape.setAttribute('ry', f(ry));
    });
    const lim = Math.max(0, e.r - e.pr - 2);
    const lx = Math.max(-lim, Math.min(lim, e.pdx));
    const lyy = Math.max(-ry, Math.min(ry, e.pdy));
    node.pupil.setAttribute('cx', f(e.cx + lx));
    node.pupil.setAttribute('cy', f(e.cy + lyy));
    node.pupil.setAttribute('r', f(e.pr));
    const lid = Math.max(e.lid, blinkAmt);
    const top = e.cy - ry - 3;
    const H = 2 * ry + 6;
    const h = H * lid;
    node.lid.setAttribute('x', f(e.cx - e.r - 8));
    node.lid.setAttribute('y', f(top));
    node.lid.setAttribute('width', f(2 * e.r + 16));
    node.lid.setAttribute('height', f(h));
    const lashY = top + Math.min(h, H * 0.55);
    node.lash.setAttribute('x1', f(e.cx - e.r - 4));
    node.lash.setAttribute('x2', f(e.cx + e.r + 4));
    node.lash.setAttribute('y1', f(lashY));
    node.lash.setAttribute('y2', f(lashY));
    node.lash.setAttribute('opacity', f(Math.max(0, Math.min(1, (lid - 0.1) * 5))));
    node.lidG.setAttribute('transform', `rotate(${f(e.tilt)} ${f(e.cx)} ${f(e.cy)})`);
  });
  const m = s.mouth;
  n.smile.setAttribute('d', `M${f(m.x - m.w / 2)},${f(m.y)} Q${f(m.x)},${f(m.y + m.curve * 2)} ${f(m.x + m.w / 2)},${f(m.y)}`);
  n.smile.setAttribute('opacity', m.w > 1 ? 1 : 0);
  n.o.setAttribute('cx', f(m.x));
  n.o.setAttribute('cy', f(m.y));
  n.o.setAttribute('rx', f(Math.max(m.o, 0)));
  n.o.setAttribute('ry', f(Math.max(m.o * 1.15, 0)));
  n.o.setAttribute('opacity', m.o > 0.4 ? 1 : 0);
}

export default function IniMascot({ mood = 'listening', size = 48, shadow = false, label = 'Ini', style, className }) {
  const target = INI_MOODS[mood] ? mood : 'listening';
  const idRef = useRef(null);
  if (idRef.current === null) { idCounter += 1; idRef.current = `ini-mascot-${idCounter}`; }
  const id = idRef.current;

  const nodes = useRef({ eyes: [{}, {}] });
  const cur = useRef(clone(INI_MOODS[target]));
  const blink = useRef(0);
  const reduce = useRef(false);
  const tween = useRef(null);

  // Draw the first frame before the browser shows anything, so Ini never
  // flashes up empty.
  useLayoutEffect(() => {
    reduce.current = prefersReducedMotion();
    if (!reduce.current) ensureKeyframes();
    paint(nodes.current, cur.current, 0);
  }, []);

  // Blink now and then.
  useEffect(() => {
    if (reduce.current) return undefined;
    let alive = true;
    let timer = null;
    let frame = null;
    const schedule = () => {
      timer = setTimeout(() => {
        const t0 = performance.now();
        const d = 170;
        const step = () => {
          const now = performance.now();
          if (!alive) return;
          const t = Math.min(1, (now - t0) / d);
          blink.current = t < 0.5 ? t * 2 : (1 - t) * 2;
          paint(nodes.current, cur.current, blink.current);
          if (t < 1) frame = requestAnimationFrame(step);
          else { blink.current = 0; paint(nodes.current, cur.current, 0); schedule(); }
        };
        frame = requestAnimationFrame(step);
      }, 2600 + Math.random() * 3800);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); if (frame) cancelAnimationFrame(frame); };
  }, []);

  // Melt into a new mood whenever it changes.
  useEffect(() => {
    const to = INI_MOODS[target];
    if (tween.current) cancelAnimationFrame(tween.current);
    if (reduce.current || prefersReducedMotion()) {
      cur.current = clone(to);
      paint(nodes.current, cur.current, blink.current);
      return undefined;
    }
    const from = clone(cur.current);
    const t0 = performance.now();
    const ms = 520;
    const step = () => {
      const now = performance.now();
      const t = Math.min(1, (now - t0) / ms);
      cur.current = lerp(from, to, ease(t));
      paint(nodes.current, cur.current, blink.current);
      tween.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    tween.current = requestAnimationFrame(step);
    return () => { if (tween.current) cancelAnimationFrame(tween.current); tween.current = null; };
  }, [target]);

  const motion = !prefersReducedMotion();
  const set = (path) => (el) => {
    if (!el) return;
    const [a, b, c] = path;
    if (c !== undefined) nodes.current[a][b][c] = el;
    else if (b !== undefined) nodes.current[a][b] = el;
    else nodes.current[a] = el;
  };

  return (
    <svg
      className={className}
      viewBox={shadow ? '0 0 200 172' : '20 20 160 140'}
      width={size}
      height={Math.round(size * (shadow ? 172 / 200 : 140 / 160))}
      role="img"
      aria-label={`${label}, ${INI_MOODS[target].name}`}
      style={{ display: 'block', overflow: 'visible', ...style }}
    >
      <defs>
        {[0, 1].map((i) => (
          <clipPath id={`${id}-c${i}`} key={i}>
            <ellipse ref={set(['eyes', i, 'clip'])} />
          </clipPath>
        ))}
      </defs>
      {shadow && (
        <ellipse
          cx="100" cy="156" rx="52" ry="7" fill={SHADOW}
          style={motion ? { animation: 'iniMascotShade 3.4s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: '50% 50%' } : undefined}
        />
      )}
      <g style={motion ? { animation: 'iniMascotBob 3.4s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: '50% 100%' } : undefined}>
        <path ref={set(['body'])} fill={C.body} />
        {[0, 1].map((i) => (
          <g clipPath={`url(#${id}-c${i})`} key={i}>
            <ellipse ref={set(['eyes', i, 'white'])} fill={C.eye} />
            <circle ref={set(['eyes', i, 'pupil'])} fill={C.pupil} />
            <g ref={set(['eyes', i, 'lidG'])}>
              <rect ref={set(['eyes', i, 'lid'])} fill={C.lid} />
              <line ref={set(['eyes', i, 'lash'])} stroke={C.pupil} strokeWidth="2.6" strokeLinecap="round" />
            </g>
          </g>
        ))}
        <path ref={set(['smile'])} fill="none" stroke={C.pupil} strokeWidth="2.6" strokeLinecap="round" />
        <ellipse ref={set(['o'])} fill={C.pupil} />
      </g>
    </svg>
  );
}
