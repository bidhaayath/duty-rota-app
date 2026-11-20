/* ─────────────── The corner Ini, alive ───────────────
   The floating Ini button (AssistantPanel.js) used to sleep until tapped.
   Now it has a little life of its own:
     · It wakes up a moment after the page opens, stays awake and curious
       (the eyes follow the pointer), and dozes off only after a quiet
       spell with no mouse, keys or scrolling — sooner late at night.
       Any movement wakes it again.
     · Now and then (every minute or two) it does a little move or pulls
       a face: a wave, a hop, a wiggle, a happy smile, a thinking look.
       Friday brings a dance, late nights a yawn.
     · A tap: a surprised blink, a happy face and a hop, and a short
       encouraging line or rota joke in a bubble — with an "Ask Ini"
       button there to open the panel. Five quick taps: a spin and a jump.
   "Quiet Ini" (iniMoments.js) stops the unasked moves; taps still answer.
   With "reduce motion" nothing moves: Ini is simply awake, and taps still
   show their words. Nothing here is saved anywhere but this browser's
   localStorage (which line comes next), inside try/catch.               */
import { useEffect, useRef, useState } from "react";
import { isQuiet } from "./iniMoments";

// Encouraging lines and rota jokes, for any manager in any workplace.
export const CUTE_LINES = [
  "You're doing great. Rotas are hard, and you make it look easy!",
  "Your team is lucky to have someone who plans this carefully.",
  "Deep breath. One shift at a time.",
  "Fun fact: I have never once asked for a day off.",
  "I'd swap shifts with you, but I'm a blob.",
  "A fair rota is a happy team. You're building one!",
  "Every gap you fill now is one less phone call later.",
  "Don't forget to give yourself a break on the rota too.",
  "Water break! Have a sip. I'll guard the rota.",
  "Coffee is not a duty code. Sadly. I checked.",
  "Why did the rota blush? It saw the weekend shifts.",
  "Swap requests? Bring them on. I love a good puzzle.",
  "Tip: Undo is always there if you change your mind.",
  "Weekends are the hardest to share out. Fairness wins hearts.",
  "If rotas were easy, everyone would make them. You do!",
  "Thanks for looking after everyone's week.",
  "I believe in you. And in your colour-coded shifts.",
  "Psst… tap me five times, really fast.",
];
const NIGHT_LINES = ["It's late! Don't forget to rest too.", "Burning the midnight oil? Finish up and get some sleep!"];
const MORNING_LINES = ["Good morning! Ready for a fresh rota day?", "Morning! Let's make today easy."];
const FRIDAY_LINES = ["Happy Friday! The weekend is almost here.", "It's Friday! Let's wrap up the week nicely."];
const SPIN_LINES = ["Wheee! That tickles!", "Whoa, I'm dizzy! Again?", "Ta-da! Did you see that jump?"];

const QUICK_MS = 1600;            // five taps inside this: spin and jump
const BUBBLE_MS = 6500;
const WAKE_AFTER_MS = 1500;       // asleep when the page opens, then wakes
const DOZE_MS = 3 * 60 * 1000;    // no activity this long: dozes off
const DOZE_NIGHT_MS = 60 * 1000;
const FIDGET_MIN = 60 * 1000;     // a little move every 1–2 minutes
const FIDGET_MAX = 120 * 1000;

const read = (k) => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* only a convenience */ } };
const reduced = () => {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
};
export const timeOfDay = (d = new Date()) => {
  const h = d.getHours();
  if (h >= 22 || h < 5) return "night";
  if (h < 11) return "morning";
  return d.getDay() === 5 ? "friday" : "day";
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// The next encouraging line, in turn, remembered on this device.
export function nextCuteLine() {
  const i = (Number(read("ini:cute")) || 0) % CUTE_LINES.length;
  write("ini:cute", String(i + 1));
  return CUTE_LINES[i];
}

/* `enabled`: the button is on screen. Returns what the button shows:
   `mood` (or null: let the panel's own mood show), `act` for IniMascot,
   `move` ("spin" or null) for the button, `bubble` text, and `onTap`. */
export function useFabLife({ enabled = true, userId } = {}) {
  const [reduce] = useState(reduced);
  const [phase, setPhase] = useState(() => (reduce ? "awake" : "asleep"));   // asleep | waking | awake
  const [face, setFace] = useState(null);       // a passing expression
  const [act, setAct] = useState(null);
  const [move, setMove] = useState(null);
  const [bubble, setBubble] = useState(null);
  const n = useRef(0);
  const taps = useRef([]);
  const greeted = useRef(false);
  const lastActive = useRef(Date.now());
  const timers = useRef({});
  const user = useRef(userId);
  user.current = userId;
  const bubbleRef = useRef(null);
  bubbleRef.current = bubble;
  const busy = useRef(false);   // a game is open: no unasked moves, no dozing
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const later = (name, ms, fn) => { clearTimeout(timers.current[name]); timers.current[name] = setTimeout(fn, ms); };
  const play = (name) => { if (reduce) return; n.current += 1; setAct({ name, n: n.current }); };
  const showFace = (mood, ms) => { setFace(mood); later("face", ms, () => setFace(null)); };
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // Waking: a moment after the page opens, and whenever someone moves.
  const wakeUp = () => {
    if (phaseRef.current === "awake") return;
    if (reduce) { setPhase("awake"); return; }
    setPhase("waking");
    later("wake", 520, () => setPhase("awake"));
  };
  useEffect(() => {
    if (!enabled || phase !== "asleep" || greeted.current) return undefined;
    // Counted as woken only once the timer has run, so a re-render that
    // cancels it simply starts it again.
    const t = setTimeout(() => { greeted.current = true; wakeUp(); }, WAKE_AFTER_MS);
    return () => clearTimeout(t);
  }, [enabled, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dozing off after a quiet spell; any activity wakes Ini again.
  useEffect(() => {
    if (!enabled) return undefined;
    const active = () => {
      lastActive.current = Date.now();
      if (phaseRef.current === "asleep" && greeted.current) wakeUp();
    };
    const events = ["pointermove", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, active, { passive: true }));
    const check = setInterval(() => {
      const limit = timeOfDay() === "night" ? DOZE_NIGHT_MS : DOZE_MS;
      if (phaseRef.current === "awake" && !busy.current && Date.now() - lastActive.current > limit) {
        if (!reduce) play("yawn");
        later("doze", reduce ? 0 : 1600, () => setPhase("asleep"));
      }
    }, 10000);
    return () => { events.forEach((e) => window.removeEventListener(e, active)); clearInterval(check); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // A little move now and then, while awake and the page is in view.
  useEffect(() => {
    if (!enabled || reduce || phase !== "awake") return undefined;
    let t;
    const schedule = () => {
      t = setTimeout(() => {
        const hidden = typeof document !== "undefined" && document.hidden;
        if (!hidden && !isQuiet(user.current) && !bubbleRef.current && !busy.current) {
          const when = timeOfDay();
          const r = Math.random();
          if (when === "night") { if (r < 0.6) play("yawn"); else showFace("thinking", 2200); }
          else if (when === "friday" && r < 0.4) { play("dance"); showFace("done", 1800); }
          else if (r < 0.25) play("wave");
          else if (r < 0.45) play("hop");
          else if (r < 0.6) { play("hop"); showFace("done", 1800); }
          else if (r < 0.75) showFace("thinking", 2200);
          else if (r < 0.88) play("peek");
          else { play("dance"); }
        }
        schedule();
      }, FIDGET_MIN + Math.random() * (FIDGET_MAX - FIDGET_MIN));
    };
    schedule();
    return () => clearTimeout(t);
  }, [enabled, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (text) => { setBubble(text); later("bubble", BUBBLE_MS, () => setBubble(null)); };
  // While the bubble has focus (keyboard users reaching "Ask Ini"), it stays.
  const holdBubble = () => clearTimeout(timers.current.bubble);
  const releaseBubble = () => later("bubble", 2500, () => setBubble(null));
  const hush = () => { clearTimeout(timers.current.bubble); setBubble(null); };

  const onTap = () => {
    const now = Date.now();
    lastActive.current = now;
    greeted.current = true;
    if (phaseRef.current !== "awake") { setPhase("awake"); }
    taps.current = [...taps.current.filter((x) => now - x < QUICK_MS), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      if (!reduce) { setMove("spin"); later("move", 1000, () => setMove(null)); }
      showFace("done", 1600);
      say(pick(SPIN_LINES));
      return;
    }
    // Surprised for a blink, then happy, with a hop.
    setFace("spotted");
    later("face", 260, () => { setFace("done"); later("face", 1500, () => setFace(null)); });
    play("hop");
    const when = timeOfDay();
    const special = { night: NIGHT_LINES, morning: MORNING_LINES, friday: FRIDAY_LINES }[when];
    const key = `ini:tod:${when}:${new Date().toDateString()}`;
    if (special && !read(key)) { write(key, "1"); say(pick(special)); }
    else say(nextCuteLine());
  };

  /* For the game: a face for a moment, and a move with it. */
  const react = (mood, move, ms = 1600) => {
    lastActive.current = Date.now();
    if (phaseRef.current !== "awake") setPhase("awake");
    if (mood) showFace(mood, ms);
    if (move) play(move);
  };
  const setBusy = (on) => { busy.current = !!on; };

  const mood = face || (phase === "asleep" ? "resting" : phase === "waking" ? "waking" : "listening");
  return { mood, act, move, bubble, onTap, hush, holdBubble, releaseBubble, react, setBusy };
}

/* The newest of two `act`s ({ name, n }), as one changing `act`, so both the
   moments and the corner Ini's own moves play on the same mascot. */
export function useNewestAct(a, b) {
  const [out, setOut] = useState(null);
  const k = useRef(0);
  const aN = a ? a.n : null;
  const bN = b ? b.n : null;
  useEffect(() => { if (a) { k.current += 1; setOut({ name: a.name, n: k.current }); } }, [aN]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (b) { k.current += 1; setOut({ name: b.name, n: k.current }); } }, [bN]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}
