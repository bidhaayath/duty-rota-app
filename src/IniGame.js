/* ─────────────── Hangman with Ini ───────────────
   Opened from the gamepad icon in the corner Ini's tap bubble. Ini thinks
   of a work-and-rota word (with a hint); you guess letters, by tapping the
   letters shown or typing on the keyboard. Six wrong guesses and the word
   is shown. No hanging figure — this lives in a work app — instead six
   hearts, and Ini's face reacts to each guess through
   `onMood(face, act, ms)` from iniFabLife.js.
   Nothing is saved: the score is for this visit only. It sits inside the
   no-print Ini wrapper, so it never reaches an export.                   */
import React, { useCallback, useEffect, useState } from "react";
import { X, RotateCcw } from "lucide-react";

// Words any manager knows, each with a hint.
export const WORDS = [
  ["SHIFT", "A block of working hours"], ["ROSTER", "Who works when"], ["WEEKEND", "Everyone wants it off"],
  ["HOLIDAY", "A day off for everyone"], ["OVERTIME", "Extra hours"], ["MORNING", "The early shift"],
  ["EVENING", "After the afternoon"], ["NIGHT", "The quiet shift"], ["BREAK", "Time to rest mid-shift"],
  ["COFFEE", "Fuel for the early shift"], ["TEAMWORK", "Working together"], ["MANAGER", "Makes the rota"],
  ["SCHEDULE", "A plan of times"], ["LEAVE", "Time away from work"], ["SWAP", "Trading shifts"],
  ["HANDOVER", "Passing on to the next shift"], ["CALENDAR", "Days, weeks and months"], ["FRIDAY", "Almost the weekend"],
  ["VACATION", "A long trip away"], ["DEADLINE", "When it must be done"], ["MEETING", "Everyone in one room"],
  ["LUNCH", "The midday meal"], ["PAYDAY", "Everyone's favourite day"], ["MONTHLY", "Once a month"],
  ["UNIFORM", "What the team wears"], ["DUTY", "Your job on the rota"], ["COVER", "Filling in for someone"],
  ["STAFF", "The people on the rota"], ["TIMESHEET", "Hours worked, written down"], ["PUNCTUAL", "Always on time"],
];
const LIVES = 6;
const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const WIN_LINES = ["You got it! Brilliant!", "Yes! You're a word wizard.", "Solved! I'm impressed."];
const LOSE_LINES = ["Oh no! Next one's yours.", "So close! Try another?", "Tricky one! Again?"];
const pick = (l) => l[Math.floor(Math.random() * l.length)];
const newWord = (last) => {
  let w;
  do { w = WORDS[Math.floor(Math.random() * WORDS.length)]; } while (WORDS.length > 1 && last && w[0] === last);
  return w;
};

export default function IniGame({ onClose, onMood }) {
  const [[word, hint], setWord] = useState(() => newWord());
  const [guessed, setGuessed] = useState([]);
  const [score, setScore] = useState({ you: 0, ini: 0 });
  const [line, setLine] = useState("Guess the word!");
  const wrong = guessed.filter((l) => !word.includes(l)).length;
  const solved = word.split("").every((l) => guessed.includes(l));
  const over = solved || wrong >= LIVES;

  const guess = useCallback((l) => {
    if (over || guessed.includes(l)) return;
    const next = [...guessed, l];
    setGuessed(next);
    const nowWrong = next.filter((x) => !word.includes(x)).length;
    const nowSolved = word.split("").every((x) => next.includes(x));
    if (nowSolved) { setScore((s) => ({ ...s, you: s.you + 1 })); setLine(pick(WIN_LINES)); onMood("done", "dance", 2200); }
    else if (nowWrong >= LIVES) { setScore((s) => ({ ...s, ini: s.ini + 1 })); setLine(`${pick(LOSE_LINES)} It was ${word}.`); onMood("yawning", "hop", 1800); }
    else if (word.includes(l)) { setLine("Nice one!"); onMood("done", "hop", 900); }
    else { setLine(nowWrong >= LIVES - 1 ? "Careful, one heart left!" : "Not that one…"); onMood(nowWrong >= LIVES - 2 ? "spotted" : "thinking", null, 1000); }
  }, [guessed, over, word, onMood]);

  // Typing a letter on the keyboard guesses it too.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = (e.key || "").toUpperCase();
      if (k.length === 1 && k >= "A" && k <= "Z") guess(k);
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guess, onClose]);

  const again = () => { setWord(newWord(word)); setGuessed([]); setLine("Guess the word!"); };

  return (
    <div role="dialog" aria-label="Hangman with Ini" style={{
      position: "fixed", right: 16, bottom: 74, zIndex: 902, width: 260, maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", padding: 12,
      background: "#142B33", color: "#fff", borderRadius: "16px 16px 4px 16px", boxShadow: "0 10px 28px rgba(20,43,51,0.3)",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span aria-label={`${LIVES - wrong} hearts left`} style={{ fontSize: 13, letterSpacing: 1 }}>
          {Array.from({ length: LIVES }, (_, i) => (
            <span key={i} aria-hidden="true" style={{ opacity: i < LIVES - wrong ? 1 : 0.22, transition: "opacity 200ms ease" }}>{i < LIVES - wrong ? "❤️" : "🤍"}</span>
          ))}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>You {score.you} · Ini {score.ini}</span>
          <button type="button" aria-label="Close the game" onClick={onClose}
            style={{ width: 24, height: 24, padding: 0, border: "none", borderRadius: 999, background: "transparent", color: "rgba(255,255,255,0.75)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <X size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>Hint: {hint}</div>
      <div aria-label={over ? `The word: ${word}` : `The word, ${word.length} letters`}
        style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
        {word.split("").map((l, i) => {
          const shown = guessed.includes(l) || over;
          return (
            <span key={i} aria-hidden="true" style={{
              width: 20, height: 26, display: "inline-flex", alignItems: "flex-end", justifyContent: "center",
              borderBottom: "2px solid rgba(255,255,255,0.5)", fontSize: 17, fontWeight: 800,
              color: shown && !guessed.includes(l) ? "#F4A58F" : "#FFFFFF" }}>{shown ? l : ""}</span>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {ABC.map((l) => {
          const used = guessed.includes(l);
          const good = used && word.includes(l);
          return (
            <button key={l} type="button" onClick={() => guess(l)} disabled={used || over} aria-label={`Letter ${l}`}
              style={{
                height: 28, borderRadius: 8, border: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                cursor: used || over ? "default" : "pointer",
                background: good ? "#9ED066" : used ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)",
                color: good ? "#142B33" : used ? "rgba(255,255,255,0.3)" : "#FFFFFF",
              }}>{l}</button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 9, minHeight: 28 }}>
        <span aria-live="polite" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{line}</span>
        {over && (
          <button type="button" aria-label="New word" title="New word" onClick={again}
            style={{ flex: "none", width: 28, height: 28, padding: 0, borderRadius: 999, border: "none", background: "#9ED066", color: "#142B33", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <RotateCcw size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
