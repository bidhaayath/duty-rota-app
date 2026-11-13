/* ─────────────── Ini, on Smart Roster ───────────────
   The "Ask Ini" bar above the three steps: Ini, a box to write in, and Send,
   which hands the note to the Ini panel (AssistantPanel.js) to read straight
   away — its usual flow, nothing new: what Ini finds is shown as a checklist
   there, and nothing is saved until "Add" is pressed.

   The Ini here is the same Ini as the panel's (IniMascot.js), awake to its
   surroundings: asleep when the page opens, then waking; listening, eyes on
   the box, while it has the cursor; thinking while a week is made or the
   panel is working; pleased when a week is ready or "Fix it for me" worked.
   The eyes follow the pointer and the body gently changes shape. A hover
   lifts and tilts Ini and says hello, once; a tap makes Ini jump and say a
   tip; five quick taps, a spin. With "reduce motion" none of it moves: Ini
   is awake at once, looks ahead, and still says what it has to say.

   It is also the Ini that speaks at real moments (iniMoments.js) while
   Smart Roster is open — a dance for a week with every shift covered,
   plain help when something has gone wrong — and the bar has the "Quiet
   Ini" switch, remembered per person on this device.                    */

import React, { useEffect, useRef, useState } from "react";
import { Send, Bell, BellOff } from "lucide-react";
import IniMascot from "./IniMascot";
import { useIniMoments, isQuiet, setQuiet } from "./iniMoments";

export const reducedMotion = () => {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
};

const STYLE_ID = "ini-buddy-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent =
    "@keyframes iniBuddyHop{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-12px) rotate(-8deg)}"
    + "60%{transform:translateY(0) rotate(6deg)}80%{transform:translateY(-3px) rotate(-3deg)}}"
    + "@keyframes iniBuddySpin{0%{transform:rotate(0) scale(1)}50%{transform:rotate(200deg) scale(1.12)}100%{transform:rotate(360deg) scale(1)}}";
  document.head.appendChild(s);
}

/* Where Ini's eyes turn: towards the pointer, wherever it is on the page,
   measured from the middle of `ref`. Once a frame at most. */
export function useLook(ref) {
  const [look, setLook] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (reducedMotion()) return undefined;
    let frame = null;
    let last = null;
    const onMove = (e) => {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const el = ref.current;
        if (!el || !last) return;
        const r = el.getBoundingClientRect();
        const reach = 260;
        const clamp = (v) => Math.max(-1, Math.min(1, v));
        setLook({
          x: clamp((last.clientX - (r.left + r.width / 2)) / reach),
          y: clamp((last.clientY - (r.top + r.height / 2)) / reach),
        });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => { window.removeEventListener("pointermove", onMove); if (frame) cancelAnimationFrame(frame); };
  }, [ref]);
  return look;
}

/* Ini's face on the bar. A tap's surprise is laid over this by IniBuddy. */
export function barMood({ phase, thinking, celebrating }) {
  if (phase === "asleep") return "resting";
  if (phase === "waking") return "waking";
  if (thinking) return "thinking";
  if (celebrating) return "done";
  return "listening";
}

/* What Ini says when tapped, one after another. */
export const TIPS = [
  "The three steps above are always open: go back to any of them.",
  "Nothing reaches the rota until you press Use this roster, and Undo puts it back.",
  "Must is kept even if a shift goes short. Try gives way first.",
  "Tell me about leave, swaps or requests in the box beside me.",
  "Fix it for me changes one number, and says which.",
];
const HELLO = "Hi! Need a hand?";
const WHEE = "Wheee! That tickles!";
const QUICK_MS = 1600;     // five taps inside this is a spin

/* `moment` is what iniMoments has Ini saying and doing: { bubble, act,
   hush }. One bubble at a time: the newest of a tip and a moment shows. */
export function IniBuddy({ mood, look, size = 52, moment = null, quiet = false }) {
  const [reduce] = useState(reducedMotion);
  const [hover, setHover] = useState(false);
  const [bubble, setBubble] = useState(null);
  const [surprised, setSurprised] = useState(false);
  const [move, setMove] = useState(null);           // "hop" | "spin"
  const said = useRef({ hello: false, tip: 0 });
  const taps = useRef([]);
  const timers = useRef({});
  const later = (name, ms, fn) => {
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(fn, ms);
  };
  useEffect(() => { if (!reduce) ensureKeyframes(); }, [reduce]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const momentText = moment && moment.bubble;
  // A moment arriving takes the place of a tip still showing.
  useEffect(() => { if (momentText) { clearTimeout(timers.current.bubble); setBubble(null); } }, [momentText]);
  const say = (text, ms) => {
    if (moment && moment.hush) moment.hush();
    setBubble(text); later("bubble", ms, () => setBubble(null));
  };
  const hello = () => {
    setHover(true);
    // Quiet Ini says nothing unasked; a hover is not asking.
    if (said.current.hello || quiet) return;
    said.current.hello = true;
    say(HELLO, 2600);
  };
  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < QUICK_MS), now];
    setSurprised(true);
    later("surprise", 800, () => setSurprised(false));
    if (taps.current.length >= 5) {
      taps.current = [];
      setMove("spin");
      later("move", 950, () => setMove(null));
      say(WHEE, 2400);
      return;
    }
    setMove("hop");
    later("move", 650, () => setMove(null));
    say(TIPS[said.current.tip % TIPS.length], 4200);
    said.current.tip += 1;
  };

  const lifted = !reduce && hover && !move;
  const shown = bubble || momentText || null;
  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button type="button" aria-label="Ini: tap for a tip" onClick={tap}
        onPointerEnter={hello} onPointerLeave={() => setHover(false)}
        style={{
          background: "none", border: "none", padding: 4, margin: 0, cursor: "pointer", minWidth: 44, minHeight: 44,
          display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 12,
          transform: lifted ? "translateY(-3px) rotate(-6deg)" : undefined,
          transition: reduce ? undefined : "transform 180ms cubic-bezier(0.23, 1, 0.32, 1)",
          animation: reduce || !move ? undefined
            : move === "spin" ? "iniBuddySpin 900ms cubic-bezier(0.34, 1.4, 0.64, 1)" : "iniBuddyHop 620ms ease-out",
        }}>
        <IniMascot mood={surprised ? "spotted" : mood} look={reduce ? undefined : look} morph={!reduce} size={size}
          act={moment ? moment.act : undefined} />
      </button>
      {/* Read out when Ini says something; empty otherwise. */}
      <span aria-live="polite"
        style={shown ? {
          position: "absolute", left: "calc(100% + 6px)", bottom: "calc(100% - 14px)", zIndex: 2, width: "max-content", maxWidth: 230,
          background: "#142B33", color: "#fff", fontSize: 12.5, fontWeight: 600, lineHeight: 1.4, padding: "7px 10px",
          borderRadius: "12px 12px 12px 4px", boxShadow: "0 6px 18px rgba(20,43,51,0.18)", pointerEvents: "none",
        } : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {shown || ""}
      </span>
    </span>
  );
}

/* The bar: Ini, the box, and Send. Enter sends too. */
export function AskIniBar({ onAsk, thinking = false, celebrating = false, editable = true, T, userId }) {
  const [text, setText] = useState("");
  // The Ini that speaks at moments while Smart Roster is open (before the floating one).
  const moment = useIniMoments({ userId, priority: 2 });
  const [quiet, setQuietState] = useState(() => isQuiet(userId));
  useEffect(() => { setQuietState(isQuiet(userId)); }, [userId]);
  const toggleQuiet = () => {
    const on = !quiet;
    setQuiet(userId, on);
    setQuietState(on);
    if (on) moment.hush();
  };
  const [focused, setFocused] = useState(false);
  const [phase, setPhase] = useState(() => (reducedMotion() ? "awake" : "asleep"));
  useEffect(() => {
    if (phase === "awake") return undefined;
    const t = setTimeout(() => setPhase(phase === "asleep" ? "waking" : "awake"), phase === "asleep" ? 900 : 520);
    return () => clearTimeout(t);
  }, [phase]);
  const here = useRef(null);
  const pointer = useLook(here);
  // While the box has the cursor, Ini looks at it.
  const look = focused ? { x: 0.85, y: 0.15 } : pointer;
  const mood = barMood({ phase, thinking, celebrating });

  const send = () => {
    const note = text.trim();
    if (!note || !editable) return;
    onAsk(note);
    setText("");
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px 10px", flexWrap: "wrap", background: "#fff",
                  border: `1px solid ${T.line}`, borderRadius: 14, padding: "6px 10px" }}>
      <span ref={here} style={{ display: "inline-flex" }}><IniBuddy mood={mood} look={look} moment={moment} quiet={quiet} /></span>
      <input aria-label="Ask Ini a question" value={text} disabled={!editable}
        placeholder="Ask Ini — e.g. Mariyam is on leave 10th to 15th"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => { setFocused(true); if (phase !== "awake") setPhase("awake"); }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
        style={{ flex: "1 1 200px", minWidth: 0, minHeight: 44, boxSizing: "border-box", fontFamily: "inherit", fontSize: 14,
                 color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "0 12px", background: "#fff" }} />
      <button type="button" onClick={send} disabled={!editable || !text.trim()}
        style={{ fontFamily: "inherit", fontSize: 14, fontWeight: 700, minHeight: 44, padding: "0 16px", borderRadius: 10, border: "none",
                 display: "inline-flex", alignItems: "center", gap: 6, background: T.lagoon, color: "#fff",
                 opacity: !editable || !text.trim() ? 0.5 : 1, cursor: !editable || !text.trim() ? "not-allowed" : "pointer" }}>
        <Send size={15} /> Send
      </button>
      {/* Quiet Ini: no unasked bubbles or dancing. Taps are still answered. */}
      <button type="button" aria-pressed={quiet} onClick={toggleQuiet}
        title={quiet ? "Ini stays quiet until you tap it" : "Ini says a word at good moments"}
        style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, minHeight: 44, padding: "0 12px", borderRadius: 10,
                 border: `1px solid ${quiet ? T.lagoon : T.line}`, background: quiet ? "#D8EEE9" : "#fff",
                 color: quiet ? T.lagoon : T.inkSoft, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
        {quiet ? <BellOff size={14} /> : <Bell size={14} />} Quiet Ini
      </button>
    </div>
  );
}
