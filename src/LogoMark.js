import React from "react";

/* ────────────────────────────────────────────────────────────────────────
   The Easy Duty Rota mark — three stacked bars, the shape of a rota, with
   the two accent circles.

   Drawn as SVG rather than loaded as an image so it stays sharp at any
   size, carries no file weight, and can be recoloured if it ever needs to
   sit on a dark background. Used on the login page and in the top bar.
   ──────────────────────────────────────────────────────────────────────── */

const C = {
  orange: "#E89B4C",
  blue: "#4C9BDE",
  green: "#82C25E",
  purpleLight: "#C9BEE6",
  purpleDark: "#8E7CC3",
};

let gradientSeq = 0;

export default function LogoMark({ size = 44, style }) {
  /* Each instance needs its own gradient id — two SVGs sharing one id makes
     the second silently reuse the first, which breaks if either is removed. */
  const id = React.useMemo(() => `edrPurple${++gradientSeq}`, []);
  return (
    <svg
      width={size}
      height={size}
      viewBox="24 13 52 50"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="1" y1="0" x2="0" y2="1">
          <stop offset="50%" stopColor={C.purpleDark} />
          <stop offset="50%" stopColor={C.purpleLight} />
        </linearGradient>
      </defs>
      <circle cx="32.9" cy="22.5" r="5.9" fill={C.orange} />
      <rect x="43" y="16.7" width="30" height="11.7" rx="3.4" fill={C.orange} />
      <rect x="27" y="32.2" width="30.3" height="11.6" rx="3.4" fill={C.blue} />
      <rect x="27" y="47.5" width="30.3" height="11.9" rx="3.4" fill={C.green} />
      <circle cx="67.2" cy="53.4" r="5.9" fill={`url(#${id})`} />
    </svg>
  );
}