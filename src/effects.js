// ============================================================
// src/effects.js — Sons, vibration, confettis
// ============================================================
// • Sons : générés en Web Audio API (pas de MP3 à héberger)
// • Vibration : navigator.vibrate (Android only, ignoré ailleurs)
// • Confettis : fonction qui crée des divs CSS animées
// • Settings : on/off persistés en localStorage
// ============================================================

const LS = {
  SOUND: 'cj_sound_on',
  VIBRATION: 'cj_vibration_on',
};

// --- Settings ---
export function isSoundOn() {
  try { return localStorage.getItem(LS.SOUND) !== '0'; } catch { return true; }
}
export function isVibrationOn() {
  try { return localStorage.getItem(LS.VIBRATION) !== '0'; } catch { return true; }
}
export function setSoundOn(v) {
  try { localStorage.setItem(LS.SOUND, v ? '1' : '0'); } catch {}
}
export function setVibrationOn(v) {
  try { localStorage.setItem(LS.VIBRATION, v ? '1' : '0'); } catch {}
}

// --- Audio context (créé à la 1ère interaction utilisateur, exigence des navigateurs) ---
let ctx = null;
function getCtx() {
  if (!ctx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    } catch { /* tant pis */ }
  }
  return ctx;
}

// Joue une note simple
function tone({ freq, duration = 0.15, type = 'sine', volume = 0.15, delay = 0 }) {
  const c = getCtx();
  if (!c) return;
  const startTime = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  // Enveloppe douce pour éviter les clics
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// --- Sons disponibles ---
const SOUNDS = {
  click:   () => tone({ freq: 800,  duration: 0.06, type: 'square',   volume: 0.08 }),
  pop:     () => tone({ freq: 1200, duration: 0.05, type: 'triangle', volume: 0.10 }),
  // Carillon montant pour les notifs / invitations
  notify:  () => {
    tone({ freq: 660, duration: 0.15, type: 'sine', volume: 0.15, delay: 0 });
    tone({ freq: 880, duration: 0.20, type: 'sine', volume: 0.15, delay: 0.12 });
  },
  // Joyeuse fanfare montante quand on gagne (do mi sol do)
  victory: () => {
    tone({ freq: 523, duration: 0.18, type: 'triangle', volume: 0.18, delay: 0 });
    tone({ freq: 659, duration: 0.18, type: 'triangle', volume: 0.18, delay: 0.16 });
    tone({ freq: 784, duration: 0.18, type: 'triangle', volume: 0.18, delay: 0.32 });
    tone({ freq: 1047, duration: 0.40, type: 'triangle', volume: 0.20, delay: 0.48 });
  },
  // Triste descendant quand on perd
  defeat: () => {
    tone({ freq: 392, duration: 0.20, type: 'sine', volume: 0.15, delay: 0 });
    tone({ freq: 330, duration: 0.20, type: 'sine', volume: 0.15, delay: 0.18 });
    tone({ freq: 262, duration: 0.40, type: 'sine', volume: 0.15, delay: 0.34 });
  },
  // Égalité : 2 notes mêmes hauteur
  draw: () => {
    tone({ freq: 440, duration: 0.15, type: 'sine', volume: 0.12, delay: 0 });
    tone({ freq: 440, duration: 0.20, type: 'sine', volume: 0.12, delay: 0.18 });
  },
  // Petit "tac" quand on joue un coup
  move: () => tone({ freq: 600, duration: 0.04, type: 'square', volume: 0.08 }),
  // Erreur (3 notes basses)
  error: () => {
    tone({ freq: 200, duration: 0.08, type: 'sawtooth', volume: 0.10, delay: 0 });
    tone({ freq: 200, duration: 0.08, type: 'sawtooth', volume: 0.10, delay: 0.10 });
  },
};

export function playSound(name) {
  if (!isSoundOn()) return;
  const s = SOUNDS[name];
  if (s) { try { s(); } catch { /* ignore */ } }
}

// --- Vibration ---
export function vibrate(pattern = 30) {
  if (!isVibrationOn()) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

// Combo pratique : clic + vibration courte
export function tap() {
  playSound('click');
  vibrate(20);
}

// --- Confettis (pure CSS/JS, pas de lib) ---
const CONFETTI_COLORS = ['#FF8FB1', '#FFCFD2', '#FFE5D9', '#C7F0BD',
                         '#A8E6CF', '#D7BDE2', '#FFD580', '#FFB3BA'];

export function launchConfetti({ duration = 2500, count = 60 } = {}) {
  // Crée un container temporaire
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 9999; overflow: hidden;
  `;
  document.body.appendChild(container);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    const size = 8 + Math.random() * 8;
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const dur = 1.5 + Math.random() * 1.5;
    const rotateStart = Math.random() * 360;
    const drift = (Math.random() - 0.5) * 200;

    piece.style.cssText = `
      position: absolute;
      top: -20px;
      left: ${left}%;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      animation: cj-confetti-fall ${dur}s ease-in ${delay}s forwards;
      transform: rotate(${rotateStart}deg);
      --drift: ${drift}px;
    `;
    container.appendChild(piece);
  }

  // Cleanup après l'animation
  setTimeout(() => container.remove(), duration + 500);
}

// Injecte le CSS de l'animation une seule fois
if (typeof document !== 'undefined' && !document.getElementById('cj-confetti-styles')) {
  const style = document.createElement('style');
  style.id = 'cj-confetti-styles';
  style.textContent = `
    @keyframes cj-confetti-fall {
      0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
      100% { transform: translate(var(--drift, 0), 110vh) rotate(720deg); opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}
