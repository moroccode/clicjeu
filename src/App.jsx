import React, { useState, useEffect, useMemo } from 'react';
import { signup as sbSignup, login as sbLogin, logout as sbLogout,
         getProfile, saveAvatar as sbSaveAvatar, supabase } from './supabase';
import { createRoom, joinRoom, subscribeToRoom, getProfilesByIds, updateRoomState,
         listIncomingInvitations, subscribeToInvitations, cancelInvitation,
         updateRoomInvite, listMyRooms } from './rooms';
import { searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
         removeFriend, listFriends, listPendingRequests, listSentRequests, syncFriendships } from './friends';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';

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
// localStorage keys
const LS = {
  ONBOARDED: 'gh_onboarded',
  PENDING_REF: 'cj_pending_ref',  // pseudo du parrain à associer après inscription
};

// ============================================================
// Error Boundary — attrape les crashes dans le Lobby/jeu
// Évite la page blanche quand un composant de jeu plante
// ============================================================
class LobbyErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e) { console.error('LobbyErrorBoundary caught:', e); }
  render() {
    if (this.state.error) {
      return (
        <div className="max-w-md mx-auto px-5 py-8">
          <div className="rounded-3xl p-8 text-center"
               style={{ background: '#FFD0D0', boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
            <div className="text-5xl mb-3">😵</div>
            <h3 style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, fontSize: '1.4rem', color: '#5C4A3D' }}>
              Oops, cette partie a planté
            </h3>
            <p style={{ color: '#8B7355', fontWeight: 600, fontSize: '0.9rem', marginTop: 8 }}>
              La partie n'a pas pu charger (format incompatible).
            </p>
            <button onClick={this.props.onLeave}
              style={{ marginTop: 20, background: '#5C4A3D', color: '#fff',
                       fontWeight: 700, padding: '12px 24px', borderRadius: 16,
                       border: 'none', fontFamily: '"Fredoka", sans-serif', fontSize: '1rem' }}>
              ← Retour
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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

  const [profile, setProfile]     = useState(null);   // { pseudo, avatar, id, ... } ou null
  const [loading, setLoading]     = useState(true);   // true tant qu'on n'a pas vérifié la session

  // Au tout 1er rendu : on lit ?ref=PSEUDO dans l'URL et on le stocke
  // pour le retrouver après inscription. On nettoie aussi l'URL.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref) {
        localStorage.setItem(LS.PENDING_REF, ref);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (e) { /* tant pis */ }
  }, []);

  // Au chargement : vérifie s'il y a une session en local (instantané),
  // puis charge le profil depuis Supabase.
  // Stratégie : si session locale détectée → on reste en loading jusqu'à
  // la fin du getProfile(). Si pas de session locale → on affiche AuthScreen
  // immédiatement sans attendre.
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // 1. Vérifie la session locale (pas de réseau, instantané)
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // Pas de session → affiche AuthScreen immédiatement
        if (mounted) setLoading(false);
        return;
      }

      // 2. Session trouvée → charge le profil (nécessite réseau)
      try {
        const p = await Promise.race([
          getProfile(),
          new Promise((res) => setTimeout(() => res(null), 6000)),
        ]);
        if (mounted) { setProfile(p); setLoading(false); }
      } catch (e) {
        if (mounted) { setProfile(null); setLoading(false); }
      }
    };

    init();

    // Écouteur d'événements auth (login, logout, refresh token...)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session) {
        try {
          const p = await getProfile();
          if (mounted) { setProfile(p); setLoading(false); }
          syncFriendships().catch(() => {});
        } catch (e) {
          if (mounted) { setProfile(null); setLoading(false); }
        }
      } else {
        if (mounted) { setProfile(null); setLoading(false); }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // --- Actions ---
  // Renvoie { ok, error } pour que les formulaires affichent les erreurs
  const signup = async ({ pseudo, pin, referredByPseudo }) => {
    const result = await sbSignup({ pseudo, pin });
    if (result.ok && referredByPseudo) {
      // Récupère l'id du parrain à partir de son pseudo
      try {
        const { data: parrain } = await supabase
          .from('profiles')
          .select('id')
          .eq('pseudo', referredByPseudo)
          .maybeSingle();
        if (parrain?.id) {
          // Enregistre le referred_by sur le nouveau profil
          await supabase
            .from('profiles')
            .update({ referred_by: parrain.id })
            .eq('pseudo', pseudo);
          // Envoie une demande d'ami automatique du parrain vers le nouvel inscrit
          // (sendFriendRequest est appelée depuis le compte du nouvel inscrit ;
          //  on insère donc une ligne où user_id = parrain → friend_id = moi)
          const { data: me } = await supabase
            .from('profiles')
            .select('id')
            .eq('pseudo', pseudo)
            .maybeSingle();
          if (me?.id) {
            await supabase.from('friendships').insert({
              user_id: parrain.id,
              friend_id: me.id,
              requested_by: parrain.id,
              status: 'pending',
            });
          }
        }
      } catch (e) { /* tant pis, le parrainage est best-effort */ }
      // On nettoie le localStorage
      try { localStorage.removeItem(LS.PENDING_REF); } catch {}
    }
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
  // On lit le pseudo de parrainage en attente (depuis un lien d'invitation)
  const pendingRef = (typeof window !== 'undefined') ? localStorage.getItem(LS.PENDING_REF) : null;

  if (loading) {
    screen = <LoadingScreen />;
  } else if (!profile) {
    screen = <AuthScreen onSignup={signup} onLogin={login} pendingRef={pendingRef} />;
  } else if (!profile.avatar) {
    screen = <AvatarPicker pseudo={profile.pseudo} onSave={saveAvatar} onLogout={logout} />;
  } else {
    screen = <GameHub profile={profile} onLogout={logout} />;
  }

  const screenKey = loading ? 'load'
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
// Logo — manette Kawaii avec curseur fléché.
// Le fichier source est dans public/logo.svg (servi à /logo.svg).
// ============================================================
function Logo({ size = 200 }) {
  return (
    <img src="/logo.svg" alt="ClicJeu" width={size} height={size * 0.7}
         style={{ display: 'block', margin: '0 auto' }} />
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
// AUTH SCREEN — page unique avec toggle Connexion/Inscription
// ============================================================
// Une seule page propre où l'utilisateur bascule entre les 2 modes
// via un onglet en haut. Plus simple, plus moderne.
// ============================================================

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

// --- AuthScreen : page unique avec toggle ---
function AuthScreen({ onSignup, onLogin, pendingRef = null }) {
  // Si on arrive depuis un lien de parrainage, on bascule par défaut sur "Inscription"
  const [mode, setMode] = useState('signup');
  const [pseudo, setPseudo] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pseudoError, setPseudoError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const cleanPseudo = pseudo.trim();
  const pseudoOk = cleanPseudo.length >= 3 && /^[a-zA-Z0-9_]+$/.test(cleanPseudo);
  const pinOk = pin.length === 4;
  const matchOk = mode === 'login' || confirm === pin;

  const switchMode = (newMode) => {
    setMode(newMode);
    setPin(''); setConfirm(''); setError(''); setPseudoError('');
  };

  const onPseudoChange = (v) => {
    setPseudo(v);
    if (pseudoError) setPseudoError('');
  };

  const submit = async () => {
    setError(''); setPseudoError('');
    if (!pseudoOk) {
      return setPseudoError('Pseudo : 3+ caractères, lettres/chiffres seulement.');
    }
    if (!pinOk) return setError('Le PIN doit faire 4 chiffres.');
    if (mode === 'signup' && !matchOk) return setError('Les 2 PIN ne correspondent pas.');

    setBusy(true);
    const result = mode === 'signup'
      ? await onSignup({ pseudo: cleanPseudo, pin, referredByPseudo: pendingRef })
      : await onLogin({ pseudo: cleanPseudo, pin });
    setBusy(false);

    if (!result.ok) {
      const msg = (result.error || '').toLowerCase();
      if (msg.includes('pseudo')) setPseudoError(result.error);
      else setError(result.error);
    }
  };

  return (
    <div className="max-w-md mx-auto px-5 py-6">
      {/* Logo en haut */}
      <div className="text-center mb-4">
        <Logo size={140} />
      </div>

      {/* Bandeau de parrainage si on arrive depuis un lien d'invitation */}
      {pendingRef && (
        <div className="rounded-2xl p-4 mb-4 text-center clic-fade-in" style={{
          background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
        }}>
          <div className="text-3xl mb-1">🎉</div>
          <p className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
            <span style={{ color: C.accentPink }}>{pendingRef}</span> t'a invité sur ClicJeu !
          </p>
          <p className="text-xs mt-2" style={{ color: C.inkLight, fontWeight: 600 }}>
            Inscris-toi pour devenir son ami et jouer ensemble 👇
          </p>
        </div>
      )}

      {/* Toggle Connexion / Inscription */}
      <div className="rounded-full p-1 mb-6 flex"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
        <button onClick={() => switchMode('login')}
          className="flex-1 py-3 rounded-full text-sm transition-all clic-press"
          style={{
            background: mode === 'login' ? C.accentPink : 'transparent',
            color: mode === 'login' ? C.white : C.inkLight,
            fontWeight: 700,
            fontFamily: '"Fredoka", sans-serif',
          }}>
          Connexion
        </button>
        <button onClick={() => switchMode('signup')}
          className="flex-1 py-3 rounded-full text-sm transition-all clic-press"
          style={{
            background: mode === 'signup' ? C.accentPink : 'transparent',
            color: mode === 'signup' ? C.white : C.inkLight,
            fontWeight: 700,
            fontFamily: '"Fredoka", sans-serif',
          }}>
          Inscription
        </button>
      </div>

      {/* Titre dynamique */}
      <div className="text-center mb-5">
        <h2 className="text-2xl mb-1"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {mode === 'login' ? 'Bon retour ! 👋' : 'Crée ton compte ✨'}
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          {mode === 'login'
            ? 'Connecte-toi avec ton pseudo et ton PIN'
            : 'Choisis un pseudo unique et un PIN à 4 chiffres'}
        </p>
      </div>

      {/* Champ pseudo */}
      <div className="rounded-3xl p-5 mb-3" style={{ background: C.pink, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          ✏️ TON PSEUDO
        </label>
        <input
          type="text" value={pseudo} onChange={(e) => onPseudoChange(e.target.value)}
          placeholder="ex: SuperJoueur"
          maxLength={15}
          autoCapitalize="none"
          className="w-full p-4 rounded-2xl text-base outline-none"
          style={{
            background: C.white, color: C.ink, fontWeight: 600,
            boxShadow: pseudoError
              ? 'inset 0 0 0 2px #B33, inset 0 2px 4px rgba(0,0,0,0.06)'
              : 'inset 0 2px 4px rgba(0,0,0,0.06)',
          }}
        />
        {pseudoError && (
          <div key={pseudoError} className="text-xs mt-2 clic-shake"
               style={{ color: '#B33', fontWeight: 700 }}>
            ⚠️ {pseudoError}
          </div>
        )}
      </div>

      {/* Champ PIN */}
      <div className="rounded-3xl p-5 mb-3" style={{ background: C.lavender, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔢 TON PIN (4 chiffres)
        </label>
        <PinInput value={pin} onChange={setPin} />
        {mode === 'signup' && (
          <div className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
            ⚠️ Retiens-le bien ! Pas de récupération possible.
          </div>
        )}
      </div>

      {/* Confirmation PIN — seulement en mode inscription */}
      {mode === 'signup' && (
        <div className="rounded-3xl p-5 mb-3" style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
          <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
            🔁 RETAPE TON PIN
          </label>
          <PinInput value={confirm} onChange={setConfirm} />
        </div>
      )}

      {error && (
        <div key={error} className="rounded-2xl p-3 mb-3 text-center text-sm clic-shake" style={{
          background: '#FFD0D0', color: '#B33', fontWeight: 700,
        }}>{error}</div>
      )}

      <KawaiiButton fullWidth onClick={submit}>
        {busy
          ? (mode === 'login' ? 'Connexion...' : 'Création...')
          : (mode === 'login' ? 'Se connecter →' : 'Créer mon compte 🚀')}
      </KawaiiButton>
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
    title: 'Tic Tac Toe', cardEmoji: '❌⭕', headerEmoji: '🎯',
    bg: C.pink, tagline: 'Aligne 3 symboles !',
    objective: 'Aligne 3 symboles en ligne, colonne ou diagonale avant ton adversaire.',
    rules: [
      { icon: '👤', text: 'Le 1er joueur joue avec ❌, le 2e avec ⭕' },
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
      { icon: '👤', text: 'Le 1er joueur = rouge 🔴, le 2e = jaune 🟡' },
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
      { icon: '✏️', text: 'Le 1er joueur écrit un mot en secret' },
      { icon: '🔤', text: 'Le 2e joueur propose des lettres une par une' },
      { icon: '6️⃣', text: 'Maximum 6 erreurs autorisées !' },
      { icon: '🏆', text: 'Mot trouvé = celui qui devine gagne, sinon c\'est l\'autre !' },
    ],
  },
  echecs: {
    title: 'Échecs', cardEmoji: '♟️👑', headerEmoji: '♟️',
    bg: C.cream, tagline: 'Le roi des jeux !',
    objective: 'Mets le roi adverse en échec et mat pour gagner la partie.',
    onlineOnly: true,  // pas de mode local pour les échecs
    rules: [
      { icon: '👤', text: '1er joueur = blancs ⚪, 2e joueur = noirs ⚫' },
      { icon: '👆', text: 'Touche une pièce pour voir où elle peut aller' },
      { icon: '👑', text: 'Capture le roi adverse pour gagner' },
      { icon: '⚠️', text: 'Échec = roi menacé, Mat = roi piégé' },
    ],
  },
};

// ============================================================
// GAMEHUB — niveau supérieur de l'app connectée
// Gère plusieurs rooms ouvertes + notifications de tour
// ============================================================
function GameHub({ profile, onLogout }) {
  // Navigation
  const [selectedGame, setSelectedGame] = useState(null);
  const [mode, setMode]                 = useState(null);  // null | 'local' | 'online'
  const [showRules, setShowRules]       = useState(false);
  const [showFriends, setShowFriends]   = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  // UNE seule room active à la fois
  const [activeRoom, setActiveRoom]   = useState(null);

  // Invitations reçues (bannière sur GamesGrid)
  const [incomingInvites, setIncomingInvites] = useState([]);

  // Cache profils
  const [roomProfiles, setRoomProfiles] = useState({});

  // Demandes d'amis (badge sur GamesGrid)
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);

  // Toast d'erreur (timeout 60s, etc.)
  const [toast, setToast] = useState(null);  // {message, type}

  // Charge les invitations + nombre de demandes d'amis au montage
  useEffect(() => {
    let mounted = true;

    listIncomingInvitations().then((list) => { if (mounted) setIncomingInvites(list); });
    listPendingRequests().then((list) => { if (mounted) setPendingFriendRequests(list.length); });

    const invSub = subscribeToInvitations(profile.id, () => {
      listIncomingInvitations().then((list) => { if (mounted) setIncomingInvites(list); });
    });

    return () => { mounted = false; invSub.unsubscribe(); };
  }, [profile.id]);

  // Refresh des demandes d'amis quand on quitte l'écran amis
  useEffect(() => {
    if (!showFriends) {
      listPendingRequests().then((list) => setPendingFriendRequests(list.length));
    }
  }, [showFriends]);

  // TIMEOUT 60s : si une room reste en waiting, on la supprime
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'waiting') return;

    const timer = setTimeout(async () => {
      // Vérifier le statut actuel avant de supprimer
      const { data: current } = await supabase.from('rooms').select('status').eq('id', activeRoom.id).single();
      if (current?.status === 'waiting') {
        await cancelInvitation(activeRoom.id).catch(() => {});
        setActiveRoom(null);
        setToast({ message: '⏱️ Pas de réponse, partie annulée', type: 'info' });
        setTimeout(() => setToast(null), 4000);
      }
    }, 60000);

    return () => clearTimeout(timer);
  }, [activeRoom?.id, activeRoom?.status]);

  // (La subscription à la room est gérée par Lobby qui call onRoomUpdate
  //  pour propager les changements au state activeRoom du GameHub.)

  // Helpers
  const backToGames = () => {
    setSelectedGame(null); setMode(null); setShowRules(false);
    setShowFriends(false); setActiveRoom(null); setCreatingRoom(false);
  };

  // Création d'une room online
  const createOnlineRoom = async (gameId, invitedId = null) => {
    setCreatingRoom(true);
    const result = await createRoom({ gameId, initialState: {}, invitedId });
    setCreatingRoom(false);
    if (result.ok) {
      setActiveRoom(result.room);
      // Charger profils
      const ids = [result.room.player1_id, invitedId].filter(Boolean);
      if (ids.length > 0) {
        getProfilesByIds(ids).then((p) => setRoomProfiles((prev) => ({ ...prev, ...p })));
      }
      return result.room;
    }
    setToast({ message: 'Erreur : ' + result.error, type: 'error' });
    setTimeout(() => setToast(null), 4000);
    return null;
  };

  // Accepter une invitation reçue
  const acceptIncoming = async (room) => {
    setIncomingInvites((prev) => prev.filter((r) => r.id !== room.id));
    const result = await joinRoom({ code: room.code });
    if (result.ok) {
      setActiveRoom(result.room);
      const ids = [result.room.player1_id, result.room.player2_id].filter(Boolean);
      if (ids.length > 0) {
        getProfilesByIds(ids).then((p) => setRoomProfiles((prev) => ({ ...prev, ...p })));
      }
    } else {
      setToast({ message: result.error || 'Impossible de rejoindre', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    }
  };

  // === ROUTAGE ===

  if (creatingRoom) return <LoadingScreen />;

  // Écran amis
  if (showFriends) {
    return <FriendsScreen profile={profile} onBack={() => setShowFriends(false)}
      onInviteToGame={async (friend, gameId) => {
        setShowFriends(false);
        await createOnlineRoom(gameId, friend.id);
      }}
    />;
  }

  // Lobby (room active)
  if (activeRoom) {
    return (
      <LobbyErrorBoundary key={activeRoom.id} onLeave={() => setActiveRoom(null)}>
        <Lobby
          profile={profile}
          room={activeRoom}
          roomProfiles={roomProfiles}
          onRoomUpdate={setActiveRoom}
          onLeave={async () => {
            // Quitter = annuler + supprimer (un seul comportement maintenant)
            if (activeRoom.status === 'waiting') {
              await cancelInvitation(activeRoom.id).catch(() => {});
            }
            setActiveRoom(null);
          }}
          onFinished={() => setActiveRoom(null)}
        />
      </LobbyErrorBoundary>
    );
  }

  // Choix du mode
  if (selectedGame && !mode) {
    return <ModeSelector profile={profile} gameId={selectedGame}
      onBack={() => setSelectedGame(null)}
      onPickMode={(m) => {
        setMode(m);
        if (m === 'local') setShowRules(true);
      }}
    />;
  }

  // Mode online → écran d'invitation
  if (selectedGame && mode === 'online') {
    return <InviteToPlayScreen
      profile={profile}
      gameId={selectedGame}
      onBack={() => setMode(null)}
      onInviteFriend={async (friend) => {
        await createOnlineRoom(selectedGame, friend.id);
      }}
    />;
  }

  // Mode local : règles
  if (selectedGame && mode === 'local' && showRules) {
    return <RulesScreen gameId={selectedGame}
      onBack={() => { setMode(null); setShowRules(false); }}
      onStart={() => setShowRules(false)} />;
  }

  // Mode local : jeu
  if (selectedGame && mode === 'local' && !showRules) {
    const back = () => setMode(null);
    switch (selectedGame) {
      case 'morpion':  return <TicTacToe      onBack={back} pseudo={profile.pseudo} />;
      case 'connect4': return <Connect4       onBack={back} pseudo={profile.pseudo} />;
      case 'memory':   return <Memory         onBack={back} pseudo={profile.pseudo} />;
      case 'bataille': return <BatailleNavale onBack={back} pseudo={profile.pseudo} />;
      case 'pendu':    return <Pendu          onBack={back} pseudo={profile.pseudo} />;
      default:         break;
    }
  }

  // Écran principal : GamesGrid
  return (
    <GamesGrid
      profile={profile} onLogout={onLogout}
      onPickGame={(id) => setSelectedGame(id)}
      onOpenFriends={() => setShowFriends(true)}
      pendingFriendRequests={pendingFriendRequests}
      incomingInvites={incomingInvites}
      onAcceptInvite={acceptIncoming}
      onIgnoreInvite={(roomId) => {
        setIncomingInvites((prev) => prev.filter((r) => r.id !== roomId));
      }}
      toast={toast}
    />
  );
}


// ============================================================
// FRIENDS SCREEN — Mes amis (liste + recherche + demandes)
// ============================================================
function FriendsScreen({ profile, onBack, onInviteToGame }) {
  // Onglets : 'friends' (mes amis) | 'requests' (demandes reçues) | 'search' (chercher)
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  // Pour l'invitation à jouer : quand on clique "Inviter" sur un ami,
  // on stocke ici l'ami choisi → on affiche un mini-écran de choix de jeu
  const [invitingFriend, setInvitingFriend] = useState(null);

  // Charger toutes les listes au montage
  const refresh = async () => {
    setLoading(true);
    const [f, p, s] = await Promise.all([
      listFriends(),
      listPendingRequests(),
      listSentRequests(),
    ]);
    setFriends(f);
    setPending(p);
    setSent(s);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  // Quand l'utilisateur a choisi un jeu pour l'invitation
  const handleGamePicked = (gameId) => {
    const friend = invitingFriend;
    setInvitingFriend(null);
    onInviteToGame(friend, gameId);
  };

  // Si on est en train d'inviter un ami, on affiche l'écran de choix de jeu
  if (invitingFriend) {
    return <InviteGamePicker friend={invitingFriend}
             onPick={handleGamePicked}
             onCancel={() => setInvitingFriend(null)} />;
  }

  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <header className="text-center mb-5">
        <div className="text-5xl mb-2">👥</div>
        <h2 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Mes amis
        </h2>
      </header>

      {/* Onglets */}
      <div className="rounded-full p-1 mb-5 flex"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
        <FriendTab label={`Amis ${friends.length > 0 ? `(${friends.length})` : ''}`}
                   active={tab === 'friends'} onClick={() => setTab('friends')} />
        <FriendTab label={pending.length > 0 ? `Demandes • ${pending.length}` : 'Demandes'}
                   active={tab === 'requests'} onClick={() => setTab('requests')}
                   highlight={pending.length > 0} />
        <FriendTab label="Ajouter"
                   active={tab === 'search'} onClick={() => setTab('search')} />
      </div>

      {tab === 'friends' && (
        <FriendsList friends={friends} loading={loading} onRefresh={refresh}
                     onInvite={setInvitingFriend} />
      )}
      {tab === 'requests' && (
        <RequestsList pending={pending} sent={sent} loading={loading} onRefresh={refresh} />
      )}
      {tab === 'search' && (
        <SearchUsers onSent={refresh} profile={profile} />
      )}
    </div>
  );
}

// ============================================================
// INVITE GAME PICKER — quand on invite un ami, on choisit le jeu
// ============================================================
function InviteGamePicker({ friend, onPick, onCancel }) {
  const ids = Object.keys(GAMES);
  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onCancel} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Annuler
      </button>

      <header className="text-center mb-5">
        <div className="text-5xl mb-2">{friend.avatar || '👤'}</div>
        <h2 className="text-xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Inviter <span style={{ color: C.accentPink }}>{friend.pseudo}</span>
        </h2>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          À quoi voulez-vous jouer ?
        </p>
      </header>

      <div className="space-y-2">
        {ids.map((id) => {
          const g = GAMES[id];
          return (
            <button key={id} onClick={() => onPick(id)}
              className="w-full p-4 rounded-2xl flex items-center justify-between clic-press"
              style={{
                background: g.bg,
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
              }}>
              <div className="text-left">
                <h3 className="text-lg"
                    style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                  {g.title}
                </h3>
                <p className="text-xs" style={{ color: C.inkLight, fontWeight: 600 }}>
                  {g.tagline}
                </p>
              </div>
              <div className="text-3xl">{g.cardEmoji}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Tab button ---
function FriendTab({ label, active, onClick, highlight = false }) {
  return (
    <button onClick={onClick}
      className="flex-1 py-2 rounded-full text-xs transition-all"
      style={{
        background: active ? C.accentPink : 'transparent',
        color: active ? C.white : (highlight ? C.accentPink : C.inkLight),
        fontWeight: 700,
        fontFamily: '"Fredoka", sans-serif',
      }}>
      {label}
    </button>
  );
}

// --- Liste de mes amis ---
function FriendsList({ friends, loading, onRefresh, onInvite }) {
  if (loading) {
    return <div className="text-center text-sm py-6" style={{ color: C.inkLight, fontWeight: 600 }}>
      ⏳ Chargement...
    </div>;
  }
  if (friends.length === 0) {
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
      }}>
        <div className="text-5xl mb-3">🤗</div>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Pas encore d'amis sur ClicJeu.
          <br />
          Ajoute quelqu'un via l'onglet <span style={{ color: C.accentPink, fontWeight: 700 }}>"Ajouter"</span> !
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {friends.map((f) => (
        <FriendRow key={f.id} friend={f} onRemoved={onRefresh} onInvite={onInvite} />
      ))}
    </div>
  );
}

// --- Une ligne d'ami ---
function FriendRow({ friend, onRemoved, onInvite }) {
  const [confirming, setConfirming] = useState(false);

  const handleRemove = async () => {
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
    await removeFriend(friend.id);
    onRemoved();
  };

  return (
    <div className="flex items-center gap-2 p-3 rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
      <div className="text-3xl">{friend.avatar || '👤'}</div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          {friend.pseudo}
        </div>
      </div>
      {onInvite && (
        <button onClick={() => onInvite(friend)}
          className="text-sm px-4 py-3 rounded-full clic-press"
          style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                   fontFamily: '"Fredoka", sans-serif',
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          🎮 Inviter
        </button>
      )}
      <button onClick={handleRemove}
        className="text-base px-3 py-3 rounded-full clic-press"
        style={{
          background: confirming ? '#FFD0D0' : C.cream,
          color: confirming ? '#B33' : C.inkLight,
          fontWeight: 700,
          boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
        }}>
        {confirming ? '?' : '🗑️'}
      </button>
    </div>
  );
}

// --- Liste des demandes ---
function RequestsList({ pending, sent, loading, onRefresh }) {
  if (loading) {
    return <div className="text-center text-sm py-6" style={{ color: C.inkLight, fontWeight: 600 }}>
      ⏳ Chargement...
    </div>;
  }

  if (pending.length === 0 && sent.length === 0) {
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: C.lavender, boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
      }}>
        <div className="text-5xl mb-3">📭</div>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Aucune demande en attente
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <div>
          <div className="text-xs mb-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
            📥 REÇUES ({pending.length})
          </div>
          <div className="space-y-2">
            {pending.map((u) => (
              <PendingRow key={u.id} user={u} onAction={onRefresh} />
            ))}
          </div>
        </div>
      )}
      {sent.length > 0 && (
        <div>
          <div className="text-xs mb-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
            📤 ENVOYÉES ({sent.length})
          </div>
          <div className="space-y-2">
            {sent.map((u) => (
              <SentRow key={u.id} user={u} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PendingRow({ user, onAction }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    await acceptFriendRequest(user.id);
    setBusy(false);
    onAction();
  };
  const reject = async () => {
    setBusy(true);
    await rejectFriendRequest(user.id);
    setBusy(false);
    onAction();
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
      <div className="text-3xl">{user.avatar || '👤'}</div>
      <div className="flex-1">
        <div style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          {user.pseudo}
        </div>
        <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
          veut être ton ami
        </div>
      </div>
      <button onClick={reject} disabled={busy}
        className="text-lg px-2 py-1 rounded-full clic-press"
        style={{ background: '#FFD0D0', color: '#B33', fontWeight: 700 }}>
        ✕
      </button>
      <button onClick={accept} disabled={busy}
        className="text-lg px-2 py-1 rounded-full clic-press"
        style={{ background: C.mint, color: C.ink, fontWeight: 700 }}>
        ✓
      </button>
    </div>
  );
}

function SentRow({ user }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)', opacity: 0.7 }}>
      <div className="text-3xl">{user.avatar || '👤'}</div>
      <div className="flex-1">
        <div style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          {user.pseudo}
        </div>
        <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
          ⏳ En attente de réponse
        </div>
      </div>
    </div>
  );
}

// --- Recherche d'utilisateurs ---
function SearchUsers({ onSent, profile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  // Recherche en différé (300ms après la dernière frappe) — évite de spammer Supabase
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]); setSearched(false);
      return;
    }
    const timer = setTimeout(async () => {
      setBusy(true);
      const data = await searchUsers(query);
      setResults(data);
      setBusy(false);
      setSearched(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const shareApp = async () => {
    const url = `https://clicjeu.com/?ref=${encodeURIComponent(profile?.pseudo || '')}`;
    const text = `Viens jouer avec moi sur ClicJeu ! 🎮`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ClicJeu', text, url }); } catch {}
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  return (
    <div>
      <div className="rounded-3xl p-5 mb-3"
           style={{ background: C.pink, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔍 PSEUDO À AJOUTER
        </label>
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Tape un pseudo..."
          autoCapitalize="none"
          className="w-full p-4 rounded-2xl text-base outline-none"
          style={{
            background: C.white, color: C.ink, fontWeight: 600,
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
          }}
        />
      </div>

      {busy && (
        <div className="text-center text-sm py-2" style={{ color: C.inkLight, fontWeight: 600 }}>
          🔍 Recherche...
        </div>
      )}

      {!busy && searched && results.length === 0 && (
        <div className="rounded-2xl p-4 text-center text-sm"
             style={{ background: 'rgba(255,255,255,0.7)', color: C.inkLight, fontWeight: 600 }}>
          Aucun résultat pour "{query}"
        </div>
      )}

      <div className="space-y-2 mt-3">
        {results.map((u) => (
          <SearchResultRow key={u.id} user={u} onSent={onSent} />
        ))}
      </div>

      {/* Inviter quelqu'un sur ClicJeu (partage l'app) */}
      <div className="rounded-3xl p-4 mt-4"
           style={{ background: C.lavender, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center mb-3">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            PAS ENCORE INSCRIT ?
          </div>
        </div>
        <button onClick={shareApp}
          className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 clic-press"
          style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-xl">📲</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            Inviter un proche sur ClicJeu
          </span>
        </button>
        <p className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          Partage le lien. Une fois inscrit, il deviendra ton ami.
        </p>
      </div>
    </div>
  );
}

function SearchResultRow({ user, onSent }) {
  const [status, setStatus] = useState('idle');  // idle | sending | sent | error
  const [error, setError] = useState('');

  const send = async () => {
    setStatus('sending');
    setError('');
    const result = await sendFriendRequest(user.id);
    if (result.ok) {
      setStatus('sent');
      onSent();  // refresh les listes du parent
    } else {
      setStatus('error');
      setError(result.error);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
      <div className="text-3xl">{user.avatar || '👤'}</div>
      <div className="flex-1">
        <div style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          {user.pseudo}
        </div>
        {error && (
          <div className="text-xs" style={{ color: '#B33', fontWeight: 600 }}>{error}</div>
        )}
      </div>
      {status === 'sent' ? (
        <div className="text-sm px-4 py-3 rounded-full"
             style={{ background: C.mint, color: C.ink, fontWeight: 700,
                      fontFamily: '"Fredoka", sans-serif',
                      boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          ✓ Envoyée
        </div>
      ) : (
        <button onClick={send} disabled={status === 'sending'}
          className="text-sm px-4 py-3 rounded-full clic-press"
          style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                   fontFamily: '"Fredoka", sans-serif',
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          {status === 'sending' ? '...' : '+ Ami'}
        </button>
      )}
    </div>
  );
}

// --- Barre de profil (avatar + pseudo + menu déconnexion) ---
function ProfileBar({ profile, onLogout, onOpenFriends, pendingFriends = 0 }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between mb-6">
      {/* Avatar + pseudo → dropdown déconnexion */}
      <div className="relative">
        <button onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-2 rounded-full"
          style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-2xl">{profile.avatar}</span>
          <span style={{ color: C.ink, fontWeight: 700 }}>{profile.pseudo}</span>
          <span className="text-xs ml-1" style={{ color: C.inkSoft }}>▾</span>
        </button>

        {open && (
          <div className="absolute left-0 top-full mt-2 rounded-2xl p-2 z-20" style={{
            background: C.white, minWidth: 180,
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
          }}>
            <button onClick={() => { setOpen(false); onLogout(); }}
              className="w-full text-left px-3 py-2 rounded-xl text-sm clic-press"
              style={{ color: C.accentPink, fontWeight: 700 }}>
              🚪 Se déconnecter
            </button>
          </div>
        )}
      </div>

      {/* Bouton amis — toujours visible */}
      {onOpenFriends && (
        <button onClick={onOpenFriends}
          className="relative flex items-center gap-2 px-4 py-2 rounded-full clic-press"
          style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span style={{ color: C.ink, fontWeight: 700 }}>👥</span>
          <span style={{ color: C.ink, fontWeight: 700, fontSize: '0.85rem' }}>Amis</span>
          {pendingFriends > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs flex items-center justify-center"
                  style={{ background: C.accentPink, color: C.white, fontWeight: 700 }}>
              {pendingFriends}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

// ============================================================
// MODE SELECTOR — local ou online
// ============================================================
// ============================================================
// GAMES GRID — Liste des jeux en grandes cartes Netflix-style
// ============================================================
// 1 carte par jeu, en grille 1 col mobile / 2 col tablette+
// On clique sur une carte → on passe à l'écran ModeSelector
// ============================================================
// ============================================================
// INCOMING INVITES BANNER — bandeau en haut quand on a reçu des invitations
// ============================================================
function IncomingInvitesBanner({ invites, onAccept, onIgnore }) {
  // On va charger les pseudos des inviteurs
  const [hostProfiles, setHostProfiles] = useState({});

  useEffect(() => {
    const ids = invites.map((r) => r.player1_id);
    if (ids.length === 0) return;
    getProfilesByIds(ids).then(setHostProfiles);
  }, [invites]);

  return (
    <div className="space-y-2 mb-5">
      {invites.map((room) => {
        const host = hostProfiles[room.player1_id];
        const game = GAMES[room.game];
        return (
          <div key={room.id} className="rounded-2xl p-4 flex items-center gap-3 clic-fade-in"
               style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
            <div className="text-3xl">{host?.avatar || '👤'}</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
                🔔 INVITATION
              </div>
              <div className="text-sm" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                <span style={{ color: C.accentPink }}>{host?.pseudo || 'Quelqu\'un'}</span>
                {' '}t'invite à jouer à {game?.title || 'un jeu'} {game?.cardEmoji}
              </div>
            </div>
            <button onClick={() => onIgnore(room.id)}
              className="text-lg px-2 py-1 rounded-full clic-press"
              style={{ background: C.white, color: C.inkLight, fontWeight: 700 }}>
              ✕
            </button>
            <button onClick={() => onAccept(room)}
              className="text-sm px-3 py-2 rounded-full clic-press"
              style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                       fontFamily: '"Fredoka", sans-serif' }}>
              Jouer →
            </button>
          </div>
        );
      })}
    </div>
  );
}

function GamesGrid({ profile, onLogout, onPickGame, onOpenFriends,
                      pendingFriendRequests = 0,
                      incomingInvites = [], onAcceptInvite, onIgnoreInvite,
                      toast = null }) {
  const ids = Object.keys(GAMES);

  return (
    <div className="max-w-2xl mx-auto px-5 py-6">
      <ProfileBar profile={profile} onLogout={onLogout}
                  onOpenFriends={onOpenFriends} pendingFriends={pendingFriendRequests} />

      {/* Toast (timeout, erreur, etc.) */}
      {toast && (
        <div className="rounded-2xl p-3 mb-3 text-center clic-fade-in"
             style={{
               background: toast.type === 'error' ? '#FFD0D0' : C.peach,
               color: toast.type === 'error' ? '#B33' : C.ink,
               fontWeight: 700, fontSize: '0.9rem',
               boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
             }}>
          {toast.message}
        </div>
      )}

      {/* Demandes d'amis reçues — carte mise en avant */}
      {pendingFriendRequests > 0 && (
        <button onClick={onOpenFriends}
          className="w-full rounded-2xl p-3 mb-3 flex items-center gap-3 clic-press"
          style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-2xl">🔔</div>
          <div className="flex-1 text-left">
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
              DEMANDES D'AMIS
            </div>
            <div className="text-sm"
                 style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              {pendingFriendRequests === 1
                ? '1 personne veut être ton ami'
                : `${pendingFriendRequests} personnes veulent être tes amis`}
            </div>
          </div>
          <div className="text-sm" style={{ color: C.inkSoft, fontWeight: 700 }}>→</div>
        </button>
      )}

      {/* Invitations à jouer reçues */}
      {incomingInvites.length > 0 && (
        <IncomingInvitesBanner
          invites={incomingInvites}
          onAccept={onAcceptInvite}
          onIgnore={onIgnoreInvite}
        />
      )}

      <header className="text-center mb-6">
        <div className="mb-2"><Logo size={140} /></div>
        <p className="text-base" style={{ color: C.inkLight, fontWeight: 600 }}>
          Salut <span style={{ color: C.ink, fontWeight: 700 }}>{profile.pseudo}</span> !
          Quel jeu te tente ? ✨
        </p>
      </header>

      {/* Grille Netflix-style — 1 col mobile, 2 col tablette */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ids.map((id) => {
          const g = GAMES[id];
          return (
            <button key={id} onClick={() => onPickGame(id)}
              className="rounded-3xl p-5 text-left transition-all clic-press relative overflow-hidden"
              style={{
                background: g.bg,
                boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.10)',
                minHeight: '180px',
              }}>
              {/* Emoji géant en fond, légèrement transparent */}
              <div className="absolute -right-3 -bottom-3 opacity-30"
                   style={{ fontSize: '7rem', lineHeight: 1 }}>
                {g.headerEmoji}
              </div>

              {/* Contenu de la carte */}
              <div className="relative">
                <div className="text-4xl mb-2">{g.cardEmoji}</div>
                <h3 className="text-2xl mb-1"
                    style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                  {g.title}
                </h3>
                <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
                  {g.tagline}
                </p>
                {g.onlineOnly && (
                  <div className="inline-block mt-2 px-2 py-0.5 rounded-full text-xs"
                       style={{ background: C.white, color: C.accentPink, fontWeight: 700 }}>
                    🌐 En ligne uniquement
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// MODE SELECTOR — Local ou Online pour un jeu donné
// ============================================================
function ModeSelector({ profile, gameId, onBack, onPickMode }) {
  const g = GAMES[gameId];
  const onlineOnly = !!g.onlineOnly;

  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Autres jeux
      </button>

      {/* En-tête avec le jeu choisi */}
      <div className="rounded-3xl p-6 text-center mb-6"
           style={{ background: g.bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-6xl mb-2">{g.cardEmoji}</div>
        <h2 className="text-3xl mb-1"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {g.title}
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          {g.objective}
        </p>
      </div>

      <p className="text-center text-sm mb-4" style={{ color: C.inkLight, fontWeight: 600 }}>
        Comment veux-tu jouer ?
      </p>

      {/* En ligne en premier (plus mis en avant) */}
      <button onClick={() => onPickMode('online')}
        className="w-full p-5 rounded-3xl mb-3 text-left clic-press"
        style={{
          background: C.lavender,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="flex items-center gap-4">
          <div className="text-4xl">🌐</div>
          <div className="flex-1">
            <h3 className="text-xl"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              En ligne avec un ami
            </h3>
            <p className="text-xs mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
              À distance, invite tes amis
            </p>
          </div>
        </div>
      </button>

      {/* Mode local (désactivé si jeu onlineOnly) */}
      <button onClick={() => !onlineOnly && onPickMode('local')}
        disabled={onlineOnly}
        className="w-full p-5 rounded-3xl text-left clic-press"
        style={{
          background: C.mint,
          opacity: onlineOnly ? 0.4 : 1,
          cursor: onlineOnly ? 'not-allowed' : 'pointer',
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="flex items-center gap-4">
          <div className="text-4xl">🤝</div>
          <div className="flex-1">
            <h3 className="text-xl"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              Sur le même appareil
            </h3>
            <p className="text-xs mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
              {onlineOnly ? 'Pas disponible pour ce jeu' : 'Avec un ami à côté de toi'}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}

// ============================================================
// PLACEHOLDER MODE ONLINE — ce qu'on va construire
// ============================================================
// ============================================================
// ONLINE HUB — Choix Créer / Rejoindre une partie
// Si preselectedGame est fourni, la création de salon skip le choix du jeu
// ============================================================
function OnlineHub({ profile, onBack, preselectedGame = null, autoJoinCode = null }) {
  // Si on a un code en auto-join, on commence direct sur l'écran 'join'
  const [screen, setScreen] = useState(autoJoinCode ? 'join' : 'pick');
  const [currentRoom, setCurrentRoom] = useState(null);

  const backToPick = () => { setScreen('pick'); setCurrentRoom(null); };

  if (screen === 'create') {
    return <CreateRoomScreen profile={profile} onBack={backToPick}
             preselectedGame={preselectedGame}
             onCreated={(room) => { setCurrentRoom(room); setScreen('lobby'); }} />;
  }

  if (screen === 'join') {
    return <JoinRoomScreen profile={profile} onBack={onBack}
             autoJoinCode={autoJoinCode}
             onJoined={(room) => { setCurrentRoom(room); setScreen('lobby'); }} />;
  }

  if (screen === 'lobby') {
    return <Lobby profile={profile} room={currentRoom} onLeave={backToPick} />;
  }

  // Écran 'pick' par défaut
  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <header className="text-center mb-8">
        <div className="text-6xl mb-3">🌐</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Jouer en ligne
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Crée une partie ou rejoins celle d'un ami ✨
        </p>
      </header>

      <button onClick={() => setScreen('create')}
        className="w-full p-6 rounded-3xl mb-4 text-left clic-press"
        style={{
          background: C.mint,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="text-5xl mb-2">🎲</div>
        <h3 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
          Créer une partie
        </h3>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          Tu reçois un code à partager
        </p>
      </button>

      <button onClick={() => setScreen('join')}
        className="w-full p-6 rounded-3xl mb-4 text-left clic-press"
        style={{
          background: C.lavender,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="text-5xl mb-2">🔗</div>
        <h3 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
          Rejoindre une partie
        </h3>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          Tu tapes le code que ton ami t'a donné
        </p>
      </button>
    </div>
  );
}

// ============================================================
// CreateRoomScreen — choisir un jeu puis créer le salon
// ============================================================
function CreateRoomScreen({ profile, onBack, onCreated, preselectedGame = null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ids = Object.keys(GAMES);

  // Crée le salon pour un jeu donné
  const create = async (gameId) => {
    setError('');
    setBusy(true);
    const result = await createRoom({ gameId, initialState: {} });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
    } else {
      onCreated(result.room);
    }
  };

  // Si on a un jeu pré-sélectionné, on crée direct la partie sans afficher la liste
  useEffect(() => {
    if (preselectedGame && !busy) {
      create(preselectedGame);
    }
    // eslint-disable-next-line
  }, [preselectedGame]);

  // Si on a un jeu pré-sélectionné et qu'on est en cours de création
  // → on affiche juste un écran de chargement (le salon se crée automatiquement)
  if (preselectedGame) {
    return (
      <div className="max-w-md mx-auto px-5 py-8">
        <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour
        </button>
        <div className="rounded-3xl p-8 text-center" style={{
          background: GAMES[preselectedGame].bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
        }}>
          <div className="text-5xl mb-3">⏳</div>
          <h2 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Création du salon...
          </h2>
          <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            On prépare ta partie de {GAMES[preselectedGame].title}
          </p>
        </div>
        {error && (
          <div key={error} className="mt-4 rounded-2xl p-3 text-center text-sm clic-shake"
               style={{ background: '#FFD0D0', color: '#B33', fontWeight: 700 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <header className="text-center mb-6">
        <div className="text-5xl mb-3">🎲</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Choisis le jeu
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Pour quelle partie veux-tu créer un salon ?
        </p>
      </header>

      <div className="space-y-3">
        {ids.map((id) => {
          const g = GAMES[id];
          // Pour l'étape 2, seul Tic Tac Toe est dispo en online
          // (les autres jeux seront portés à l'étape 5)
          const isOnlineReady = true;  // les 5 jeux sont disponibles en ligne 🎉
          return (
            <button key={id}
              onClick={() => isOnlineReady && !busy && create(id)}
              disabled={!isOnlineReady || busy}
              className="w-full p-4 rounded-2xl flex items-center justify-between clic-press"
              style={{
                background: g.bg,
                opacity: isOnlineReady ? 1 : 0.5,
                cursor: isOnlineReady ? 'pointer' : 'not-allowed',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
              }}>
              <div className="text-left">
                <h3 className="text-xl"
                    style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 600, color: C.ink }}>
                  {g.title}
                </h3>
                <p className="text-xs mt-0.5" style={{ color: C.inkLight, fontWeight: 600 }}>
                  {isOnlineReady ? g.tagline : '🚧 Bientôt disponible en ligne'}
                </p>
              </div>
              <div className="text-3xl">{g.cardEmoji}</div>
            </button>
          );
        })}
      </div>

      {busy && (
        <div className="mt-4 text-center text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          ⏳ Création du salon...
        </div>
      )}
      {error && (
        <div key={error} className="mt-4 rounded-2xl p-3 text-center text-sm clic-shake"
             style={{ background: '#FFD0D0', color: '#B33', fontWeight: 700 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ============================================================
// JoinRoomScreen — taper un code pour rejoindre
// ============================================================
function JoinRoomScreen({ profile, onBack, onJoined, autoJoinCode = null }) {
  const [code, setCode] = useState(autoJoinCode || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [autoTried, setAutoTried] = useState(false);

  const submit = async (codeOverride = null) => {
    setError('');
    const codeToUse = codeOverride || code;
    if (codeToUse.trim().length < 3) return setError('Tape un code valide.');
    setBusy(true);
    const result = await joinRoom({ code: codeToUse });
    setBusy(false);
    if (!result.ok) setError(result.error);
    else onJoined(result.room);
  };

  // Si on a un code auto, on essaie de rejoindre direct (une seule fois)
  useEffect(() => {
    if (autoJoinCode && !autoTried) {
      setAutoTried(true);
      submit(autoJoinCode);
    }
    // eslint-disable-next-line
  }, [autoJoinCode, autoTried]);

  // Pendant l'auto-join : on affiche un loader propre
  if (autoJoinCode && busy) {
    return (
      <div className="max-w-md mx-auto px-5 py-8">
        <div className="rounded-3xl p-8 text-center" style={{
          background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
        }}>
          <div className="text-5xl mb-3">⏳</div>
          <h2 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            On te connecte...
          </h2>
          <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            Salon : <span style={{ color: C.accentPink, fontWeight: 700 }}>{autoJoinCode}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-6 px-4 py-2 rounded-full text-sm"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <header className="text-center mb-6">
        <div className="text-5xl mb-3">🔗</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Rejoindre
        </h2>
        <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Tape le code que ton ami t'a donné
        </p>
      </header>

      <div className="rounded-3xl p-6 mb-4" style={{
        background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
      }}>
        <label className="block text-xs mb-2" style={{ color: C.ink, fontWeight: 700 }}>
          🔢 CODE DE LA PARTIE
        </label>
        <input
          type="text" value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="K7M2X9"
          autoCapitalize="characters"
          className="w-full p-4 rounded-2xl text-center outline-none"
          style={{
            background: C.white, color: C.ink,
            fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
            fontSize: '1.5rem', letterSpacing: '0.1em',
            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
          }}
        />
        <div className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          Format : COULEUR-ANIMAL
        </div>
      </div>

      {error && (
        <div key={error} className="rounded-2xl p-3 mb-4 text-center text-sm clic-shake"
             style={{ background: '#FFD0D0', color: '#B33', fontWeight: 700 }}>
          {error}
        </div>
      )}

      <KawaiiButton fullWidth onClick={submit}>
        {busy ? 'Connexion...' : 'Rejoindre →'}
      </KawaiiButton>
    </div>
  );
}

// ============================================================
// Lobby — salle d'attente après création OU une fois rejoint
// Affiche le code à partager + écoute les changements en temps réel
// ============================================================
// ============================================================
// INVITE FRIENDS PANEL — dans le Lobby, remplace le code BLEU-CHAT
// ============================================================
// ============================================================
// WAITING TIMER — Décompte 60s sur le Lobby quand on attend
// ============================================================
function WaitingTimer({ createdAt }) {
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
      setSecondsLeft(Math.max(0, 60 - elapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  if (secondsLeft <= 0) return null;

  const urgent = secondsLeft <= 15;
  return (
    <div className="text-xs px-3 py-2 rounded-full"
         style={{
           background: urgent ? '#FFD0D0' : C.cream,
           color: urgent ? '#B33' : C.inkLight,
           fontWeight: 700, fontFamily: '"Fredoka", sans-serif',
         }}>
      ⏱️ {secondsLeft}s
    </div>
  );
}

function InviteFriendsPanel({ room, profile, onRoomUpdate }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invited, setInvited] = useState(new Set());

  useEffect(() => {
    listFriends().then((f) => { setFriends(f); setLoading(false); });
  }, []);

  const invite = async (userId) => {
    if (invited.has(userId)) return;
    setInvited((prev) => new Set([...prev, userId]));
    const result = await updateRoomInvite(room.id, userId);
    if (result.ok) {
      onRoomUpdate({ ...room, invited_id: userId });
    }
  };

  const shareApp = async () => {
    const url = `https://clicjeu.com/?ref=${encodeURIComponent(profile.pseudo)}`;
    const text = `Viens jouer avec moi sur ClicJeu ! 🎮`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ClicJeu', text, url }); } catch {}
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  return (
    <div className="rounded-3xl p-5 mb-4" style={{
      background: C.white, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
    }}>
      <h3 className="text-base mb-4 text-center"
          style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
        Qui veux-tu inviter ? 🎮
      </h3>

      {/* Liste d'amis */}
      {loading ? (
        <div className="text-center text-sm py-4" style={{ color: C.inkLight, fontWeight: 600 }}>
          ⏳ Chargement...
        </div>
      ) : friends.length === 0 ? (
        <div className="text-center py-4 text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          Pas encore d'amis sur ClicJeu.
          <br />
          Invite quelqu'un à s'inscrire ci-dessous ✨
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          {friends.map((f) => {
            const wasInvited = invited.has(f.id);
            return (
              <div key={f.id} className="flex items-center gap-2 p-3 rounded-2xl"
                   style={{ background: C.cream, boxShadow: '0 2px 0 rgba(0,0,0,0.04)' }}>
                <div className="text-2xl">{f.avatar || '👤'}</div>
                <div className="flex-1 text-sm truncate"
                     style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                  {f.pseudo}
                </div>
                <button onClick={() => invite(f.id)} disabled={wasInvited}
                  className="text-xs px-3 py-2 rounded-full clic-press"
                  style={{
                    background: wasInvited ? C.mint : C.accentPink,
                    color: C.white, fontWeight: 700,
                    opacity: wasInvited ? 0.8 : 1,
                  }}>
                  {wasInvited ? '✓ Invité' : '+ Inviter'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Inviter quelqu'un sur ClicJeu (partage l'app, pas la partie) */}
      <div className="mt-4 pt-4" style={{ borderTop: `1px dashed ${C.inkSoft}` }}>
        <div className="text-xs mb-2 text-center" style={{ color: C.inkSoft, fontWeight: 700 }}>
          PAS D'AMIS DISPO ?
        </div>
        <button onClick={shareApp}
          className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 clic-press"
          style={{ background: C.lavender, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-xl">📲</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            Inviter quelqu'un sur ClicJeu
          </span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// INVITE TO PLAY SCREEN — choisir un ami pour jouer
// (après "En ligne", avant la création de la room)
// ============================================================
function InviteToPlayScreen({ profile, gameId, onBack, onInviteFriend }) {
  const g = GAMES[gameId];
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(null); // id en cours d'invitation

  useEffect(() => {
    listFriends().then((f) => { setFriends(f); setLoading(false); });
  }, []);

  const shareApp = async () => {
    const url = `https://clicjeu.com/?ref=${encodeURIComponent(profile.pseudo)}`;
    const text = `Viens jouer avec moi sur ClicJeu ! 🎮`;
    if (navigator.share) {
      try { await navigator.share({ title: 'ClicJeu', text, url }); } catch {}
    } else {
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const handleInvite = async (friend) => {
    setInviting(friend.id);
    await onInviteFriend(friend);
    // (le parent va naviguer ailleurs si ça réussit)
  };

  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      {/* En-tête du jeu */}
      <div className="rounded-3xl p-5 text-center mb-5"
           style={{ background: g.bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-5xl mb-2">{g.cardEmoji}</div>
        <h2 className="text-2xl"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {g.title} en ligne
        </h2>
      </div>

      <h3 className="text-base mb-3 text-center"
          style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
        Qui veux-tu inviter ? 🎮
      </h3>

      {/* Liste d'amis */}
      {loading ? (
        <div className="text-center text-sm py-6" style={{ color: C.inkLight, fontWeight: 600 }}>
          ⏳ Chargement...
        </div>
      ) : friends.length === 0 ? (
        <div className="rounded-3xl p-5 text-center mb-4"
             style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
          <div className="text-4xl mb-2">🤗</div>
          <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            Tu n'as pas encore d'amis sur ClicJeu.
            <br />
            Invite quelqu'un à s'inscrire avec le bouton ci-dessous ✨
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {friends.map((f) => (
            <div key={f.id} className="flex items-center gap-3 p-3 rounded-2xl"
                 style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
              <div className="text-3xl">{f.avatar || '👤'}</div>
              <div className="flex-1 min-w-0">
                <div className="truncate"
                     style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                  {f.pseudo}
                </div>
              </div>
              <button onClick={() => handleInvite(f)} disabled={inviting === f.id}
                className="text-xs px-3 py-2 rounded-full clic-press"
                style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                         opacity: inviting === f.id ? 0.6 : 1 }}>
                {inviting === f.id ? '...' : '+ Inviter'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Inviter sur ClicJeu (partage l'app) */}
      <div className="rounded-3xl p-4"
           style={{ background: C.lavender, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center mb-3">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            PAS D'AMIS DISPO ?
          </div>
        </div>
        <button onClick={shareApp}
          className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 clic-press"
          style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-xl">📲</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            Inviter quelqu'un sur ClicJeu
          </span>
        </button>
        <p className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          Partage le lien à un proche. Une fois inscrit, il deviendra ton ami.
        </p>
      </div>
    </div>
  );
}

function Lobby({ profile, room, onLeave, onCancel, onFinished, onRoomUpdate }) {
  const [currentRoom, setCurrentRoom] = useState(room);
  const [profiles, setProfiles] = useState({});

  // Sync : si le parent passe une nouvelle room (via realtime), on suit
  useEffect(() => {
    if (room && room.id !== currentRoom.id) {
      setCurrentRoom(room);
    } else if (room) {
      // Même room, on synchronise les changements (status, state, etc.)
      setCurrentRoom(room);
    }
  }, [room]);

  const isHost = currentRoom?.player1_id === profile.id;
  // Guard: si le jeu n'existe pas dans notre liste → écran d'erreur
  const game = GAMES[currentRoom.game] || null;

  const updateCurrent = (newRoom) => {
    setCurrentRoom(newRoom);
    if (onRoomUpdate) onRoomUpdate(newRoom);
  };

  // Au montage : charge les profils des 2 joueurs + invité éventuel + s'abonne
  useEffect(() => {
    let mounted = true;

    // Charge les pseudos (player1, player2, et l'ami invité s'il y en a un)
    const idsToLoad = [currentRoom.player1_id, currentRoom.player2_id, currentRoom.invited_id];
    getProfilesByIds(idsToLoad).then((p) => {
      if (mounted) setProfiles(p);
    });

    // Écoute les updates de la room (l'autre joueur qui rejoint, etc.)
    const sub = subscribeToRoom(currentRoom.id, (newRoom) => {
      if (!mounted) return;
      updateCurrent(newRoom);
      // Si player2 vient de rejoindre, recharge les profils
      if (newRoom.player2_id && !profiles[newRoom.player2_id]) {
        getProfilesByIds([newRoom.player1_id, newRoom.player2_id, newRoom.invited_id]).then((p) => {
          if (mounted) setProfiles(p);
        });
      }
    });

    return () => { mounted = false; sub.unsubscribe(); };
  }, [currentRoom.id]);

  // Guard: jeu inconnu (vieille room incompatible)
  if (!game) {
    return (
      <div className="max-w-md mx-auto px-5 py-8">
        <button onClick={onLeave} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700, boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour
        </button>
        <div className="rounded-3xl p-8 text-center" style={{ background: '#FFD0D0', boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-5xl mb-3">🗂️</div>
          <h3 style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, fontSize: '1.2rem', color: '#5C4A3D' }}>
            Partie incompatible
          </h3>
          <p style={{ color: '#8B7355', fontWeight: 600, fontSize: '0.9rem', marginTop: 8 }}>
            Cette partie date d'une ancienne version de ClicJeu.
          </p>
          <button onClick={() => onCancel && onCancel()}
            style={{ marginTop: 16, background: '#B33', color: '#fff', fontWeight: 700,
                     padding: '10px 20px', borderRadius: 12, border: 'none' }}>
            Supprimer
          </button>
        </div>
      </div>
    );
  }

  const player1 = profiles[currentRoom.player1_id];
  const player2 = currentRoom.player2_id ? profiles[currentRoom.player2_id] : null;
  const waiting = currentRoom.status === 'waiting';
  const ready   = currentRoom.status === 'playing' && player1 && player2;

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      {/* Barre de navigation : Quitter (= annuler la partie en attente) */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onLeave} className="px-4 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Quitter
        </button>
        {waiting && (
          <WaitingTimer createdAt={currentRoom.created_at} />
        )}
      </div>

      {/* En-tête du jeu */}
      {!ready && (
        <div className="rounded-3xl p-5 text-center mb-5" style={{
          background: game.bg, boxShadow: '0 6px 0 rgba(0,0,0,0.06)',
        }}>
          <div className="text-4xl mb-1">{game.cardEmoji}</div>
          <h2 className="text-xl"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {game.title}
          </h2>
        </div>
      )}

      {/* Section invitation (seulement quand on attend un 2e joueur) */}
      {waiting && (
        <InviteFriendsPanel
          room={currentRoom}
          profile={profile}
          onRoomUpdate={updateCurrent}
        />
      )}

      {/* Cartes des joueurs (seulement si on attend) */}
      {!ready && (
        <>
          <div className="rounded-2xl p-4 mb-3 flex items-center gap-3" style={{
            background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
          }}>
            <div className="text-3xl">{player1?.avatar || '👤'}</div>
            <div className="flex-1">
              <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>JOUEUR 1 (HÔTE)</div>
              <div style={{ color: C.ink, fontWeight: 700 }}>{player1?.pseudo || 'Chargement...'}</div>
            </div>
            <div className="text-xs px-2 py-1 rounded-full"
                 style={{ background: C.mint, color: C.ink, fontWeight: 700 }}>✓ Prêt</div>
          </div>

          <div className="rounded-2xl p-4 mb-4 flex items-center gap-3" style={{
            background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
            opacity: player2 ? 1 : 0.5,
          }}>
            <div className="text-3xl">{player2?.avatar || '👤'}</div>
            <div className="flex-1">
              <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>JOUEUR 2</div>
              <div style={{ color: C.ink, fontWeight: 700 }}>
                {player2?.pseudo || (waiting ? 'En attente...' : 'Chargement...')}
              </div>
            </div>
            {player2 && (
              <div className="text-xs px-2 py-1 rounded-full"
                   style={{ background: C.mint, color: C.ink, fontWeight: 700 }}>✓ Prêt</div>
            )}
          </div>
        </>
      )}

      {ready && (() => {
        // Routage : pour chaque jeu, on lance le composant online correspondant
        const gameProps = {
          room: currentRoom,
          profile,
          player1,
          player2,
          onUpdate: updateCurrent,
        };
        switch (currentRoom.game) {
          case 'morpion':  return <TicTacToeOnline {...gameProps} />;
          case 'connect4': return <Connect4Online  {...gameProps} />;
          case 'memory':   return <MemoryOnline    {...gameProps} />;
          case 'pendu':    return <PenduOnline     {...gameProps} />;
          case 'bataille': return <BatailleOnline  {...gameProps} />;
          case 'echecs':   return <EchecsOnline    {...gameProps} />;
          default:
            return (
              <div className="rounded-2xl p-4 text-center" style={{
                background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
              }}>
                <p className="text-sm mb-2" style={{ color: C.ink, fontWeight: 700 }}>
                  🎉 Les 2 joueurs sont là !
                </p>
                <p className="text-xs" style={{ color: C.inkLight, fontWeight: 600 }}>
                  Ce jeu n'est pas encore disponible en ligne. Bientôt !
                </p>
              </div>
            );
        }
      })()}
    </div>
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
// JEU 1 — TIC TAC TOE
// ============================================================
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkTicTacToeWinner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a,b,c] };
  }
  if (board.every(Boolean)) return { winner: 'draw', line: [] };
  return null;
}

// État initial d'une partie de Tic Tac Toe
function makeTicTacToeState() {
  return {
    board: Array(9).fill(null),  // 9 cases vides
    turn: 0,                      // 0 = J1 (❌), 1 = J2 (⭕)
    scores: [0, 0],               // scores des manches
  };
}

// ============================================================
// TIC TAC TOE — VERSION ONLINE
// ------------------------------------------------------------
// L'état du jeu est dans room.state sur Supabase.
// Quand je joue : on update room.state → Supabase notifie l'autre joueur.
// Quand l'autre joue : on reçoit l'update via le subscribe (déjà actif dans Lobby).
// ============================================================
function TicTacToeOnline({ room, profile, player1, player2, onUpdate }) {
  // Suis-je player 1 (hôte) ou player 2 (invité) ?
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const symbols = ['❌', '⭕'];
  const mySymbol = symbols[myIndex];
  const players = [player1, player2];

  // Si la partie vient juste de démarrer, room.state est vide → on l'initialise
  const state = (room.state && room.state.board) ? room.state : makeTicTacToeState();
  const { board, turn, scores } = state;

  const result = checkTicTacToeWinner(board);
  const isMyTurn = turn === myIndex && !result;

  // Quand JE joue un coup
  const playCell = async (i) => {
    if (!isMyTurn) return;        // pas mon tour, je ne fais rien
    if (board[i] || result) return; // case occupée ou jeu fini
    const newBoard = [...board];
    newBoard[i] = mySymbol;
    const newState = { ...state, board: newBoard, turn: 1 - turn };

    // Update local immédiat pour ressenti rapide
    onUpdate({ ...room, state: newState });
    // Envoi au serveur — l'autre joueur recevra via realtime
    await updateRoomState(room.id, { state: newState });
  };

  // Nouvelle manche : seul l'hôte peut la déclencher (pour éviter les conflits)
  const newRound = async () => {
    if (myIndex !== 0) return;  // seul J1 peut reset
    let newScores = scores;
    if (result?.winner && result.winner !== 'draw') {
      const winnerIdx = symbols.indexOf(result.winner);
      newScores = [...scores];
      newScores[winnerIdx] += 1;
    }
    const newState = { board: Array(9).fill(null), turn: 0, scores: newScores };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Bannière : qui joue / qui a gagné
  let banner;
  if (result?.winner === 'draw') banner = '🤝 Match nul !';
  else if (result?.winner) {
    const idx = symbols.indexOf(result.winner);
    banner = `🎉 ${players[idx]?.pseudo || 'Joueur'} gagne !`;
  } else if (isMyTurn) {
    banner = `✨ À toi de jouer (${mySymbol})`;
  } else {
    banner = `⏳ Au tour de ${players[1 - myIndex]?.pseudo || 'l\'autre joueur'}`;
  }

  return (
    <div>
      {/* Mini-scoreboard avec les 2 pseudos */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1].map((i) => {
          const isActive = turn === i && !result;
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-3 rounded-2xl text-center transition-all"
              style={{
                background: i === 0 ? C.pink : C.blue,
                outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
                transform: isActive ? 'translateY(-2px)' : 'none',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {symbols[i]} {players[i]?.pseudo || '...'} {isMe && '(toi)'}
              </div>
              <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                {scores[i]}
              </div>
            </div>
          );
        })}
      </div>

      <Banner text={banner} color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink} />

      <div className="grid grid-cols-3 gap-3 mb-4" style={{ aspectRatio: '1 / 1' }}>
        {board.map((cell, i) => {
          const inWin = result?.line.includes(i);
          return (
            <button key={i} onClick={() => playCell(i)}
              disabled={!isMyTurn || !!cell}
              className="rounded-2xl flex items-center justify-center text-5xl transition-all clic-press"
              style={{
                background: inWin ? '#FFE89E' : C.white,
                boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
                fontFamily: '"Fredoka", sans-serif',
                opacity: !isMyTurn && !cell ? 0.7 : 1,
              }}>{cell}</button>
          );
        })}
      </div>

      {result && (
        <>
          {myIndex === 0 ? (
            <KawaiiButton fullWidth onClick={newRound}>Nouvelle manche ↻</KawaiiButton>
          ) : (
            <div className="rounded-2xl p-3 text-center text-sm"
                 style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer la prochaine manche...
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TicTacToe({ onBack, pseudo }) {
  const [board, setBoard] = useState(Array(9).fill(null));
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [lastWinner, setLastWinner] = useState(null);
  const symbols = ['❌', '⭕'];
  const players = [pseudo, 'Invité'];          // J1 = utilisateur connecté, J2 = invité
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
  else if (result?.winner) {
    const idx = symbols.indexOf(result.winner);
    banner = `🎉 ${players[idx]} gagne !`;
  }
  else banner = `Au tour de ${players[turn]} (${symbols[turn]})`;

  return (
    <GameShell gameId="morpion" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={[`❌ ${players[0]}`, `⭕ ${players[1]}`]}
                  colors={[C.pink, C.blue]} current={result ? null : turn} />
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
// JEU 2 — PUISSANCE 4
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

// État initial pour Puissance 4 online
function makeConnect4State() {
  return { grid: makeC4Board(), turn: 0, scores: [0, 0] };
}

// ============================================================
// PUISSANCE 4 — VERSION ONLINE
// Même architecture que TicTacToeOnline : state stocké dans room.state.
// ============================================================
function Connect4Online({ room, profile, player1, player2, onUpdate }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const symbols = ['🔴', '🟡'];
  const colors = [C.pink, '#FFE89E'];
  const mySymbol = symbols[myIndex];
  const players = [player1, player2];

  const state = (room.state && room.state.grid) ? room.state : makeConnect4State();
  const { grid, turn, scores } = state;
  const result = checkConnect4Winner(grid);
  const isMyTurn = turn === myIndex && !result;

  // Lâcher un pion dans une colonne (il tombe en bas)
  const dropPiece = async (col) => {
    if (!isMyTurn || result) return;
    // Trouve la 1ère case vide en partant du bas
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (!grid[r][col]) {
        const newGrid = grid.map((row) => [...row]);
        newGrid[r][col] = mySymbol;
        const newState = { ...state, grid: newGrid, turn: 1 - turn };
        onUpdate({ ...room, state: newState });
        await updateRoomState(room.id, { state: newState });
        return;
      }
    }
    // Si on arrive ici : colonne pleine, on ignore
  };

  // Nouvelle manche : seul l'hôte peut la lancer
  const newRound = async () => {
    if (myIndex !== 0) return;
    let newScores = scores;
    if (result?.winner && result.winner !== 'draw') {
      const winnerIdx = symbols.indexOf(result.winner);
      newScores = [...scores];
      newScores[winnerIdx] += 1;
    }
    const newState = { grid: makeC4Board(), turn: 0, scores: newScores };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Texte de la bannière
  let banner;
  if (result?.winner === 'draw') banner = '🤝 Match nul !';
  else if (result?.winner) {
    const idx = symbols.indexOf(result.winner);
    banner = `🎉 ${players[idx]?.pseudo || 'Joueur'} gagne !`;
  } else if (isMyTurn) {
    banner = `✨ À toi de jouer (${mySymbol})`;
  } else {
    banner = `⏳ Au tour de ${players[1 - myIndex]?.pseudo || 'l\'autre joueur'}`;
  }

  const isWinning = (r, c) => result?.cells.some(([wr, wc]) => wr === r && wc === c);

  return (
    <div>
      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1].map((i) => {
          const isActive = turn === i && !result;
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-3 rounded-2xl text-center transition-all"
              style={{
                background: colors[i],
                outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
                transform: isActive ? 'translateY(-2px)' : 'none',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {symbols[i]} {players[i]?.pseudo || '...'} {isMe && '(toi)'}
              </div>
              <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                {scores[i]}
              </div>
            </div>
          );
        })}
      </div>

      <Banner text={banner} color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink} />

      {/* Grille Puissance 4 */}
      <div className="rounded-2xl p-2" style={{ background: C.blue, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        {grid.map((row, r) => (
          <div key={r} className="flex gap-1 mb-1">
            {row.map((cell, c) => (
              <button key={c} onClick={() => dropPiece(c)}
                disabled={!isMyTurn || !!cell}
                className="flex-1 rounded-full flex items-center justify-center transition-all clic-press"
                style={{
                  aspectRatio: '1 / 1',
                  background: isWinning(r, c) ? '#FFE89E' : C.cream,
                  fontSize: '1.4rem',
                  opacity: !isMyTurn && !cell ? 0.85 : 1,
                }}>{cell}</button>
            ))}
          </div>
        ))}
      </div>

      {result && (
        <div className="mt-4">
          {myIndex === 0 ? (
            <KawaiiButton fullWidth onClick={newRound}>Nouvelle manche ↻</KawaiiButton>
          ) : (
            <div className="rounded-2xl p-3 text-center text-sm"
                 style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer la prochaine manche...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Connect4({ onBack, pseudo }) {
  const [grid, setGrid] = useState(makeC4Board());
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [lastWinner, setLastWinner] = useState(null);
  const symbols = ['🔴', '🟡'];
  const players = [pseudo, 'Invité'];
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
  else if (result?.winner) {
    const idx = symbols.indexOf(result.winner);
    banner = `🎉 ${players[idx]} gagne !`;
  }
  else banner = `Au tour de ${players[turn]} (${symbols[turn]})`;
  const isWinning = (r, c) => result?.cells.some(([wr, wc]) => wr === r && wc === c);

  return (
    <GameShell gameId="connect4" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={[`🔴 ${players[0]}`, `🟡 ${players[1]}`]}
                  colors={[C.pink, '#FFE89E']} current={result ? null : turn} />
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
// JEU 3 — MEMORY
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

// État initial pour Memory online
function makeMemoryState() {
  return {
    deck: makeMemoryDeck(),
    flipped: [],     // indices des cartes retournées ce tour (0, 1 ou 2)
    turn: 0,
    scores: [0, 0],
    locked: false,   // true pendant que les 2 cartes sont visibles avant de juger
  };
}

// ============================================================
// MEMORY — VERSION ONLINE
// ------------------------------------------------------------
// Stratégie pour les timeouts :
// • Quand un joueur retourne la 2e carte, il passe le state à "locked: true"
//   et attend 600ms (paire) ou 1000ms (pas paire) avant l'update final.
// • L'autre joueur voit aussi les 2 cartes (synchro via realtime) mais ne
//   déclenche pas son propre timer — il attend passivement le 2e update.
// ============================================================
function MemoryOnline({ room, profile, player1, player2, onUpdate }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const players = [player1, player2];

  const state = (room.state && room.state.deck) ? room.state : makeMemoryState();
  const { deck, flipped, turn, scores, locked } = state;
  const allMatched = deck.every((c) => c.matched);
  const isMyTurn = turn === myIndex && !allMatched && !locked;

  // Quand JE clique sur une carte
  const clickCard = async (i) => {
    if (!isMyTurn || allMatched) return;
    if (deck[i].flipped || deck[i].matched) return;
    if (flipped.length >= 2) return;

    // Retourne la carte
    const newDeck = deck.map((c, idx) => idx === i ? { ...c, flipped: true } : c);
    const newFlipped = [...flipped, i];

    if (newFlipped.length < 2) {
      // 1ère carte : update simple
      const newState = { ...state, deck: newDeck, flipped: newFlipped };
      onUpdate({ ...room, state: newState });
      await updateRoomState(room.id, { state: newState });
    } else {
      // 2e carte : on update avec locked=true pour que personne ne joue,
      // puis après le délai on fait l'update final
      const [a, b] = newFlipped;
      const isMatch = newDeck[a].emoji === newDeck[b].emoji;
      const lockedState = { ...state, deck: newDeck, flipped: newFlipped, locked: true };
      onUpdate({ ...room, state: lockedState });
      await updateRoomState(room.id, { state: lockedState });

      // Délai puis update final
      setTimeout(async () => {
        let finalDeck, newScores = scores, newTurn = turn;
        if (isMatch) {
          finalDeck = newDeck.map((c, idx) =>
            idx === a || idx === b ? { ...c, matched: true } : c);
          newScores = [...scores];
          newScores[turn] += 1;
          // On garde la main quand on trouve une paire
        } else {
          finalDeck = newDeck.map((c, idx) =>
            idx === a || idx === b ? { ...c, flipped: false } : c);
          newTurn = 1 - turn;
        }
        const finalState = { deck: finalDeck, flipped: [], turn: newTurn, scores: newScores, locked: false };
        onUpdate({ ...room, state: finalState });
        await updateRoomState(room.id, { state: finalState });
      }, isMatch ? 600 : 1000);
    }
  };

  // Nouvelle partie (seul l'hôte)
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makeMemoryState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Bannière
  let banner;
  if (allMatched) {
    if (scores[0] > scores[1]) banner = `🎉 ${players[0]?.pseudo} gagne !`;
    else if (scores[1] > scores[0]) banner = `🎉 ${players[1]?.pseudo} gagne !`;
    else banner = '🤝 Égalité !';
  } else if (locked) {
    banner = '⏱️ Vérification...';
  } else if (isMyTurn) {
    banner = `✨ À toi de jouer`;
  } else {
    banner = `⏳ Au tour de ${players[1 - myIndex]?.pseudo || 'l\'autre joueur'}`;
  }

  return (
    <div>
      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1].map((i) => {
          const isActive = turn === i && !allMatched;
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-3 rounded-2xl text-center transition-all"
              style={{
                background: i === 0 ? C.pink : C.blue,
                outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
                transform: isActive ? 'translateY(-2px)' : 'none',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {players[i]?.pseudo || '...'} {isMe && '(toi)'}
              </div>
              <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                {scores[i]}
              </div>
            </div>
          );
        })}
      </div>

      <Banner text={banner} color={allMatched ? '#6BCB77' : C.accentPink} />

      {/* Grille de cartes */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {deck.map((card, i) => (
          <button key={card.id} onClick={() => clickCard(i)}
            disabled={!isMyTurn || card.flipped || card.matched}
            className="rounded-2xl flex items-center justify-center transition-all clic-press"
            style={{
              aspectRatio: '1 / 1',
              background: card.matched ? C.mint : card.flipped ? C.white : C.lavender,
              boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
              fontSize: '2rem',
              opacity: card.matched ? 0.6 : 1,
            }}>
            {card.flipped || card.matched ? card.emoji : '✦'}
          </button>
        ))}
      </div>

      {allMatched && (
        <>
          {myIndex === 0 ? (
            <KawaiiButton fullWidth onClick={newGame}>Rejouer ↻</KawaiiButton>
          ) : (
            <div className="rounded-2xl p-3 text-center text-sm"
                 style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer la prochaine partie...
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Memory({ onBack, pseudo }) {
  const [deck, setDeck] = useState(makeMemoryDeck);
  const [flipped, setFlipped] = useState([]);
  const [turn, setTurn] = useState(0);
  const [scores, setScores] = useState([0, 0]);
  const [locked, setLocked] = useState(false);
  const allMatched = deck.every((c) => c.matched);
  const players = [pseudo, 'Invité'];

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
    if (scores[0] > scores[1]) banner = `🎉 ${players[0]} gagne !`;
    else if (scores[1] > scores[0]) banner = `🎉 ${players[1]} gagne !`;
    else banner = '🤝 Égalité !';
  } else banner = `Au tour de ${players[turn]}`;

  return (
    <GameShell gameId="memory" onBack={onBack} onReset={fullReset}>
      <Scoreboard scores={scores} names={players} colors={[C.pink, C.blue]} current={allMatched ? null : turn} />
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
// JEU 4 — BATAILLE NAVALE
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

// Crée un état initial pour Bataille Navale online
// Les 2 grilles de bateaux sont générées une fois pour toutes au démarrage.
function makeBatailleState() {
  const emptyShots = () => Array.from({ length: BN_ROWS }, () => Array(BN_COLS).fill(null));
  return {
    ships: [placeShipsRandomly(), placeShipsRandomly()],   // bateaux des 2 joueurs
    shots: [emptyShots(), emptyShots()],                   // tirs effectués par chaque joueur
    turn: 0,                                                // qui doit tirer
    winner: null,                                           // 0 ou 1 quand fini
  };
}

// ============================================================
// BATAILLE NAVALE — VERSION ONLINE
// ------------------------------------------------------------
// Chaque joueur voit :
//   • Sa propre grille avec ses bateaux + les tirs reçus
//   • La grille adverse SANS les bateaux (juste avec ses tirs : 💧 raté / 🔥 touché)
// L'état complet est dans Supabase. On stocke aussi les bateaux des deux,
// mais le front n'affiche que ce qui doit être visible pour chaque joueur.
// ============================================================
function BatailleOnline({ room, profile, player1, player2, onUpdate }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const opponent = 1 - myIndex;
  const players = [player1, player2];

  const state = (room.state && room.state.ships) ? room.state : makeBatailleState();
  const { ships, shots, turn, winner } = state;
  const totalShipCells = countShipCells(ships[0]);
  const isMyTurn = turn === myIndex && winner === null;

  // Tirer sur une case de la grille adverse
  const fire = async (r, c) => {
    if (!isMyTurn) return;
    if (shots[myIndex][r][c] !== null) return;  // déjà tiré là

    const isHit = ships[opponent][r][c];
    // Copie profonde des shots pour ne pas muter
    const newShots = shots.map((g) => g.map((row) => [...row]));
    newShots[myIndex][r][c] = isHit ? 'hit' : 'miss';

    // Compte les hits → victoire ?
    let hits = 0;
    newShots[myIndex].forEach((row) => row.forEach((v) => { if (v === 'hit') hits++; }));
    const newWinner = hits >= totalShipCells ? myIndex : null;

    const newState = {
      ...state,
      shots: newShots,
      turn: newWinner !== null ? turn : 1 - turn,  // si gagné, le tour ne change plus
      winner: newWinner,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Rejouer (seul l'hôte)
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makeBatailleState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN DE VICTOIRE ===
  if (winner !== null) {
    const isMyWin = winner === myIndex;
    return (
      <div className="rounded-3xl p-8 text-center" style={{
        background: isMyWin ? C.mint : C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3"><span className="clic-celebrate">{isMyWin ? '🎉' : '😢'}</span></div>
        <h3 className="text-3xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {players[winner]?.pseudo || 'Joueur'} gagne !
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          Tous les bateaux sont coulés 🚢💥
        </p>
        <div className="mt-5">
          {myIndex === 0 ? (
            <KawaiiButton fullWidth onClick={newGame}>Rejouer ↻</KawaiiButton>
          ) : (
            <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer une nouvelle partie...
            </div>
          )}
        </div>
      </div>
    );
  }

  // === ÉCRAN DE JEU ===
  // Mes données
  const myShips = ships[myIndex];           // mes bateaux
  const myShotsReceived = shots[opponent];  // les tirs que l'adversaire m'a envoyés
  const myShotsSent = shots[myIndex];       // mes tirs envoyés

  return (
    <div>
      <Banner text={
        isMyTurn
          ? `🎯 À toi de tirer !`
          : `⏳ ${players[opponent]?.pseudo || 'L\'autre joueur'} vise...`
      } color={isMyTurn ? C.accentPink : C.inkSoft} />

      {/* Grille ADVERSE — on tire ici */}
      <div className="mb-4">
        <div className="text-xs mb-2 text-center" style={{ color: C.ink, fontWeight: 700 }}>
          🎯 GRILLE DE {(players[opponent]?.pseudo || 'L\'ADVERSAIRE').toUpperCase()}
        </div>
        <div className="rounded-2xl p-2 grid grid-cols-6 gap-1"
             style={{ background: C.blue, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          {Array.from({ length: BN_ROWS * BN_COLS }).map((_, idx) => {
            const r = Math.floor(idx / BN_COLS);
            const c = idx % BN_COLS;
            const shot = myShotsSent[r][c];
            return (
              <button key={idx} onClick={() => fire(r, c)}
                disabled={!isMyTurn || shot !== null}
                className="rounded-lg flex items-center justify-center clic-press"
                style={{
                  aspectRatio: '1 / 1',
                  background: shot === 'hit' ? '#FFD4B8' : shot === 'miss' ? C.cream : C.white,
                  fontSize: '1.4rem',
                  opacity: !isMyTurn && !shot ? 0.85 : 1,
                }}>
                {shot === 'hit' ? '🔥' : shot === 'miss' ? '💧' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ma grille à MOI — pour voir où sont mes bateaux + les tirs reçus */}
      <div className="mb-4">
        <div className="text-xs mb-2 text-center" style={{ color: C.ink, fontWeight: 700 }}>
          🚢 TA FLOTTE
        </div>
        <div className="rounded-2xl p-2 grid grid-cols-6 gap-1"
             style={{ background: C.mint, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          {Array.from({ length: BN_ROWS * BN_COLS }).map((_, idx) => {
            const r = Math.floor(idx / BN_COLS);
            const c = idx % BN_COLS;
            const hasShip = myShips[r][c];
            const shot = myShotsReceived[r][c];
            let content = '';
            if (shot === 'hit') content = '🔥';
            else if (shot === 'miss') content = '💧';
            else if (hasShip) content = '🚢';
            return (
              <div key={idx}
                className="rounded-lg flex items-center justify-center"
                style={{
                  aspectRatio: '1 / 1',
                  background: shot === 'hit' ? '#FFD4B8'
                            : shot === 'miss' ? C.cream
                            : hasShip ? C.lavender
                            : C.white,
                  fontSize: '1.2rem',
                }}>{content}</div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// JEU 6 — ÉCHECS (online uniquement)
// ============================================================
// FEN = "Forsyth-Edwards Notation" — c'est un string qui décrit l'état
// complet d'une partie d'échecs en une ligne.
// Exemple de la position de départ :
//   "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
// On stocke juste ce string dans Supabase, et chess.js fait tout le reste.
const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makeEchecsState() {
  return {
    fen: STARTING_FEN,
    lastMove: null,        // { from, to } pour surligner le dernier coup
    winner: null,          // 0 (blancs) | 1 (noirs) | 'draw'
    reason: null,          // 'checkmate' | 'stalemate' | 'draw' | 'resign'
  };
}

// ============================================================
// ÉCHECS ONLINE — composant principal
// ============================================================
function EchecsOnline({ room, profile, player1, player2, onUpdate }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const myColor = myIndex === 0 ? 'w' : 'b';     // J1 = blancs, J2 = noirs
  const players = [player1, player2];

  // État stocké dans Supabase
  const state = (room.state && room.state.fen) ? room.state : makeEchecsState();
  const { fen, lastMove, winner, reason } = state;

  // On reconstruit l'objet Chess à partir du FEN à chaque rendu
  // (useMemo pour éviter de le refaire si rien n'a changé)
  const game = useMemo(() => {
    const g = new Chess();
    try { g.load(fen); } catch (e) { /* fen invalide, on garde la position de départ */ }
    return g;
  }, [fen]);

  // Hook local : case sélectionnée (pour afficher les coups légaux)
  const [selectedSquare, setSelectedSquare] = useState(null);

  // À qui c'est de jouer ? (selon chess.js)
  const turnColor = game.turn();              // 'w' ou 'b'
  const isMyTurn = turnColor === myColor && !winner;

  // === FONCTION : effectuer un coup ===
  const makeMove = async (from, to) => {
    if (!isMyTurn) return false;
    // On copie le jeu pour tester avant d'envoyer
    const test = new Chess(fen);
    let move;
    try {
      move = test.move({ from, to, promotion: 'q' });  // promotion auto en dame
    } catch (e) {
      return false;  // coup illégal
    }
    if (!move) return false;

    // Détecte la fin de partie
    let newWinner = null, newReason = null;
    if (test.isCheckmate()) {
      newWinner = myIndex;          // celui qui a fait le mat gagne
      newReason = 'checkmate';
    } else if (test.isStalemate()) {
      newWinner = 'draw';
      newReason = 'stalemate';
    } else if (test.isDraw()) {
      newWinner = 'draw';
      newReason = 'draw';
    }

    const newState = {
      fen: test.fen(),
      lastMove: { from, to },
      winner: newWinner,
      reason: newReason,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
    setSelectedSquare(null);
    return true;
  };

  // === HANDLERS pour react-chessboard ===
  // Quand on lâche une pièce après drag-and-drop
  const onDrop = (sourceSquare, targetSquare) => {
    return makeMove(sourceSquare, targetSquare);
  };

  // Quand on tape sur une case (sans drag) → sélection + coups légaux
  const onSquareClick = (square) => {
    if (!isMyTurn) return;
    if (selectedSquare && selectedSquare !== square) {
      // 2e clic : on essaie de jouer ce coup
      const moved = makeMove(selectedSquare, square);
      if (moved) return;
    }
    // Sinon, on sélectionne la case si elle a une pièce à nous
    const piece = game.get(square);
    if (piece && piece.color === myColor) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  // === NOUVELLE PARTIE (seul l'hôte) ===
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makeEchecsState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
    setSelectedSquare(null);
  };

  // === Calculer les coups légaux pour surligner les cases ===
  const legalMoves = selectedSquare
    ? game.moves({ square: selectedSquare, verbose: true })
    : [];
  const customSquareStyles = {};

  // Case sélectionnée : surlignée en jaune
  if (selectedSquare) {
    customSquareStyles[selectedSquare] = { background: 'rgba(255,232,158,0.85)' };
  }
  // Coups légaux : petit point vert
  legalMoves.forEach((m) => {
    const isCapture = !!game.get(m.to);
    customSquareStyles[m.to] = {
      background: isCapture
        ? 'radial-gradient(circle, transparent 55%, rgba(255,143,177,0.6) 55%)'  // capture = anneau rose
        : 'radial-gradient(circle, rgba(184,230,217,0.95) 18%, transparent 22%)', // case vide = point vert
    };
  });
  // Dernier coup joué : surligné en bleu pâle
  if (lastMove) {
    if (!customSquareStyles[lastMove.from])
      customSquareStyles[lastMove.from] = { background: 'rgba(197,221,245,0.7)' };
    if (!customSquareStyles[lastMove.to])
      customSquareStyles[lastMove.to] = { background: 'rgba(197,221,245,0.7)' };
  }
  // Roi en échec : surligné en rouge
  if (game.isCheck() && !winner) {
    // Trouve la case du roi de la couleur qui doit jouer
    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type === 'k' && piece.color === turnColor) {
          const file = 'abcdefgh'[c];
          const rank = 8 - r;
          customSquareStyles[`${file}${rank}`] = { background: 'rgba(255,143,177,0.7)' };
        }
      }
    }
  }

  // === ÉCRAN DE FIN ===
  if (winner !== null) {
    const isDraw = winner === 'draw';
    const isMyWin = winner === myIndex;
    const reasonText = {
      checkmate: 'Échec et mat ⚔️',
      stalemate: 'Pat — aucun coup possible ⚖️',
      draw: 'Partie nulle ⚖️',
    }[reason] || 'Partie terminée';
    return (
      <div>
        <div className="rounded-3xl p-6 text-center mb-3" style={{
          background: isDraw ? C.lavender : (isMyWin ? C.mint : C.pink),
          boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
        }}>
          <div className="text-6xl mb-3">
            <span className="clic-celebrate">{isDraw ? '🤝' : (isMyWin ? '🎉' : '😢')}</span>
          </div>
          <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {isDraw ? 'Match nul !' : `${players[winner]?.pseudo || 'Joueur'} gagne !`}
          </h3>
          <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>{reasonText}</p>
        </div>

        {/* Plateau final figé pour relire la position */}
        <div className="rounded-2xl overflow-hidden mb-4" style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          <Chessboard
            position={fen}
            boardOrientation={myColor === 'w' ? 'white' : 'black'}
            arePiecesDraggable={false}
            customDarkSquareStyle={{ backgroundColor: '#DCC5F7' }}
            customLightSquareStyle={{ backgroundColor: '#FFF9F5' }}
          />
        </div>

        {myIndex === 0 ? (
          <KawaiiButton fullWidth onClick={newGame}>Nouvelle partie ↻</KawaiiButton>
        ) : (
          <div className="rounded-2xl p-3 text-center text-sm"
               style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer une nouvelle partie...
          </div>
        )}
      </div>
    );
  }

  // === BANDEAU INFO ===
  let banner;
  if (game.isCheck()) {
    banner = isMyTurn
      ? `⚠️ Échec ! Tu dois sauver ton roi`
      : `⚠️ Échec à ${players[1 - myIndex]?.pseudo || 'l\'adversaire'}`;
  } else if (isMyTurn) {
    banner = `✨ À toi de jouer (${myColor === 'w' ? 'blancs ⚪' : 'noirs ⚫'})`;
  } else {
    banner = `⏳ ${players[1 - myIndex]?.pseudo || 'L\'autre joueur'} réfléchit...`;
  }

  return (
    <div>
      {/* Mini scoreboard avec couleurs des 2 joueurs */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {[0, 1].map((i) => {
          const isActive = (i === 0 ? 'w' : 'b') === turnColor && !winner;
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-2 rounded-2xl text-center transition-all"
              style={{
                background: i === 0 ? C.cream : C.lavender,
                outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
                transform: isActive ? 'translateY(-2px)' : 'none',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {i === 0 ? '⚪ Blancs' : '⚫ Noirs'}
              </div>
              <div className="text-sm" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                {players[i]?.pseudo || '...'} {isMe && '(toi)'}
              </div>
            </div>
          );
        })}
      </div>

      <Banner text={banner} color={game.isCheck() ? '#FF8FB1' : C.accentPink} />

      {/* L'échiquier ! */}
      <div className="rounded-2xl overflow-hidden mb-3"
           style={{ boxShadow: '0 4px 0 rgba(0,0,0,0.08)', background: C.white, padding: '4px' }}>
        <Chessboard
          position={fen}
          onPieceDrop={onDrop}
          onSquareClick={onSquareClick}
          boardOrientation={myColor === 'w' ? 'white' : 'black'}
          arePiecesDraggable={isMyTurn}
          customDarkSquareStyle={{ backgroundColor: '#DCC5F7' }}
          customLightSquareStyle={{ backgroundColor: '#FFF9F5' }}
          customSquareStyles={customSquareStyles}
        />
      </div>

      {/* Légende discrète */}
      <div className="rounded-2xl p-3 text-xs text-center"
           style={{ background: 'rgba(255,255,255,0.7)', color: C.inkLight, fontWeight: 600 }}>
        💡 Touche une pièce pour voir ses coups possibles
      </div>
    </div>
  );
}

function BatailleNavale({ onBack, pseudo }) {
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
  const players = [pseudo, 'Invité'];

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
            {players[winner]} gagne !
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
            Passe l'appareil à {players[turn]}
          </h3>
          <p className="mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>Quand tu es prêt, clique pour commencer ton tour.</p>
          <KawaiiButton fullWidth onClick={startTurn}>Je suis {players[turn]} ✨</KawaiiButton>
        </div>
      </GameShell>
    );
  }

  const myShots = shots[turn]; const myShips = ships[turn]; const opponentShots = shots[1 - turn];

  return (
    <GameShell gameId="bataille" onBack={onBack} onReset={fullReset}>
      <Banner text={
        phase === 'end-turn' ? (lastHit === 'hit' ? '🔥 Touché !' : '💧 À l\'eau...')
                             : `🎯 Tir de ${players[turn]}`
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
// JEU 5 — PENDU
// ============================================================
const PENDU_MAX_WRONG = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Strip accents : "Été" → "ETE"
const penduStripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const penduNorm = (s) => penduStripAccents(s).toUpperCase();

// État initial du Pendu online
// phase: 'word-entry' (J1 saisit) | 'guessing' (J2 devine) | 'win' | 'lose'
function makePenduState() {
  return {
    phase: 'word-entry',
    word: '',         // mot avec accents (pour affichage final)
    guessed: [],      // lettres déjà tentées
  };
}

// ============================================================
// PENDU — VERSION ONLINE
// ------------------------------------------------------------
// Asymétrie : J1 (hôte) écrit le mot, J2 devine.
// • J1 voit l'écran de saisie au début, puis attend pendant que J2 devine.
// • J2 voit "En attente du mot" au début, puis l'écran de devinette.
// • Le mot est dans state.word — techniquement visible si on ouvre la
//   console, mais OK pour un jeu d'enfants.
// ============================================================
function PenduOnline({ room, profile, player1, player2, onUpdate }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makePenduState();
  const { phase, word, guessed } = state;

  // Hooks d'UI locaux (saisie du mot)
  const [wordInput, setWordInput] = useState('');
  const [showWord, setShowWord] = useState(false);

  // Calculs dérivés
  const normWord = penduNorm(word);
  const wrongLetters = guessed.filter((L) => !normWord.includes(L));
  const wrongCount = wrongLetters.length;

  // Validation : J1 envoie son mot à Supabase et passe en phase 'guessing'
  const submitWord = async () => {
    const clean = wordInput.replace(/[^a-zA-ZÀ-ÿ\s-]/g, '').trim();
    if (clean.length < 2) return;
    const newState = { phase: 'guessing', word: clean, guessed: [] };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // J2 propose une lettre
  const guessLetter = async (L) => {
    if (phase !== 'guessing' || guessed.includes(L)) return;
    if (myIndex !== 1) return;  // seul J2 peut deviner

    const newGuessed = [...guessed, L];
    const newWrong = newGuessed.filter((g) => !normWord.includes(g)).length;
    const lettersNorm = normWord.split('');
    const allFound = lettersNorm.every((c) => c === ' ' || c === '-' || newGuessed.includes(c));

    let newPhase = 'guessing';
    if (allFound) newPhase = 'win';
    else if (newWrong >= PENDU_MAX_WRONG) newPhase = 'lose';

    const newState = { ...state, guessed: newGuessed, phase: newPhase };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Rejouer : seul J1 peut relancer (et il devient celui qui écrit le mot)
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makePenduState();
    setWordInput('');
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : J1 saisit le mot ===
  if (phase === 'word-entry' && isHost) {
    return (
      <div className="rounded-3xl p-6 text-center" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">✏️</div>
        <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Écris le mot
        </h3>
        <p className="mb-5 text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[1]?.pseudo || 'Ton ami'} doit le deviner !
        </p>
        <div className="relative mb-3">
          <input type={showWord ? 'text' : 'password'} value={wordInput}
            onChange={(e) => setWordInput(e.target.value)}
            placeholder="Mot secret..."
            className="w-full p-4 rounded-2xl text-lg pr-14 outline-none"
            style={{ background: C.white, color: C.ink, fontWeight: 600,
                     boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)' }} />
          <button onClick={() => setShowWord((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl" type="button">
            {showWord ? '🙈' : '👁️'}
          </button>
        </div>
        <KawaiiButton fullWidth onClick={submitWord}>Valider le mot ✨</KawaiiButton>
      </div>
    );
  }

  // === ÉCRAN 1 bis : J2 attend que J1 écrive ===
  if (phase === 'word-entry' && !isHost) {
    return (
      <div className="rounded-3xl p-8 text-center" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[0]?.pseudo || 'L\'hôte'} est en train d'écrire le mot secret.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : victoire ou défaite ===
  if (phase === 'win' || phase === 'lose') {
    const isWin = phase === 'win';
    // Qui a gagné ? J2 si trouvé, J1 si J2 a échoué
    const winnerPseudo = isWin ? (players[1]?.pseudo || 'Le devineur') : (players[0]?.pseudo || 'L\'hôte');
    return (
      <div className="rounded-3xl p-8 text-center" style={{
        background: isWin ? C.mint : C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">{isWin ? <span className="clic-celebrate">🎉</span> : '😢'}</div>
        <h3 className="text-3xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {winnerPseudo} gagne !
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          Le mot était : <span style={{ color: C.ink, fontWeight: 700 }}>{word.toUpperCase()}</span>
        </p>
        <div className="mt-5">
          {isHost ? (
            <KawaiiButton fullWidth onClick={newGame}>Rejouer ↻</KawaiiButton>
          ) : (
            <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va lancer une nouvelle partie...
            </div>
          )}
        </div>
      </div>
    );
  }

  // === ÉCRAN 3 : phase de devinette ===
  const letters = word.toUpperCase().split('');
  const lettersNorm = normWord.split('');
  const display = letters.map((L, i) => {
    if (L === ' ') return ' ';
    if (L === '-') return '-';
    return guessed.includes(lettersNorm[i]) ? L : '_';
  }).join(' ');
  const isMyTurn = !isHost;  // seul J2 (devineur) joue

  return (
    <div>
      <Banner text={
        isHost
          ? `🔍 ${players[1]?.pseudo || 'Le devineur'} cherche...`
          : `❤️ ${PENDU_MAX_WRONG - wrongCount} vies restantes`
      } color={wrongCount >= 4 ? '#FF8FB1' : C.accentPink} />

      <div className="rounded-3xl p-4 mb-4 flex items-center justify-center"
           style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <Hangman wrongCount={wrongCount} />
      </div>

      <div className="rounded-2xl p-5 mb-4 text-center"
           style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-3xl tracking-widest"
             style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {/* Pour J1 : on affiche le mot complet (il le connait déjà) */}
          {/* Pour J2 : on affiche le masque avec les lettres trouvées */}
          {isHost ? word.toUpperCase() : display}
        </div>
        {isHost && (
          <div className="text-xs mt-2" style={{ color: C.inkSoft, fontWeight: 600 }}>
            (tu vois le mot, l'autre voit : {display})
          </div>
        )}
      </div>

      <div className="rounded-2xl p-3 mb-4" style={{ background: 'rgba(255,255,255,0.7)' }}>
        <div className="grid grid-cols-7 gap-1">
          {ALPHABET.map((L) => {
            const used = guessed.includes(L);
            const wrong = used && !normWord.includes(L);
            const right = used && normWord.includes(L);
            return (
              <button key={L} onClick={() => guessLetter(L)}
                disabled={used || !isMyTurn}
                className="rounded-lg flex items-center justify-center text-sm clic-press"
                style={{
                  aspectRatio: '1 / 1',
                  background: right ? C.mint : wrong ? C.pink : C.white,
                  color: C.ink, fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                  boxShadow: used ? 'none' : '0 2px 0 rgba(0,0,0,0.06)',
                  opacity: used ? 0.6 : (isMyTurn ? 1 : 0.7),
                }}>{L}</button>
            );
          })}
        </div>
      </div>

      {wrongLetters.length > 0 && (
        <div className="text-center text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
          ❌ Erreurs : {wrongLetters.join(' ')}
        </div>
      )}
    </div>
  );
}

function Pendu({ onBack, pseudo }) {
  const [phase, setPhase] = useState('word-entry');
  const [word, setWord] = useState('');           // affichage avec accents
  const [wordInput, setWordInput] = useState('');
  const [showWord, setShowWord] = useState(false);
  const [guessed, setGuessed] = useState([]);
  const players = [pseudo, 'Invité'];  // J1 = celui qui écrit le mot, J2 = celui qui devine

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
            {players[0]}, écris le mot
          </h3>
          <p className="mb-5 text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>Cache ton écran pour que {players[1]} ne voie pas !</p>
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
            {isWin ? `${players[1]} gagne !` : `${players[0]} gagne !`}
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
