import React, { useState, useEffect } from 'react';
import { signup as sbSignup, login as sbLogin, logout as sbLogout,
         getProfile, saveAvatar as sbSaveAvatar, supabase } from './supabase';

// ============================================================
// CLICJEU v6 — Auth pseudo + PIN BRANCHÉE SUR SUPABASE
// (anciennement GameHub)
// ------------------------------------------------------------
// Changements par rapport à v4 :
//   • Auth = pseudo + PIN 4 chiffres (au lieu d'email + magic link)
//   • Sur l'accueil : choix "Local" (même appareil) ou "Online"
//   • Mode online = placeholder pour l'instant (Supabase à venir)
//   • Avatar choisi APRÈS la création du compte (2 étapes)
//
// Toute la logique d'auth est encore en MOCK (localStorage).
// Quand on branchera Supabase, on remplacera 4 fonctions :
//   signup(), login(), logout(), saveAvatar()
// ============================================================

// --- Palette Kawaii ---
const C = {
  bgGradient: 'linear-gradient(180deg, #FFF5F0 0%, #FFE6F0 100%)',
  ink: '#5C4A3D', inkLight: '#7A6657', inkSoft: '#A08B7C',
  pink: '#FFC5D6', mint: '#B8E6D9', blue: '#C5DDF5',
  lavender: '#DCC5F7', peach: '#FFD4B8',
  accentPink: '#FF8FB1', white: '#FFFFFF', cream: '#FFF9F5',
};

const AVATARS = ['🦊','🐼','🐶','🐱','🐰','🦁','🐯','🐸','🐨','🐵','🦄','🐙'];

// On garde juste "vu l'onboarding" en localStorage.
// Le compte est dans Supabase maintenant.
const LS = { ONBOARDED: 'gh_onboarded' };

function useGoogleFonts() {
  useEffect(() => {
    // Fonts
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Quicksand:wght@500;600;700&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);

    // Animations CSS personnalisées
    const style = document.createElement('style');
    style.textContent = `
      @keyframes clic-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes clic-pop {
        0%   { transform: scale(0.5); opacity: 0; }
        60%  { transform: scale(1.15); opacity: 1; }
        100% { transform: scale(1); }
      }
      @keyframes clic-celebrate {
        0%, 100% { transform: rotate(0deg) scale(1); }
        25%      { transform: rotate(-6deg) scale(1.08); }
        75%      { transform: rotate(6deg) scale(1.08); }
      }
      @keyframes clic-shake {
        0%, 100% { transform: translateX(0); }
        25%      { transform: translateX(-5px); }
        75%      { transform: translateX(5px); }
      }
      .clic-fade-in     { animation: clic-fade-in 0.35s ease-out; }
      .clic-pop         { animation: clic-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .clic-celebrate   { animation: clic-celebrate 0.8s ease-in-out infinite; display: inline-block; }
      .clic-shake       { animation: clic-shake 0.4s ease-in-out; }
      .clic-press:active{ transform: scale(0.95); transition: transform 0.05s; }
      button { transition: transform 0.15s, box-shadow 0.15s; }
    `;
    document.head.appendChild(style);

    return () => {
      try { document.head.removeChild(link); } catch (e) {}
      try { document.head.removeChild(style); } catch (e) {}
    };
  }, []);
}

// ============================================================
// COMPOSANT RACINE — branché sur Supabase
// ============================================================
export default function App() {
  useGoogleFonts();

  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(LS.ONBOARDED) === '1');
  const [profile, setProfile]     = useState(null);   // { pseudo, avatar, id, ... } ou null
  const [loading, setLoading]     = useState(true);   // true tant qu'on n'a pas vérifié la session

  // Au chargement : on demande à Supabase "qui est connecté ?"
  // Et on écoute les changements (connexion / déconnexion)
  useEffect(() => {
    let mounted = true;

    // Vérif initiale
    getProfile().then((p) => {
      if (mounted) { setProfile(p); setLoading(false); }
    });

    // Écouteur d'événements auth (login, logout, refresh token...)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session) {
        const p = await getProfile();
        setProfile(p);
      } else {
        setProfile(null);
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // --- Actions ---
  const completeOnboarding = () => {
    localStorage.setItem(LS.ONBOARDED, '1');
    setOnboarded(true);
  };

  // Renvoie { ok, error } pour que les formulaires affichent les erreurs
  const signup = async ({ pseudo, pin }) => {
    const result = await sbSignup({ pseudo, pin });
    // Le profil sera chargé automatiquement via onAuthStateChange
    return result;
  };

  const login = async ({ pseudo, pin }) => {
    const result = await sbLogin({ pseudo, pin });
    return result;
  };

  const logout = async () => {
    await sbLogout();
    // setProfile(null) sera déclenché par onAuthStateChange
  };

  const saveAvatar = async (avatar) => {
    const result = await sbSaveAvatar(avatar);
    if (result.ok) setProfile((p) => ({ ...p, avatar }));
  };

  // --- Routage ---
  let screen;
  if (!onboarded) {
    screen = <Onboarding onDone={completeOnboarding} />;
  } else if (loading) {
    screen = <LoadingScreen />;
  } else if (!profile) {
    screen = <AuthFlow initialMode="signup" onSignup={signup} onLogin={login} />;
  } else if (!profile.avatar) {
    screen = <AvatarPicker pseudo={profile.pseudo} onSave={saveAvatar} onLogout={logout} />;
  } else {
    screen = <GameHub profile={profile} onLogout={logout} />;
  }

  // On donne une "clé" à l'écran courant pour relancer l'animation fade-in
  // à chaque changement d'écran. Astuce React classique.
  const screenKey = !onboarded ? 'onb'
                  : loading ? 'load'
                  : !profile ? 'auth'
                  : !profile.avatar ? 'avatar'
                  : 'app';

  return (
    <div className="min-h-screen relative" style={{
      background: C.bgGradient,
      fontFamily: '"Quicksand", sans-serif',
      color: C.ink,
    }}>
      <SparkleBg />
      <div key={screenKey} className="relative clic-fade-in">{screen}</div>
    </div>
  );
}

function SparkleBg() {
  return (
    <div className="absolute inset-0 pointer-events-none opacity-50" style={{
      backgroundImage:
        'radial-gradient(circle at 12% 18%, rgba(255,197,214,0.5) 2px, transparent 2px), ' +
        'radial-gradient(circle at 87% 35%, rgba(220,197,247,0.5) 2px, transparent 2px), ' +
        'radial-gradient(circle at 35% 75%, rgba(255,212,184,0.5) 2px, transparent 2px), ' +
        'radial-gradient(circle at 75% 88%, rgba(184,230,217,0.5) 2px, transparent 2px)',
      backgroundSize: '120px 120px, 150px 150px, 100px 100px, 140px 140px',
    }} />
  );
}

// ============================================================
// LOADING SCREEN — affiché pendant que Supabase vérifie la session
// ============================================================
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-3 animate-bounce">🎮</div>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>Chargement...</p>
      </div>
    </div>
  );
}

// ============================================================
// ONBOARDING — 3 slides
// ============================================================
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);

  const slides = [
    { bg: C.pink,     emoji: '🎮', title: 'Bienvenue !',
      text: 'ClicJeu, c\'est 5 jeux fun à jouer à 2.' },
    { bg: C.mint,     emoji: '🎯', title: '5 jeux pour s\'amuser',
      text: 'Morpion, Puissance 4, Memory, Bataille Navale et Pendu !' },
    { bg: C.lavender, emoji: '✨', title: 'Local ou en ligne',
      text: 'À côté d\'un ami sur le même appareil, ou à distance avec un code de salon !' },
  ];

  const s = slides[step];
  const isLast = step === slides.length - 1;
  const next = () => isLast ? onDone() : setStep(step + 1);

  return (
    <div className="max-w-md mx-auto px-5 py-8 min-h-screen flex flex-col">
      <div className="flex justify-end mb-2">
        {!isLast && (
          <button onClick={onDone} className="text-sm px-3 py-1 rounded-full"
            style={{ color: C.inkSoft, fontWeight: 700 }}>Passer →</button>
        )}
      </div>

      <div className="flex-1 flex items-center">
        <div className="rounded-3xl p-8 w-full text-center" style={{
          background: s.bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 12px 24px rgba(0,0,0,0.08)',
        }}>
          <div className="text-7xl mb-4">{s.emoji}</div>
          <h2 className="text-3xl mb-3"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {s.title}
          </h2>
          <p className="text-base" style={{ color: C.inkLight, fontWeight: 600 }}>{s.text}</p>
        </div>
      </div>

      <div className="flex justify-center gap-2 my-6">
        {slides.map((_, i) => (
          <div key={i} className="rounded-full transition-all" style={{
            width: i === step ? 24 : 8, height: 8,
            background: i === step ? C.accentPink : C.inkSoft,
            opacity: i === step ? 1 : 0.4,
          }} />
        ))}
      </div>

      <KawaiiButton fullWidth onClick={next}>
        {isLast ? 'Commencer ✨' : 'Suivant →'}
      </KawaiiButton>
    </div>
  );
}

// ============================================================
// AUTH FLOW — bascule entre signup et login
// ============================================================
function AuthFlow({ initialMode, onSignup, onLogin }) {
  const [mode, setMode] = useState(initialMode);

  return mode === 'signup'
    ? <SignupForm onSignup={onSignup} onSwitch={() => setMode('login')} />
    : <LoginForm  onLogin={onLogin}  onSwitch={() => setMode('signup')} />;
}

// --- Composant PIN à 4 chiffres ---
function PinInput({ value, onChange, autoFocus = false }) {
  return (
    <input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      maxLength={4}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      placeholder="••••"
      className="w-full p-4 rounded-2xl text-center outline-none"
      style={{
        background: C.white, color: C.ink,
        fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
        fontSize: '2rem', letterSpacing: '0.5em',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
      }}
    />
  );
}

// --- Inscription ---
function SignupForm({ onSignup, onSwitch }) {
  const [pseudo, setPseudo] = useState('');
  const [pin, setPin]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);

  const cleanPseudo = pseudo.trim();
  const pseudoOk = cleanPseudo.length >= 3 && /^[a-zA-Z0-9_]+$/.test(cleanPseudo);
  const pinOk    = pin.length === 4;
  const matchOk  = confirm === pin;

  const submit = async () => {
    setError('');
    if (!pseudoOk) return setError('Pseudo : 3+ caractères, lettres/chiffres seulement.');
    if (!pinOk)    return setError('Le PIN doit faire 4 chiffres.');
    if (!matchOk)  return setError('Les 2 PIN ne correspondent pas.');
    setBusy(true);
    const result = await onSignup({ pseudo: cleanPseudo, pin });
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <div className="text-center mb-6">
        <div className="text-6xl mb-3">🌟</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Crée ton compte
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Choisis un pseudo unique et un PIN à 4 chiffres
        </p>
      </div>

      <div className="rounded-3xl p-6 mb-4" style={{ background: C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          ✏️ TON PSEUDO
        </label>
        <input
          type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)}
          placeholder="ex: SuperJoueur"
          maxLength={15}
          className="w-full p-4 rounded-2xl text-base outline-none"
          style={{ background: C.white, color: C.ink, fontWeight: 600,
                   boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)' }}
        />
        <div className="text-xs mt-1" style={{ color: C.inkSoft, fontWeight: 600 }}>
          3-15 caractères, lettres et chiffres
        </div>
      </div>

      <div className="rounded-3xl p-6 mb-4" style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔢 TON PIN (4 chiffres)
        </label>
        <PinInput value={pin} onChange={setPin} />
        <div className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          ⚠️ Retiens-le bien ! Pas de récupération possible.
        </div>
      </div>

      <div className="rounded-3xl p-6 mb-4" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔁 RETAPE TON PIN
        </label>
        <PinInput value={confirm} onChange={setConfirm} />
      </div>

      {error && (
        <div key={error} className="rounded-2xl p-3 mb-4 text-center text-sm clic-shake" style={{
          background: '#FFD0D0', color: '#B33', fontWeight: 700,
        }}>{error}</div>
      )}

      <KawaiiButton fullWidth onClick={submit}>
        {busy ? 'Création...' : 'Créer mon compte 🚀'}
      </KawaiiButton>

      <button onClick={onSwitch} className="mt-4 mx-auto block text-sm"
        style={{ color: C.inkLight, fontWeight: 700 }}>
        J'ai déjà un compte → Me connecter
      </button>
    </div>
  );
}

// --- Connexion ---
function LoginForm({ onLogin, onSwitch, knownPseudo }) {
  const [pseudo, setPseudo] = useState(knownPseudo || '');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    const result = await onLogin({ pseudo: pseudo.trim(), pin });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPin('');
    }
  };

  return (
    <div className="max-w-md mx-auto px-5 py-12">
      <div className="text-center mb-6">
        <div className="text-6xl mb-3">👋</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {knownPseudo ? 'Re-bienvenue !' : 'Te revoilà !'}
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Connecte-toi pour jouer ✨
        </p>
      </div>

      <div className="rounded-3xl p-6 mb-4" style={{ background: C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          ✏️ TON PSEUDO
        </label>
        <input
          type="text" value={pseudo} onChange={(e) => setPseudo(e.target.value)}
          placeholder="Ton pseudo"
          className="w-full p-4 rounded-2xl text-base outline-none"
          style={{ background: C.white, color: C.ink, fontWeight: 600,
                   boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)' }}
        />
      </div>

      <div className="rounded-3xl p-6 mb-4" style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔢 TON PIN
        </label>
        <PinInput value={pin} onChange={setPin} autoFocus={!!knownPseudo} />
      </div>

      {error && (
        <div key={error} className="rounded-2xl p-3 mb-4 text-center text-sm clic-shake" style={{
          background: '#FFD0D0', color: '#B33', fontWeight: 700,
        }}>{error}</div>
      )}

      <KawaiiButton fullWidth onClick={submit}>
        {busy ? 'Connexion...' : 'Se connecter →'}
      </KawaiiButton>

      <button onClick={onSwitch} className="mt-4 mx-auto block text-sm"
        style={{ color: C.inkLight, fontWeight: 700 }}>
        Pas encore de compte → En créer un
      </button>
    </div>
  );
}

// ============================================================
// CHOIX DE L'AVATAR (après création du compte)
// ============================================================
function AvatarPicker({ pseudo, onSave, onLogout }) {
  const [avatar, setAvatar] = useState(AVATARS[0]);

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <div className="text-center mb-6">
        <div key={avatar} className="text-7xl mb-3 clic-pop">{avatar}</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Salut {pseudo} !
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Choisis ton avatar préféré 🎨
        </p>
      </div>

      <div className="rounded-3xl p-6 mb-6" style={{
        background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
      }}>
        <div className="grid grid-cols-6 gap-2">
          {AVATARS.map((emoji) => {
            const selected = avatar === emoji;
            return (
              <button key={emoji} onClick={() => setAvatar(emoji)}
                className="rounded-2xl flex items-center justify-center transition-all"
                style={{
                  aspectRatio: '1 / 1',
                  background: selected ? C.white : 'rgba(255,255,255,0.4)',
                  outline: selected ? `3px solid ${C.accentPink}` : 'none',
                  outlineOffset: '2px',
                  fontSize: '1.8rem',
                  transform: selected ? 'scale(1.05)' : 'scale(1)',
                  boxShadow: selected ? '0 3px 0 rgba(0,0,0,0.08)' : 'none',
                }}>{emoji}</button>
            );
          })}
        </div>
      </div>

      <KawaiiButton fullWidth onClick={() => onSave(avatar)}>
        C'est parti ! ✨
      </KawaiiButton>

      <button onClick={onLogout} className="mt-4 mx-auto block text-sm"
        style={{ color: C.inkSoft, fontWeight: 700 }}>
        ← Me déconnecter
      </button>
    </div>
  );
}

// ============================================================
// DONNÉES DES JEUX
// ============================================================
const GAMES = {
  morpion: {
    title: 'Morpion', cardEmoji: '❌⭕', headerEmoji: '🎯',
    bg: C.pink, tagline: 'Aligne 3 symboles !',
    objective: 'Aligne 3 symboles en ligne, colonne ou diagonale avant ton adversaire.',
    rules: [
      { icon: '👤', text: 'Joueur 1 joue avec ❌, Joueur 2 avec ⭕' },
      { icon: '👆', text: 'Clique sur une case vide pour y mettre ton symbole' },
      { icon: '🔄', text: 'Vous jouez chacun votre tour' },
      { icon: '🏆', text: '3 symboles alignés = tu gagnes ! Sinon match nul' },
    ],
  },
  connect4: {
    title: 'Puissance 4', cardEmoji: '🔴🟡', headerEmoji: '🔴',
    bg: C.blue, tagline: 'Aligne 4 pions !',
    objective: 'Sois le premier à aligner 4 pions de ta couleur.',
    rules: [
      { icon: '👤', text: 'Joueur 1 = rouge, Joueur 2 = jaune' },
      { icon: '👆', text: 'Clique sur une colonne, ton pion tombe en bas' },
      { icon: '📏', text: 'Aligne 4 en ligne, colonne ou diagonale' },
      { icon: '🏆', text: 'Le premier à 4 pions alignés gagne !' },
    ],
  },
  memory: {
    title: 'Memory', cardEmoji: '🃏✨', headerEmoji: '🃏',
    bg: C.mint, tagline: 'Trouve les paires !',
    objective: 'Retrouve un maximum de paires d\'animaux cachées sous les cartes.',
    rules: [
      { icon: '👆', text: 'Clique sur 2 cartes pour les retourner' },
      { icon: '✨', text: 'Si elles sont identiques, tu rejoues !' },
      { icon: '🔄', text: 'Sinon, c\'est au tour de l\'autre' },
      { icon: '🏆', text: 'Le joueur avec le plus de paires gagne' },
    ],
  },
  bataille: {
    title: 'Bataille Navale', cardEmoji: '🚢💥', headerEmoji: '🚢',
    bg: C.lavender, tagline: 'Coule la flotte !',
    objective: 'Trouve et coule tous les bateaux cachés de ton adversaire.',
    rules: [
      { icon: '🚢', text: 'Chacun a 3 bateaux cachés (4, 3 et 2 cases)' },
      { icon: '👆', text: 'Clique sur une case de la grille adverse pour tirer' },
      { icon: '💥', text: '💧 = à l\'eau, 🔥 = touché !' },
      { icon: '📱', text: 'Passez-vous l\'appareil entre les tours' },
    ],
  },
  pendu: {
    title: 'Pendu', cardEmoji: '✏️📝', headerEmoji: '✏️',
    bg: C.peach, tagline: 'Devine le mot !',
    objective: 'Devine le mot secret avant que le bonhomme ne soit pendu.',
    rules: [
      { icon: '✏️', text: 'Joueur 1 écrit un mot en secret' },
      { icon: '🔤', text: 'Joueur 2 propose des lettres une par une' },
      { icon: '6️⃣', text: 'Maximum 6 erreurs autorisées !' },
      { icon: '🏆', text: 'Trouvé = J2 gagne / Pendu = J1 gagne' },
    ],
  },
};

// ============================================================
// GAMEHUB — niveau supérieur de l'app connectée
// Avec choix mode local / online
// ============================================================
function GameHub({ profile, onLogout }) {
  const [mode, setMode] = useState('select'); // 'select' | 'local' | 'online'
  const [view, setView] = useState('home');
  const [showRules, setShowRules] = useState(false);

  // Choix du mode → reset jeu
  const pickMode = (m) => { setMode(m); setView('home'); setShowRules(false); };
  const backToModeSelect = () => { setMode('select'); setView('home'); setShowRules(false); };

  // Navigation interne au mode local
  const selectGame = (id) => { setView(id); setShowRules(true); };
  const startGame  = ()   => setShowRules(false);
  const backHome   = ()   => { setView('home'); setShowRules(false); };

  if (mode === 'select') {
    return <ModeSelector profile={profile} onLogout={onLogout} onPickMode={pickMode} />;
  }

  if (mode === 'online') {
    return <OnlinePlaceholder profile={profile} onBack={backToModeSelect} />;
  }

  // mode === 'local'
  if (view === 'home') {
    return <LocalHome profile={profile} onSelect={selectGame} onBack={backToModeSelect} />;
  }
  if (showRules) {
    return <RulesScreen gameId={view} onBack={backHome} onStart={startGame} />;
  }

  switch (view) {
    case 'morpion':  return <TicTacToe      onBack={backHome} />;
    case 'connect4': return <Connect4       onBack={backHome} />;
    case 'memory':   return <Memory         onBack={backHome} />;
    case 'bataille': return <BatailleNavale onBack={backHome} />;
    case 'pendu':    return <Pendu          onBack={backHome} />;
    default:         return <LocalHome profile={profile} onSelect={selectGame} onBack={backToModeSelect} />;
  }
}

// --- Barre de profil (avatar + pseudo + menu déconnexion) ---
function ProfileBar({ profile, onLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mb-6">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-full"
        style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <span className="text-2xl">{profile.avatar}</span>
        <span style={{ color: C.ink, fontWeight: 700 }}>{profile.pseudo}</span>
        <span className="text-xs ml-1" style={{ color: C.inkSoft }}>▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 rounded-2xl p-2 z-10" style={{
          background: C.white, minWidth: 200,
          boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        }}>
          <div className="px-3 py-2 text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
            Connecté en tant que :<br/>
            <span style={{ color: C.ink, fontWeight: 700 }}>{profile.pseudo}</span>
          </div>
          <button onClick={() => { setOpen(false); onLogout(); }}
            className="w-full text-left px-3 py-2 rounded-xl text-sm"
            style={{ color: C.accentPink, fontWeight: 700 }}>
            🚪 Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MODE SELECTOR — local ou online
// ============================================================
function ModeSelector({ profile, onLogout, onPickMode }) {
  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <ProfileBar profile={profile} onLogout={onLogout} />

      <header className="text-center mb-8">
        <h1 className="text-5xl mb-2 leading-none"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.accentPink }}>
          ClicJeu <span style={{ fontSize: '0.5em', color: C.lavender }}>♡</span>
        </h1>
        <p className="text-base" style={{ color: C.inkLight, fontWeight: 600 }}>
          Salut {profile.pseudo} ! Comment tu veux jouer ? ✨
        </p>
      </header>

      <button onClick={() => onPickMode('local')}
        className="w-full p-6 rounded-3xl mb-4 text-left transition-all"
        style={{
          background: C.mint,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="text-5xl mb-2">🤝</div>
        <h3 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
          Sur le même appareil
        </h3>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          Avec un ami à côté de toi
        </p>
      </button>

      <button onClick={() => onPickMode('online')}
        className="w-full p-6 rounded-3xl mb-4 text-left transition-all"
        style={{
          background: C.lavender,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="text-5xl mb-2">🌐</div>
        <h3 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
          En ligne avec un ami
        </h3>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          À distance, avec un code de salon
        </p>
      </button>

      <footer className="text-center mt-10 text-xs" style={{ color: C.inkSoft }}>
        Mode en ligne bientôt disponible 🚀
      </footer>
    </div>
  );
}

// ============================================================
// PLACEHOLDER MODE ONLINE — ce qu'on va construire
// ============================================================
function OnlinePlaceholder({ profile, onBack }) {
  const steps = [
    { icon: '🔧', title: 'Configuration Supabase',
      desc: 'On crée un projet, des tables, et on récupère les clés API.' },
    { icon: '🎲', title: 'Création du salon',
      desc: 'Le J1 clique "Créer une partie" et reçoit un code rigolo type "BLEU-CHAT".' },
    { icon: '📲', title: 'Partage du code',
      desc: 'Le J1 envoie le code au J2 (WhatsApp, oralement, etc).' },
    { icon: '🔗', title: 'Rejoindre la partie',
      desc: 'Le J2 tape le code et hop, les 2 joueurs sont connectés !' },
    { icon: '⚡', title: 'Sync en temps réel',
      desc: 'Chaque coup joué est instantanément visible chez l\'autre.' },
  ];

  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <div className="rounded-3xl p-6 text-center mb-5" style={{
        background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
      }}>
        <div className="text-6xl mb-3">🌐</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Mode en ligne
        </h2>
        <div className="inline-block px-3 py-1 rounded-full text-xs"
             style={{ background: C.accentPink, color: C.white, fontWeight: 700 }}>
          🛠️ EN CONSTRUCTION
        </div>
      </div>

      <div className="rounded-2xl p-4 mb-5" style={{ background: 'rgba(255,255,255,0.65)' }}>
        <div className="text-xs mb-1" style={{ color: C.inkSoft, fontWeight: 700 }}>🗺️ FEUILLE DE ROUTE</div>
        <p className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          Voici les 5 étapes qu'on va construire ensemble :
        </p>
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-3 p-4 rounded-2xl"
               style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
            <div className="text-3xl">{s.icon}</div>
            <div className="flex-1">
              <div className="text-xs mb-1" style={{ color: C.inkSoft, fontWeight: 700 }}>
                ÉTAPE {i + 1}
              </div>
              <h4 className="text-base"
                  style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
                {s.title}
              </h4>
              <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
                {s.desc}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl p-4 text-center" style={{
        background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
      }}>
        <p className="text-sm" style={{ color: C.ink, fontWeight: 600 }}>
          💬 Dis-moi quand tu es prêt à attaquer l'étape 1 !
        </p>
      </div>
    </div>
  );
}

// ============================================================
// ACCUEIL MODE LOCAL — liste des 5 jeux
// ============================================================
function LocalHome({ profile, onSelect, onBack }) {
  const ids = Object.keys(GAMES);
  return (
    <div className="max-w-2xl mx-auto px-5 py-6">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="px-3 py-2 rounded-full text-sm"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Mode
        </button>
        <div className="text-2xl">{profile.avatar}</div>
      </div>

      <header className="text-center mb-8">
        <div className="inline-block px-3 py-1 mb-3 text-xs rounded-full"
             style={{ background: C.mint, color: C.ink, fontWeight: 700 }}>
          🤝 MODE LOCAL · 2 JOUEURS
        </div>
        <h1 className="text-4xl mb-1 leading-none"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.accentPink }}>
          Choisis ton jeu
        </h1>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Passez-vous l'appareil chacun votre tour ✨
        </p>
      </header>

      <div className="space-y-4">
        {ids.map((id) => (
          <GameCard key={id} game={GAMES[id]} onClick={() => onSelect(id)} />
        ))}
      </div>
    </div>
  );
}

function GameCard({ game, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-full p-5 rounded-3xl flex items-center justify-between transition-all duration-200"
      style={{
        background: game.bg,
        boxShadow: hover
          ? '0 8px 0 rgba(0,0,0,0.08), 0 12px 24px rgba(0,0,0,0.10)'
          : '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
      }}>
      <div className="text-left">
        <h3 className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
          {game.title}
        </h3>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>{game.tagline}</p>
      </div>
      <div className="text-4xl ml-3">{game.cardEmoji}</div>
    </button>
  );
}

// ============================================================
// RULES SCREEN
// ============================================================
function RulesScreen({ gameId, onBack, onStart }) {
  const g = GAMES[gameId];
  return (
    <div className="max-w-xl mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700, boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <div className="rounded-3xl p-6 md:p-8 text-center" style={{
        background: g.bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 10px 24px rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">{g.cardEmoji}</div>
        <h2 className="text-4xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {g.title}
        </h2>

        <div className="inline-block px-3 py-1 mb-5 rounded-full text-xs"
             style={{ background: C.white, color: C.inkLight, fontWeight: 700 }}>
          ✦ Comment jouer ✦
        </div>

        <div className="rounded-2xl p-4 mb-5 text-left" style={{ background: 'rgba(255,255,255,0.65)' }}>
          <div className="text-xs mb-1" style={{ color: C.inkSoft, fontWeight: 700 }}>🎯 OBJECTIF</div>
          <p style={{ color: C.ink, fontWeight: 600 }}>{g.objective}</p>
        </div>

        <div className="space-y-2 text-left mb-6">
          {g.rules.map((r, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-2xl"
                 style={{ background: 'rgba(255,255,255,0.65)' }}>
              <div className="text-2xl">{r.icon}</div>
              <div className="flex-1 pt-1" style={{ color: C.ink, fontWeight: 600 }}>{r.text}</div>
            </div>
          ))}
        </div>

        <KawaiiButton fullWidth onClick={onStart}>C'est parti ! ✨</KawaiiButton>
      </div>
    </div>
  );
}

// ============================================================
// COMPOSANTS PARTAGÉS DES JEUX
// ============================================================
function GameHeader({ gameId, onBack, onReset }) {
  const g = GAMES[gameId];
  return (
    <header className="flex items-center justify-between mb-5">
      <button onClick={onBack} className="px-3 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700, boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Accueil
      </button>
      <h2 className="text-2xl flex items-center gap-2"
          style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
        <span>{g.headerEmoji}</span><span>{g.title}</span>
      </h2>
      <button onClick={onReset} className="px-3 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700, boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ↻ Reset
      </button>
    </header>
  );
}

function Scoreboard({ scores, names = ['Joueur 1', 'Joueur 2'], colors = [C.pink, C.blue], current = null }) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      {[0, 1].map((i) => {
        const isActive = current === i;
        return (
          <div key={i} className="p-3 rounded-2xl text-center transition-all"
               style={{
                 background: colors[i],
                 outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                 outlineOffset: '2px',
                 boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
                 transform: isActive ? 'translateY(-2px)' : 'none',
               }}>
            <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>{names[i]}</div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              {scores[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Banner({ text, color = C.accentPink }) {
  return (
    <div className="rounded-2xl p-3 mb-4 text-center" style={{
      background: color, color: C.white,
      fontFamily: '"Fredoka", sans-serif', fontWeight: 600, fontSize: '1.1rem',
      boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
    }}>{text}</div>
  );
}

function KawaiiButton({ children, onClick, color = C.accentPink, fullWidth = false }) {
  return (
    <button onClick={onClick}
      className={`px-5 py-3 rounded-2xl clic-press ${fullWidth ? 'w-full' : ''}`}
      style={{
        background: color, color: C.white,
        fontFamily: '"Fredoka", sans-serif', fontWeight: 600, fontSize: '1rem',
        boxShadow: '0 4px 0 rgba(0,0,0,0.10)',
      }}>{children}</button>
  );
}

function GameShell({ gameId, onBack, onReset, children }) {
  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <GameHeader gameId={gameId} onBack={onBack} onReset={onReset} />
      {children}
    </div>
  );
}

// ============================================================
// JEU 1 — MORPION (inchangé)
// ============================================================
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkTicTacToeWinner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a,b,c] };
  }
  if (board.every(Boolean)) return { winner: 'draw', line: [] };
  return null;
}

function TicTacToe({ onBack }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [lastWinner, setLastWinner] = useState(null);
  const symbols = ['❌', '⭕'];
  const result = checkTicTacToeWinner(board);

  useEffect(() => {
    if (result && result.winner !== 'draw' && lastWinner !== result.winner) {
      const idx = symbols.indexOf(result.winner);
      setScores((s) => { const ns = [...s]; ns[idx] += 1; return ns; });
      setLastWinner(result.winner);
    }
  }, [result, lastWinner]);

  const playCell = (i) => {
    if (board[i] || result) return;
    const next = [...board]; next[i] = symbols[turn];
    setBoard(next); setTurn(1 - turn);
  };
  const newRound = () => { setBoard(Array(9).fill(null)); setTurn(0); setLastWinner(null); };
  const fullReset = () => { newRound(); setScores([0, 0]); };

  let banner;
  if (result?.winner === 'draw') banner = '🤝 Match nul !';
  else if (result?.winner) banner = `${result.winner} gagne ! 🎉`;
  else banner = `Au tour de ${symbols[turn]}`;

  return (
    <GameShell gameId="morpion" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={['❌ J1', '⭕ J2']} colors={[C.pink, C.blue]} current={result ? null : turn} />
      <Banner text={banner} color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink} />
      <div className="grid grid-cols-3 gap-3 mb-4" style={{ aspectRatio: '1 / 1' }}>
        {board.map((cell, i) => {
          const inWin = result?.line.includes(i);
          return (
            <button key={i} onClick={() => playCell(i)}
              className="rounded-2xl flex items-center justify-center text-5xl transition-all"
              style={{ background: inWin ? '#FFE89E' : C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
                       fontFamily: '"Fredoka", sans-serif' }}>{cell}</button>
          );
        })}
      </div>
      {result && (<KawaiiButton fullWidth onClick={newRound}>Nouvelle manche ↻</KawaiiButton>)}
    </GameShell>
  );
}

// ============================================================
// JEU 2 — PUISSANCE 4 (inchangé)
// ============================================================
const C4_ROWS = 6;
const C4_COLS = 7;
function makeC4Board() { return Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null)); }
function checkConnect4Winner(grid) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
    const v = grid[r][c]; if (!v) continue;
    for (const [dr, dc] of dirs) {
      const cells = [[r,c]];
      for (let k = 1; k < 4; k++) {
        const nr = r + dr*k, nc = c + dc*k;
        if (nr < 0 || nr >= C4_ROWS || nc < 0 || nc >= C4_COLS) break;
        if (grid[nr][nc] !== v) break;
        cells.push([nr, nc]);
      }
      if (cells.length === 4) return { winner: v, cells };
    }
  }
  if (grid.every((row) => row.every(Boolean))) return { winner: 'draw', cells: [] };
  return null;
}

function Connect4({ onBack }) {
  const [grid, setGrid] = useState(makeC4Board());
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [lastWinner, setLastWinner] = useState(null);
  const symbols = ['🔴', '🟡'];
  const result = checkConnect4Winner(grid);

  useEffect(() => {
    if (result && result.winner !== 'draw' && lastWinner !== result.winner) {
      const idx = symbols.indexOf(result.winner);
      setScores((s) => { const ns = [...s]; ns[idx] += 1; return ns; });
      setLastWinner(result.winner);
    }
  }, [result, lastWinner]);

  const dropPiece = (col) => {
    if (result) return;
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (!grid[r][col]) {
        const next = grid.map((row) => [...row]); next[r][col] = symbols[turn];
        setGrid(next); setTurn(1 - turn); return;
      }
    }
  };
  const newRound = () => { setGrid(makeC4Board()); setTurn(0); setLastWinner(null); };
  const fullReset = () => { newRound(); setScores([0, 0]); };

  let banner;
  if (result?.winner === 'draw') banner = '🤝 Match nul !';
  else if (result?.winner) banner = `${result.winner} gagne ! 🎉`;
  else banner = `Au tour de ${symbols[turn]}`;
  const isWinning = (r, c) => result?.cells.some(([wr, wc]) => wr === r && wc === c);

  return (
    <GameShell gameId="connect4" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={['🔴 J1', '🟡 J2']} colors={[C.pink, '#FFE89E']} current={result ? null : turn} />
      <Banner text={banner} color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink} />
      <div className="rounded-2xl p-2" style={{ background: C.blue, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        {grid.map((row, r) => (
          <div key={r} className="flex gap-1 mb-1">
            {row.map((cell, c) => (
              <button key={c} onClick={() => dropPiece(c)}
                className="flex-1 rounded-full flex items-center justify-center transition-all"
                style={{ aspectRatio: '1 / 1',
                         background: isWinning(r, c) ? '#FFE89E' : C.cream,
                         fontSize: '1.4rem' }}>{cell}</button>
            ))}
          </div>
        ))}
      </div>
      {result && (<div className="mt-4"><KawaiiButton fullWidth onClick={newRound}>Nouvelle manche ↻</KawaiiButton></div>)}
    </GameShell>
  );
}

// ============================================================
// JEU 3 — MEMORY (inchangé)
// ============================================================
const MEMORY_EMOJIS = ['🐶','🐱','🐰','🦊','🐼','🦁','🐯','🐸'];
function makeMemoryDeck() {
  const deck = [...MEMORY_EMOJIS, ...MEMORY_EMOJIS].map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function Memory({ onBack }) {
  const [deck, setDeck] = useState(makeMemoryDeck);
  const [flipped, setFlipped] = useState([]);
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [locked, setLocked] = useState(false);
  const allMatched = deck.every((c) => c.matched);

  const clickCard = (i) => {
    if (locked || allMatched || deck[i].flipped || deck[i].matched) return;
    const newDeck = deck.map((c, idx) => idx === i ? { ...c, flipped: true } : c);
    const newFlipped = [...flipped, i];
    setDeck(newDeck); setFlipped(newFlipped);
    if (newFlipped.length === 2) {
      setLocked(true);
      const [a, b] = newFlipped;
      if (newDeck[a].emoji === newDeck[b].emoji) {
        setTimeout(() => {
          setDeck((d) => d.map((c, idx) => idx === a || idx === b ? { ...c, matched: true } : c));
          setScores((s) => { const ns = [...s]; ns[turn] += 1; return ns; });
          setFlipped([]); setLocked(false);
        }, 600);
      } else {
        setTimeout(() => {
          setDeck((d) => d.map((c, idx) => idx === a || idx === b ? { ...c, flipped: false } : c));
          setTurn((t) => 1 - t); setFlipped([]); setLocked(false);
        }, 1000);
      }
    }
  };
  const fullReset = () => { setDeck(makeMemoryDeck()); setFlipped([]); setTurn(0); setScores([0, 0]); setLocked(false); };

  let banner;
  if (allMatched) {
    if (scores[0] > scores[1]) banner = '🎉 Joueur 1 gagne !';
    else if (scores[1] > scores[0]) banner = '🎉 Joueur 2 gagne !';
    else banner = '🤝 Égalité !';
  } else banner = `Au tour de Joueur ${turn + 1}`;

  return (
    <GameShell gameId="memory" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={['J1', 'J2']} colors={[C.pink, C.blue]} current={allMatched ? null : turn} />
      <Banner text={banner} color={allMatched ? '#6BCB77' : C.accentPink} />
      <div className="grid grid-cols-4 gap-2 mb-4">
        {deck.map((card, i) => (
          <button key={card.id} onClick={() => clickCard(i)}
            className="rounded-2xl flex items-center justify-center transition-all"
            style={{ aspectRatio: '1 / 1',
                     background: card.matched ? C.mint : card.flipped ? C.white : C.lavender,
                     boxShadow: '0 4px 0 rgba(0,0,0,0.08)', fontSize: '2rem',
                     opacity: card.matched ? 0.6 : 1 }}>
            {card.flipped || card.matched ? card.emoji : '✦'}
          </button>
        ))}
      </div>
      {allMatched && (<KawaiiButton fullWidth onClick={fullReset}>Rejouer ↻</KawaiiButton>)}
    </GameShell>
  );
}

// ============================================================
// JEU 4 — BATAILLE NAVALE (inchangé)
// ============================================================
const BN_ROWS = 6;
const BN_COLS = 6;
const BN_SHIPS = [4, 3, 2];

function placeShipsRandomly() {
  const grid = Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(false));
  for (const size of BN_SHIPS) {
    let placed = false, attempts = 0;
    while (!placed && attempts < 200) {
      attempts++;
      const horizontal = Math.random() < 0.5;
      const r = Math.floor(Math.random() * (horizontal ? BN_ROWS : BN_ROWS - size + 1));
      const c = Math.floor(Math.random() * (horizontal ? BN_COLS - size + 1 : BN_COLS));
      let canPlace = true;
      for (let k = 0; k < size; k++) {
        const rr = horizontal ? r : r + k; const cc = horizontal ? c + k : c;
        if (grid[rr][cc]) { canPlace = false; break; }
      }
      if (canPlace) {
        for (let k = 0; k < size; k++) {
          const rr = horizontal ? r : r + k; const cc = horizontal ? c + k : c;
          grid[rr][cc] = true;
        }
        placed = true;
      }
    }
  }
  return grid;
}

function countShipCells(g) { let n = 0; g.forEach((row) => row.forEach((v) => { if (v) n++; })); return n; }

function BatailleNavale({ onBack }) {
  const [ships, setShips] = useState(() => [placeShipsRandomly(), placeShipsRandomly()]);
  const [shots, setShots] = useState(() => [
    Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(null)),
    Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(null)),
  ]);
  const [turn, setTurn] = useState(0);
  const [phase, setPhase] = useState('pass');
  const [lastHit, setLastHit] = useState(null);
  const [winner, setWinner] = useState(null);
  const totalShipCells = countShipCells(ships[0]);

  const fire = (r, c) => {
    if (phase !== 'play' || winner !== null || shots[turn][r][c] !== null) return;
    const opponent = 1 - turn;
    const isHit = ships[opponent][r][c];
    const newShots = shots.map((g) => g.map((row) => [...row]));
    newShots[turn][r][c] = isHit ? 'hit' : 'miss';
    setShots(newShots); setLastHit(isHit ? 'hit' : 'miss');
    let hits = 0;
    newShots[turn].forEach((row) => row.forEach((v) => { if (v === 'hit') hits++; }));
    if (hits >= totalShipCells) { setWinner(turn); return; }
    setPhase('end-turn');
  };
  const endTurn = () => { setTurn(1 - turn); setPhase('pass'); setLastHit(null); };
  const startTurn = () => setPhase('play');
  const fullReset = () => {
    setShips([placeShipsRandomly(), placeShipsRandomly()]);
    setShots([
      Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(null)),
      Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(null)),
    ]);
    setTurn(0); setPhase('pass'); setLastHit(null); setWinner(null);
  };

  if (winner !== null) {
    return (
      <GameShell gameId="bataille" onBack={onBack} onReset={fullReset}>
        <div className="rounded-3xl p-8 text-center" style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3"><span className="clic-celebrate">🎉</span></div>
          <h3 className="text-3xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Joueur {winner + 1} gagne !
          </h3>
          <p style={{ color: C.inkLight, fontWeight: 600 }}>Tous les bateaux sont coulés 🚢💥</p>
          <div className="mt-5"><KawaiiButton fullWidth onClick={fullReset}>Rejouer ↻</KawaiiButton></div>
        </div>
      </GameShell>
    );
  }

  if (phase === 'pass') {
    return (
      <GameShell gameId="bataille" onBack={onBack} onReset={fullReset}>
        <div className="rounded-3xl p-8 text-center" style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">📱</div>
          <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Passe l'appareil au Joueur {turn + 1}
          </h3>
          <p className="mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>Quand tu es prêt, clique pour commencer ton tour.</p>
          <KawaiiButton fullWidth onClick={startTurn}>Je suis Joueur {turn + 1} ✨</KawaiiButton>
        </div>
      </GameShell>
    );
  }

  const myShots = shots[turn]; const myShips = ships[turn]; const opponentShots = shots[1 - turn];

  return (
    <GameShell gameId="bataille" onBack={onBack} onReset={fullReset}>
      <Banner text={
        phase === 'end-turn' ? (lastHit === 'hit' ? '🔥 Touché !' : '💧 À l\'eau...')
                             : `🎯 Tir du Joueur ${turn + 1}`
      } color={phase === 'end-turn' && lastHit === 'hit' ? '#FF8FB1' : C.accentPink} />

      <div className="mb-4">
        <div className="text-xs mb-2" style={{ color: C.inkLight, fontWeight: 700 }}>🎯 GRILLE ADVERSE (clique pour tirer)</div>
        <div className="grid gap-1 p-2 rounded-2xl"
             style={{ gridTemplateColumns: `repeat(${BN_COLS}, 1fr)`, background: C.blue, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          {myShots.map((row, r) => row.map((shot, c) => (
            <button key={`${r}-${c}`} onClick={() => fire(r, c)} disabled={phase !== 'play' || shot !== null}
              className="rounded-lg flex items-center justify-center"
              style={{ aspectRatio: '1 / 1',
                       background: shot === 'hit' ? '#FF8FB1' : shot === 'miss' ? C.white : C.cream,
                       fontSize: '1.1rem' }}>{shot === 'hit' ? '🔥' : shot === 'miss' ? '💧' : ''}</button>
          )))}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs mb-2" style={{ color: C.inkLight, fontWeight: 700 }}>🚢 MA GRILLE</div>
        <div className="grid gap-1 p-2 rounded-2xl"
             style={{ gridTemplateColumns: `repeat(${BN_COLS}, 1fr)`, background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          {myShips.map((row, r) => row.map((isShip, c) => {
            const wasShot = opponentShots[r][c];
            let content = '';
            if (wasShot === 'hit') content = '🔥';
            else if (wasShot === 'miss') content = '💧';
            else if (isShip) content = '🚢';
            return (
              <div key={`${r}-${c}`} className="rounded-lg flex items-center justify-center"
                style={{ aspectRatio: '1 / 1',
                         background: wasShot === 'hit' ? '#FF8FB1' : wasShot === 'miss' ? C.white : isShip ? C.mint : C.cream,
                         fontSize: '1.1rem' }}>{content}</div>
            );
          }))}
        </div>
      </div>

      {phase === 'end-turn' && (<KawaiiButton fullWidth onClick={endTurn}>Fin du tour →</KawaiiButton>)}
    </GameShell>
  );
}

// ============================================================
// JEU 5 — PENDU (inchangé)
// ============================================================
const PENDU_MAX_WRONG = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function Pendu({ onBack }) {
  const [phase, setPhase] = useState('word-entry');
  const [word, setWord] = useState('');           // affichage avec accents
  const [wordInput, setWordInput] = useState('');
  const [showWord, setShowWord] = useState(false);
  const [guessed, setGuessed] = useState([]);

  // Normalise : enlève les accents pour la comparaison.
  // Exemple : "Été" → "ETE". "É" matche donc le bouton "E".
  const stripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normUpper = (s) => stripAccents(s).toUpperCase();

  const wrongLetters = guessed.filter((L) => !normUpper(word).includes(L));
  const wrongCount = wrongLetters.length;
  const letters = word.toUpperCase().split('');                          // pour l'affichage (garde les accents)
  const lettersNorm = normUpper(word).split('');                         // pour la comparaison
  const allFound = lettersNorm.every((L) => L === ' ' || guessed.includes(L));

  useEffect(() => {
    if (phase !== 'guessing') return;
    if (allFound && word) setPhase('win');
    else if (wrongCount >= PENDU_MAX_WRONG) setPhase('lose');
  }, [allFound, wrongCount, phase, word]);

  const validateWord = () => {
    // Autorise lettres (avec accents), espaces et tirets
    const clean = wordInput.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
    if (clean.length < 2) return;
    setWord(clean); setPhase('guessing');
  };
  const guessLetter = (L) => {
    if (phase !== 'guessing' || guessed.includes(L)) return;
    setGuessed([...guessed, L]);
  };
  const fullReset = () => {
    setPhase('word-entry'); setWord(''); setWordInput(''); setShowWord(false); setGuessed([]);
  };

  if (phase === 'word-entry') {
    return (
      <GameShell gameId="pendu" onBack={onBack} onReset={fullReset}>
        <div className="rounded-3xl p-6 text-center" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">✏️</div>
          <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Joueur 1, écris le mot
          </h3>
          <p className="mb-5 text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>Cache ton écran pour que J2 ne voie pas !</p>
          <div className="relative mb-3">
            <input type={showWord ? 'text' : 'password'} value={wordInput}
              onChange={(e) => setWordInput(e.target.value)} placeholder="Mot secret..."
              className="w-full p-4 rounded-2xl text-lg pr-14 outline-none"
              style={{ background: C.white, color: C.ink, fontWeight: 600,
                       boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)' }} />
            <button onClick={() => setShowWord((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl" type="button">
              {showWord ? '🙈' : '👁️'}
            </button>
          </div>
          <KawaiiButton fullWidth onClick={validateWord}>Valider le mot ✨</KawaiiButton>
        </div>
      </GameShell>
    );
  }

  if (phase === 'win' || phase === 'lose') {
    const isWin = phase === 'win';
    return (
      <GameShell gameId="pendu" onBack={onBack} onReset={fullReset}>
        <div className="rounded-3xl p-8 text-center" style={{
          background: isWin ? C.mint : C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
        }}>
          <div className="text-6xl mb-3">{isWin ? <span className="clic-celebrate">🎉</span> : '😢'}</div>
          <h3 className="text-3xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {isWin ? 'Joueur 2 gagne !' : 'Joueur 1 gagne !'}
          </h3>
          <p style={{ color: C.inkLight, fontWeight: 600 }}>
            Le mot était : <span style={{ color: C.ink, fontWeight: 700 }}>{word.toUpperCase()}</span>
          </p>
          <div className="mt-5"><KawaiiButton fullWidth onClick={fullReset}>Rejouer ↻</KawaiiButton></div>
        </div>
      </GameShell>
    );
  }

  // Affichage : si la lettre normalisée (sans accent) a été devinée, on affiche
  // la lettre originale (avec accent éventuel) ; sinon "_".
  const display = letters.map((L, i) => {
    if (L === ' ') return ' ';
    if (L === '-') return '-';
    return guessed.includes(lettersNorm[i]) ? L : '_';
  }).join(' ');

  return (
    <GameShell gameId="pendu" onBack={onBack} onReset={fullReset}>
      <Banner text={`❤️ ${PENDU_MAX_WRONG - wrongCount} vies restantes`} color={wrongCount >= 4 ? '#FF8FB1' : C.accentPink} />
      <div className="rounded-3xl p-4 mb-4 flex items-center justify-center" style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <Hangman wrongCount={wrongCount} />
      </div>
      <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-3xl tracking-widest" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {display}
        </div>
      </div>
      <div className="rounded-2xl p-3 mb-4" style={{ background: 'rgba(255,255,255,0.7)' }}>
        <div className="grid grid-cols-7 gap-1">
          {ALPHABET.map((L) => {
            const used = guessed.includes(L);
            const wrong = used && !normUpper(word).includes(L);
            const right = used && normUpper(word).includes(L);
            return (
              <button key={L} onClick={() => guessLetter(L)} disabled={used}
                className="rounded-lg flex items-center justify-center text-sm clic-press"
                style={{ aspectRatio: '1 / 1',
                         background: right ? C.mint : wrong ? C.pink : C.white,
                         color: C.ink, fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                         boxShadow: used ? 'none' : '0 2px 0 rgba(0,0,0,0.06)',
                         opacity: used ? 0.6 : 1 }}>{L}</button>
            );
          })}
        </div>
      </div>
      {wrongLetters.length > 0 && (
        <div className="text-center text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          ❌ Erreurs : {wrongLetters.join(' ')}
        </div>
      )}
    </GameShell>
  );
}

function Hangman({ wrongCount }) {
  const inkColor = C.ink; const bodyColor = '#FF8FB1';
  return (
    <svg viewBox="0 0 120 140" width="160" height="180">
      <line x1="10" y1="135" x2="80" y2="135" stroke={inkColor} strokeWidth="4" strokeLinecap="round" />
      <line x1="30" y1="135" x2="30" y2="10"  stroke={inkColor} strokeWidth="4" strokeLinecap="round" />
      <line x1="30" y1="10"  x2="80" y2="10"  stroke={inkColor} strokeWidth="4" strokeLinecap="round" />
      <line x1="80" y1="10"  x2="80" y2="25"  stroke={inkColor} strokeWidth="4" strokeLinecap="round" />
      {wrongCount >= 1 && <circle cx="80" cy="38" r="10" stroke={bodyColor} strokeWidth="3" fill="none" />}
      {wrongCount >= 2 && <line x1="80" y1="48" x2="80" y2="85" stroke={bodyColor} strokeWidth="3" strokeLinecap="round" />}
      {wrongCount >= 3 && <line x1="80" y1="58" x2="65" y2="72" stroke={bodyColor} strokeWidth="3" strokeLinecap="round" />}
      {wrongCount >= 4 && <line x1="80" y1="58" x2="95" y2="72" stroke={bodyColor} strokeWidth="3" strokeLinecap="round" />}
      {wrongCount >= 5 && <line x1="80" y1="85" x2="68" y2="105" stroke={bodyColor} strokeWidth="3" strokeLinecap="round" />}
      {wrongCount >= 6 && <line x1="80" y1="85" x2="92" y2="105" stroke={bodyColor} strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}
