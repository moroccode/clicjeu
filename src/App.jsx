import React, { useState, useEffect, useMemo, useRef } from 'react';
import { signup as sbSignup, login as sbLogin, logout as sbLogout,
         getProfile, saveAvatar as sbSaveAvatar, supabase } from './supabase';
import { createRoom, joinRoom, subscribeToRoom, getProfilesByIds, updateRoomState,
         listIncomingInvitations, subscribeToInvitations, cancelInvitation,
         updateRoomInvite, dismissInvitation, cleanupStaleWaitingRooms,
         restoreActiveRoom } from './rooms';
import { searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
         removeFriend, listFriends, listPendingRequests, listSentRequests, syncFriendships } from './friends';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { tap, playSound, vibrate, launchConfetti,
         isSoundOn, setSoundOn, isVibrationOn, setVibrationOn } from './effects';
import { startPresence, stopPresence, subscribePresence, setBusy } from './presence';
import WORDS_JSON from './words.json';

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
  ACTIVE_ROOM: 'cj_active_room_id',  // id de la room où on était quand l'onglet a été tué
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
      @keyframes cj-thinking-dot {
        0%, 100% { opacity: 0.3; transform: translateY(0); }
        50%      { opacity: 1;   transform: translateY(-3px); }
      }
      .clic-fade-in     { animation: clic-fade-in 0.35s ease-out; }
      .clic-pop         { animation: clic-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .clic-celebrate   { animation: clic-celebrate 0.8s ease-in-out infinite; display: inline-block; }
      .clic-shake       { animation: clic-shake 0.4s ease-in-out; }
      .clic-press:active{ transform: scale(0.95); transition: transform 0.05s; }
      .cj-thinking      { display: inline-flex; gap: 2px; }
      .cj-thinking span { display: inline-block; animation: cj-thinking-dot 1s ease-in-out infinite; }
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
// Flag global : true uniquement quand l'utilisateur a CLIQUÉ sur "Se déconnecter".
// Sert à ignorer les événements SIGNED_OUT qui viennent du SDK Supabase lui-même
// (refresh token raté pendant un changement d'onglet, websocket qui se reconnecte
// avec un JWT expiré, etc.). Sans ça, ces faux SIGNED_OUT déloguaient l'utilisateur
// dès qu'il revenait sur l'app après avoir consulté WhatsApp.
let userInitiatedLogout = false;

// === DEBUG LOG (no-op par défaut) ===
// Helper de logs, désactivé en production. Pour réactiver le diagnostic à
// l'écran : remettre CJ_DEBUG=true et restaurer CjDebugPanel (cf historique git).
const CJ_DEBUG = false;
function cjLog(msg) {
  if (!CJ_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log('[CJ]', new Date().toLocaleTimeString(), msg);
}

// ============================================================
// HOOK : useFriendOnlineNotifier
// Notifie quand un AMI passe en ligne (et seulement un ami, pas tout
// le monde en ligne sur ClicJeu). Règles :
//  - Ignore le sync initial (sinon on notifie pour tous les amis déjà connectés)
//  - Ne re-notifie pas un même ami plus d'1 fois par 5 min (filtre les
//    refresh d'onglet)
//  - Joue un son "pop" léger sans vibration
// ============================================================
function useFriendOnlineNotifier(profile) {
  const onlineIds = usePresence();
  const friendIdsRef = useRef(new Set());
  const lastNotifiedRef = useRef(new Map());  // friendId → timestamp
  const prevOnlineRef = useRef(null);  // null = sync initial pas encore reçu

  // Charge la liste d'amis et l'actualise à intervalle régulier
  // (on ne s'abonne pas en realtime aux changements de friendships pour
  // garder ça simple — un nouveau ami sera détecté au prochain refresh)
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    const loadFriends = async () => {
      const list = await listFriends();
      if (!cancelled) {
        friendIdsRef.current = new Set(list.map((f) => f.id));
      }
    };
    loadFriends();
    const interval = setInterval(loadFriends, 60_000);  // rafraîchit chaque minute
    return () => { cancelled = true; clearInterval(interval); };
  }, [profile?.id]);

  // Surveille les changements de présence
  useEffect(() => {
    if (!profile?.id) return;

    // Premier appel → on enregistre l'état initial sans notifier (sinon
    // l'utilisateur reçoit 10 notifs au démarrage pour tous les amis déjà
    // connectés)
    if (prevOnlineRef.current === null) {
      prevOnlineRef.current = new Set(onlineIds);
      return;
    }

    const prev = prevOnlineRef.current;
    const now = Date.now();
    const FIVE_MIN = 5 * 60_000;

    // Pour chaque ID actuellement en ligne qui ne l'était pas avant
    for (const id of onlineIds) {
      if (prev.has(id)) continue;
      if (id === profile.id) continue;  // pas de notif pour moi-même
      if (!friendIdsRef.current.has(id)) continue;  // pas un ami → on ignore

      // Filtre 5 min : si on a déjà notifié récemment, on saute (refresh d'onglet)
      const lastTs = lastNotifiedRef.current.get(id) || 0;
      if (now - lastTs < FIVE_MIN) continue;
      lastNotifiedRef.current.set(id, now);

      // On récupère le pseudo et on notifie
      (async () => {
        try {
          const { data: p } = await supabase
            .from('profiles').select('pseudo').eq('id', id).maybeSingle();
          if (p?.pseudo) {
            playSound('pop');
            toastEmit({ kind: 'friend-online', pseudo: p.pseudo });
          }
        } catch { /* ignore */ }
      })();
    }

    prevOnlineRef.current = new Set(onlineIds);
  }, [onlineIds, profile?.id]);
}

// ============================================================
// GLOBAL TOASTS — bus d'événements pour afficher des notifs
// par-dessus n'importe quel écran (en jeu, dans le lobby, en home).
// ============================================================
//   toastEmit({ kind: 'invite', from: profile, room, ... })
//   toastEmit({ kind: 'friend-online', pseudo: 'Sami' })
//   toastEmit({ kind: 'info', message: '...' })
// Le composant <GlobalToastHost/> rendu dans App les affiche en pile.
const toastListeners = new Set();
let toastSeq = 0;
function toastEmit(toast) {
  const item = { ...toast, id: ++toastSeq };
  toastListeners.forEach((fn) => fn(item));
}

function GlobalToastHost({ onAcceptInvite, hasActiveRoom }) {
  const [toasts, setToasts] = useState([]);  // queue de toasts visibles

  useEffect(() => {
    const handler = (toast) => {
      // 1 seul toast à la fois pour ne pas surcharger l'écran d'un enfant.
      // Si déjà un toast affiché, on remplace par le nouveau (le récent prime).
      setToasts([toast]);
      // Auto-dismiss après 4s sauf pour les invitations (l'utilisateur doit
      // explicitement accepter ou ignorer)
      if (toast.kind !== 'invite') {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toast.id));
        }, toast.kind === 'friend-online' ? 3000 : 4000);
      }
    };
    toastListeners.add(handler);
    return () => { toastListeners.delete(handler); };
  }, []);

  const dismiss = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', top: 12, left: 0, right: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 8, padding: '0 12px', zIndex: 9997, pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <GlobalToastCard key={t.id} toast={t}
          onAcceptInvite={onAcceptInvite}
          hasActiveRoom={hasActiveRoom}
          onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function GlobalToastCard({ toast, onAcceptInvite, hasActiveRoom, onDismiss }) {
  const isInvite = toast.kind === 'invite';
  const isFriendOnline = toast.kind === 'friend-online';

  // Pour les invitations, on demande confirmation si l'utilisateur est déjà
  // dans une room (on ne peut pas être à 2 endroits à la fois)
  const handleAccept = () => {
    tap();
    if (hasActiveRoom) {
      const ok = window.confirm(`Quitter la partie en cours pour rejoindre ${toast.fromPseudo || 'ton ami'} ?`);
      if (!ok) return;
    }
    onAcceptInvite(toast.room);
    onDismiss();
  };

  return (
    <div className="clic-fade-in" style={{
      pointerEvents: 'auto',
      background: C.white,
      borderRadius: 18,
      boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
      padding: '12px 14px',
      width: '100%', maxWidth: 380,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {isInvite ? (
        <>
          <div className="text-3xl">🎮</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
              INVITATION
            </div>
            <div className="text-sm truncate"
                 style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              {toast.fromPseudo || 'Un ami'} t'invite à {toast.gameTitle || 'jouer'}
            </div>
          </div>
          <button onClick={onDismiss}
            className="text-xs px-2 py-1 rounded-full clic-press"
            style={{ background: C.cream, color: C.inkSoft, fontWeight: 700 }}>
            ✕
          </button>
          <button onClick={handleAccept}
            className="text-sm px-3 py-2 rounded-full clic-press"
            style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                     fontFamily: '"Fredoka", sans-serif' }}>
            Jouer →
          </button>
        </>
      ) : isFriendOnline ? (
        <>
          <div className="text-2xl">🟢</div>
          <div className="flex-1 min-w-0 text-sm"
               style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {toast.pseudo} est en ligne
          </div>
        </>
      ) : (
        <div className="flex-1 text-sm"
             style={{ color: C.ink, fontWeight: 600 }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function App() {
  useGoogleFonts();

  const [profile, setProfile]     = useState(null);   // { pseudo, avatar, id, ... } ou null
  const [loading, setLoading]     = useState(true);   // true tant qu'on n'a pas vérifié la session

  // Helper : log + setProfile(null), pour qu'on voie qui appelle ça et pourquoi
  const clearProfile = (why) => {
    cjLog(`🚪 LOGOUT triggered by: ${why}`);
    setProfile(null);
    setLoading(false);
  };

  // Au tout 1er rendu : on lit ?ref=PSEUDO dans l'URL et on le stocke
  // pour le retrouver après inscription. On nettoie aussi l'URL.
  useEffect(() => {
    cjLog('🚀 App mount');
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
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      cjLog(`init: session=${session ? 'YES' : 'NO'}`);

      if (!session) {
        if (mounted) setLoading(false);
        return;
      }

      // Premier essai
      const tryGetProfile = async () => {
        try {
          return await Promise.race([
            getProfile(),
            new Promise((res) => setTimeout(() => res(null), 6000)),
          ]);
        } catch { return null; }
      };

      let p = await tryGetProfile();
      // Si null mais qu'on a bien une session, on retente une fois après 1s
      // (peut arriver si le serveur Supabase est lent au démarrage)
      if (!p) {
        cjLog('init: 1st getProfile null, retrying after 1s');
        await new Promise((r) => setTimeout(r, 1000));
        p = await tryGetProfile();
      }
      cjLog(`init: profile=${p ? p.pseudo : 'NULL'}`);
      if (mounted) {
        if (p) { setProfile(p); setLoading(false); }
        else {
          // 2 essais ratés mais session valide → on laisse loading=false
          // et l'auth listener retentera au prochain TOKEN_REFRESHED
          setLoading(false);
        }
      }
    };

    init();

    // Écouteur d'événements auth (login, logout, refresh token...)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      cjLog(`📡 ${event} session=${session ? 'YES' : 'NO'}`);

      if (session) {
        // Login réussi ou refresh token réussi → on (re)charge le profil
        try {
          const p = await getProfile();
          cjLog(`  ↳ getProfile=${p ? p.pseudo : 'NULL'}`);
          if (!mounted) return;
          if (p) {
            setProfile(p);
            setLoading(false);
          } else {
            // 🚨 CAS CRITIQUE : on a une session valide MAIS getProfile a retourné null
            // (timeout 5s, blip réseau, etc.). On NE déloggue PAS — on garde le profil
            // existant en mémoire. Au prochain événement (TOKEN_REFRESHED) ou au prochain
            // visibilitychange, on retentera. Si on n'a vraiment pas de profil (1er login),
            // on reste juste en loading=false sans profil → AuthScreen.
            cjLog('  ↳ kept existing profile (getProfile fail with valid session)');
            setLoading(false);
          }
          syncFriendships().catch(() => {});
        } catch (e) {
          // Pareil : erreur réseau ≠ déconnexion. On garde le profil existant.
          cjLog('  ↳ getProfile threw, keeping existing profile');
          if (mounted) setLoading(false);
        }
        return;
      }

      // === Pas de session dans l'event ===
      if (userInitiatedLogout) {
        userInitiatedLogout = false;
        if (mounted) clearProfile('user clicked logout');
        return;
      }

      // Sinon : recheck après 500ms
      setTimeout(async () => {
        if (!mounted) return;
        try {
          const { data: { session: recheck } } = await supabase.auth.getSession();
          cjLog(`  ↳ recheck: session=${recheck ? 'YES' : 'NO'}`);
          if (recheck) {
            cjLog('  ↳ ignored (false alarm)');
            return;
          }
          clearProfile('recheck confirmed no session');
        } catch (e) {
          cjLog('  ↳ recheck threw → keeping user logged in');
        }
      }, 500);
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
    // On marque la déconnexion comme volontaire AVANT d'appeler sbLogout(),
    // pour que le SIGNED_OUT qui en découle soit honoré par onAuthStateChange
    // (et pas filtré comme un faux SIGNED_OUT).
    userInitiatedLogout = true;
    stopPresence();  // sortir du channel cj-presence
    try {
      await sbLogout();
    } catch (e) {
      // Si sbLogout rate (réseau), on force le state local quand même
      setProfile(null);
    }
  };

  // Démarre/arrête le tracking de présence en fonction du profil actif.
  // Centralisé ici (et non à chaque login) car onAuthStateChange peut firer
  // plusieurs fois (TOKEN_REFRESHED, SIGNED_IN au retour de tab, etc.)
  useEffect(() => {
    if (profile?.id) {
      startPresence(profile.id);
    }
    return () => {
      // pas de stopPresence dans le cleanup car ça démonterait le channel à
      // chaque re-render. On l'arrête uniquement dans logout() ou unmount global.
    };
  }, [profile?.id]);

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
  // Affiche les 4 cases en pastilles ; le dernier digit tapé reste visible 1.5s
  // avant d'être masqué en •. Pratique pour les enfants qui veulent vérifier ce
  // qu'ils ont tapé sans tout retaper.
  const [visibleIdx, setVisibleIdx] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    if (visibleIdx < 0) return;
    const t = setTimeout(() => setVisibleIdx(-1), 1500);
    return () => clearTimeout(t);
  }, [visibleIdx, value]);

  const handleChange = (raw) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 4);
    // On affiche le dernier digit que si on ajoute (pas si on efface)
    if (cleaned.length > value.length) {
      setVisibleIdx(cleaned.length - 1);
    } else {
      setVisibleIdx(-1);
    }
    onChange(cleaned);
  };

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      {/* Input invisible qui capture le clavier */}
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        maxLength={4}
        autoFocus={autoFocus}
        onChange={(e) => handleChange(e.target.value)}
        style={{
          position: 'absolute', inset: 0, opacity: 0,
          cursor: 'pointer', fontSize: 16,  // 16px évite le zoom iOS
        }}
        aria-label="Code PIN à 4 chiffres"
      />
      {/* 4 cases visibles */}
      <div className="flex gap-3 justify-center">
        {[0, 1, 2, 3].map((i) => {
          const char = value[i];
          const filled = char !== undefined;
          const reveal = i === visibleIdx;
          return (
            <div key={i} style={{
              width: 56, height: 64, borderRadius: 16,
              background: C.white,
              boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
              fontSize: '1.8rem', color: C.ink,
              border: filled ? `2px solid ${C.accentPink}` : `2px solid transparent`,
              transition: 'border-color 0.15s',
            }}>
              {filled ? (reveal ? char : '•') : ''}
            </div>
          );
        })}
      </div>
    </div>
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
    bg: C.pink, tagline: '3 en ligne !',
    objective: 'Aligne 3 symboles avant ton adversaire.',
    rules: [
      { icon: '👤', text: 'J1 joue ❌, J2 joue ⭕' },
      { icon: '👆', text: 'Touche une case vide' },
      { icon: '🔄', text: 'Chacun son tour' },
      { icon: '🏆', text: '3 alignés = victoire !' },
    ],
  },
  connect4: {
    title: 'Puissance 4', cardEmoji: '🔴🟡', headerEmoji: '🔴',
    bg: C.blue, tagline: '4 pions à la suite !',
    objective: 'Aligne 4 pions de ta couleur.',
    rules: [
      { icon: '👤', text: 'J1 = rouge 🔴, J2 = jaune 🟡' },
      { icon: '👆', text: 'Touche une colonne, le pion tombe' },
      { icon: '📏', text: 'Aligne 4 dans tous les sens' },
      { icon: '🏆', text: 'Le 1er à 4 gagne !' },
    ],
  },
  pendu: {
    title: 'Pendu', cardEmoji: '✏️📝', headerEmoji: '✏️',
    bg: C.peach, tagline: 'Devine le mot !',
    objective: 'Trouve le mot avant 6 erreurs.',
    rules: [
      { icon: '✏️', text: 'J1 écrit un mot secret' },
      { icon: '🔤', text: 'J2 propose des lettres' },
      { icon: '6️⃣', text: '6 erreurs max !' },
      { icon: '🏆', text: 'Mot trouvé ? Gagné !' },
    ],
  },
  echecs: {
    title: 'Échecs', cardEmoji: '♟️👑', headerEmoji: '♟️',
    bg: C.cream, tagline: 'Le roi des jeux !',
    objective: 'Capture le roi adverse.',
    onlineOnly: true,  // pas de mode local pour les échecs
    rules: [
      { icon: '👤', text: 'J1 = ⚪ blancs, J2 = ⚫ noirs' },
      { icon: '👆', text: 'Touche une pièce pour bouger' },
      { icon: '👑', text: 'Piège le roi !' },
      { icon: '⚠️', text: 'Échec = menacé, Mat = piégé' },
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
  // Liste complète des amis — on en dérive le count et la liste "en ligne"
  // sur la home, et on peut l'utiliser pour le quick-invite
  const [friends, setFriends] = useState([]);
  // Ami pré-sélectionné via tap sur la home → ouvre direct le picker de jeu
  const [quickInviteFriend, setQuickInviteFriend] = useState(null);

  // Toast d'erreur (timeout 60s, double-back-to-quit, etc.)
  const [toast, setToast] = useState(null);

  // Modal "Quitter la partie ?" (déclenché par le bouton Retour Android dans une room)
  const [exitGameModal, setExitGameModal] = useState(false);

  // Ref miroir pour activeRoom : utilisé par les listeners (popstate, visibilitychange)
  // pour lire la valeur à jour SANS recréer le listener à chaque changement.
  const activeRoomRef = useRef(activeRoom);
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

  // Notifie quand un ami passe en ligne (toast global, son léger, filtre 5min)
  useFriendOnlineNotifier(profile);

  // === Charge les invitations + amis + demandes au montage ===
  // Pattern : 1 chargement immédiat + 1 refresh toutes les 60s pour capter
  // les changements (nouvel ami accepté, etc.) sans s'abonner en temps réel
  // à la table friendships (qui changerait peu et coûterait un channel).
  useEffect(() => {
    let mounted = true;

    const refreshAll = () => {
      listIncomingInvitations().then((list) => { if (mounted) setIncomingInvites(list); });
      listPendingRequests().then((list) => { if (mounted) setPendingFriendRequests(list.length); });
      listFriends().then((list) => { if (mounted) setFriends(list); });
    };
    refreshAll();
    const interval = setInterval(refreshAll, 60_000);

    const invSub = subscribeToInvitations(profile.id, async (newRoom) => {
      playSound('notify');
      vibrate([60, 40, 60]);
      listIncomingInvitations().then((list) => { if (mounted) setIncomingInvites(list); });

      // Toast global qui apparait peu importe l'écran où on est
      // (en jeu, dans le lobby, ou sur la home)
      try {
        const { data: inviter } = await supabase
          .from('profiles').select('pseudo').eq('id', newRoom.player1_id).maybeSingle();
        const gameTitle = GAMES[newRoom.game]?.title || 'jouer';
        toastEmit({
          kind: 'invite',
          fromPseudo: inviter?.pseudo || 'Un ami',
          gameTitle,
          room: newRoom,
        });
      } catch { /* tant pis, le banner home suffira */ }
    });

    return () => { mounted = false; clearInterval(interval); invSub.unsubscribe(); };
  }, [profile.id]);

  // === Restore de la session précédente au boot ===
  // Si l'onglet a été tué par Android et qu'on était dans une room, on tente
  // de la restaurer. Côté hôte, on reset aussi le timer 60s côté serveur.
  useEffect(() => {
    const savedId = (() => { try { return localStorage.getItem(LS.ACTIVE_ROOM); } catch { return null; } })();
    if (savedId) {
      restoreActiveRoom(savedId).then((room) => {
        if (room) {
          setActiveRoom(room);
          setSelectedGame(room.game);
          setMode('online');
        } else {
          try { localStorage.removeItem(LS.ACTIVE_ROOM); } catch {}
        }
      }).catch(() => {});
    }
    // Nettoie les vieilles rooms abandonnées (>5 min en attente) — fait une fois
    // par boot pour ne pas spammer Supabase.
    cleanupStaleWaitingRooms().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Persiste l'id de la room active dans localStorage ===
  // Comme ça, même si Android tue l'onglet pour libérer de la RAM, on peut
  // restaurer la room au prochain boot.
  // Au passage : on broadcast notre statut "busy" via la présence Realtime
  // → les amis voient un point 🟡 (occupé) au lieu de 🟢 (libre) sur la home.
  useEffect(() => {
    try {
      if (activeRoom?.id) localStorage.setItem(LS.ACTIVE_ROOM, activeRoom.id);
      else localStorage.removeItem(LS.ACTIVE_ROOM);
    } catch {}
    setBusy(!!activeRoom?.id);
  }, [activeRoom?.id]);

  // === Visibility change : quand on revient sur l'onglet ===
  // L'utilisateur a switché vers WhatsApp / verrouillé l'écran et revient.
  // On re-synchronise silencieusement les données critiques.
  // ⚠️ DÉLAI 1.5s : quand l'onglet redevient visible, Supabase tente un refresh
  // du JWT. Tant que ce refresh n'est pas terminé, nos requêtes peuvent partir
  // avec un token expiré → 401 → SIGNED_OUT déclenché par le SDK → logout.
  // En attendant 1.5s, on laisse le SDK se stabiliser avant de toucher au réseau.
  useEffect(() => {
    let settleTimer = null;
    const onVisible = () => {
      cjLog(`👁️ visibility=${document.visibilityState}`);
      if (document.visibilityState !== 'visible') return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          cjLog(`👁️ settle: session=${session ? 'YES' : 'NO'}`);
          if (!session) return;
        } catch { return; }

        listIncomingInvitations().then(setIncomingInvites).catch(() => {});
        listPendingRequests().then((l) => setPendingFriendRequests(l.length)).catch(() => {});
        const room = activeRoomRef.current;
        if (room?.id) {
          supabase.from('rooms').select('*').eq('id', room.id).maybeSingle()
            .then(({ data }) => {
              if (data) setActiveRoom(data);
              else setActiveRoom(null);
            })
            .catch(() => {});
        }
      }, 1500);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, []);

  // === Bouton Retour Android (popstate) : on bloque les fausses manips ===
  //  - Dans une room (waiting ou playing) → modal "Quitter la partie ?"
  //  - Sur l'écran d'accueil → toast "Appuie encore pour quitter"
  // On push un state sentinelle au mount → quand l'utilisateur tape Retour,
  // popstate se déclenche, on relit l'état, on re-pushe une sentinelle pour
  // ne pas réellement quitter.
  useEffect(() => {
    let lastBackTs = 0;
    try { window.history.pushState({ cjGuard: true }, ''); } catch {}

    const onPopState = () => {
      const room = activeRoomRef.current;
      if (room) {
        // On est dans une room : on bloque et on demande confirmation
        try { window.history.pushState({ cjGuard: true }, ''); } catch {}
        setExitGameModal(true);
        playSound('pop'); vibrate(50);
        return;
      }
      // Sur l'accueil : double-back-to-quit
      const now = Date.now();
      if (now - lastBackTs < 2000) {
        // 2e tap rapide → on laisse partir (ne pas re-pousser de state)
        return;
      }
      lastBackTs = now;
      try { window.history.pushState({ cjGuard: true }, ''); } catch {}
      setToast({ message: '👋 Appuie encore pour quitter', type: 'info' });
      setTimeout(() => setToast(null), 2200);
      playSound('pop'); vibrate(40);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Refresh des demandes d'amis quand on quitte l'écran amis
  useEffect(() => {
    if (!showFriends) {
      listPendingRequests().then((list) => setPendingFriendRequests(list.length));
    }
  }, [showFriends]);

  // TIMEOUT 60s : si une room reste en waiting, on la supprime
  useEffect(() => {
    if (!activeRoom || activeRoom.status !== 'waiting') return;
    // On calcule combien de temps il reste à partir du created_at de la room.
    // Comme restoreActiveRoom peut avoir reset le created_at côté serveur,
    // le timer est cohérent même après un reload.
    const createdAt = new Date(activeRoom.created_at).getTime();
    const msLeft = Math.max(0, 60000 - (Date.now() - createdAt));

    const timer = setTimeout(async () => {
      const { data: current } = await supabase.from('rooms').select('status').eq('id', activeRoom.id).single();
      if (current?.status === 'waiting') {
        await cancelInvitation(activeRoom.id).catch(() => {});
        setActiveRoom(null);
        setToast({ message: '⏱️ Pas de réponse', type: 'info' });
        setTimeout(() => setToast(null), 4000);
      }
    }, msLeft);

    return () => clearTimeout(timer);
  }, [activeRoom?.id, activeRoom?.status, activeRoom?.created_at]);

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

  // === Rendu d'écran : on factorise dans une fonction pour pouvoir
  // ajouter des overlays (modal "Quitter", toast) AU-DESSUS de tout
  // écran, peu importe lequel est affiché ===
  const renderScreen = () => {
    if (showFriends) {
      return <FriendsScreen profile={profile}
        onBack={() => { setShowFriends(false); setQuickInviteFriend(null); }}
        initialInviteFriend={quickInviteFriend}
        onInviteToGame={async (friend, gameId) => {
          setShowFriends(false);
          setQuickInviteFriend(null);
          await createOnlineRoom(gameId, friend.id);
        }}
      />;
    }
    if (activeRoom) {
      return (
        <LobbyErrorBoundary key={activeRoom.id} onLeave={() => setActiveRoom(null)}>
          <Lobby
            profile={profile}
            room={activeRoom}
            roomProfiles={roomProfiles}
            onRoomUpdate={setActiveRoom}
            onLeave={async () => {
              if (activeRoom.status === 'waiting') {
                await cancelInvitation(activeRoom.id).catch(() => {});
              }
              setActiveRoom(null);
            }}
            onFinished={() => setActiveRoom(null)}
            onChangeGame={async (opponentFriend) => {
              // Quitter la partie en cours + ouvrir le picker pour le même ami
              if (activeRoom.status === 'waiting') {
                await cancelInvitation(activeRoom.id).catch(() => {});
              }
              setActiveRoom(null);
              setShowFriends(true);
              setQuickInviteFriend(opponentFriend);
            }}
          />
        </LobbyErrorBoundary>
      );
    }
    if (selectedGame && !mode) {
      return <ModeSelector profile={profile} gameId={selectedGame}
        onBack={() => setSelectedGame(null)}
        onPickMode={(m) => {
          setMode(m);
          if (m === 'local') setShowRules(true);
        }}
      />;
    }
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
    if (selectedGame && mode === 'local' && showRules) {
      return <RulesScreen gameId={selectedGame}
        onBack={() => { setMode(null); setShowRules(false); }}
        onStart={() => setShowRules(false)} />;
    }
    if (selectedGame && mode === 'local' && !showRules) {
      const back = () => setMode(null);
      switch (selectedGame) {
        case 'morpion':  return <TicTacToe onBack={back} pseudo={profile.pseudo} />;
        case 'connect4': return <Connect4  onBack={back} pseudo={profile.pseudo} />;
        case 'pendu':    return <Pendu     onBack={back} pseudo={profile.pseudo} />;
        default:         break;
      }
    }
    // Par défaut : grille des jeux
    return (
      <GamesGrid
        profile={profile} onLogout={onLogout}
        onPickGame={(id) => setSelectedGame(id)}
        onOpenFriends={() => setShowFriends(true)}
        pendingFriendRequests={pendingFriendRequests}
        friends={friends}
        onQuickInvite={(friend) => {
          // Tap sur un ami en ligne sur la home → on ouvre le ModeSelector
          // après avoir présélectionné un jeu ? Non — on ouvre InviteGamePicker
          // (choix du jeu pour cet ami) puis envoie l'invite directement.
          setShowFriends(true);  // FriendsScreen va afficher le game picker
          // Mais on veut court-circuiter : afficher direct le picker pour ce friend.
          // FriendsScreen accepte un initialInvite prop (à ajouter)
          setQuickInviteFriend(friend);
        }}
        incomingInvites={incomingInvites}
        onAcceptInvite={acceptIncoming}
        onIgnoreInvite={(roomId) => {
          setIncomingInvites((prev) => prev.filter((r) => r.id !== roomId));
          dismissInvitation(roomId).catch(() => {});
          playSound('pop');
        }}
        toast={toast}
      />
    );
  };

  // === Action sur "Confirmer le quit" depuis la modal Retour Android ===
  const confirmExitGame = async () => {
    setExitGameModal(false);
    if (activeRoom) {
      if (activeRoom.status === 'waiting') {
        await cancelInvitation(activeRoom.id).catch(() => {});
      }
      setActiveRoom(null);
    }
  };

  return (
    <>
      {renderScreen()}
      {exitGameModal && (
        <ExitConfirmModal
          onCancel={() => { setExitGameModal(false); tap(); }}
          onConfirm={confirmExitGame}
        />
      )}
      <GlobalToastHost
        onAcceptInvite={acceptIncoming}
        hasActiveRoom={!!activeRoom}
      />
    </>
  );
}

// ============================================================
// ExitConfirmModal — Modal "Quitter la partie ?"
// Apparait quand le bouton Retour Android est appuyé dans une room.
// ============================================================
function ExitConfirmModal({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.45)' }}
         onClick={onCancel}>
      <div className="rounded-3xl p-6 max-w-sm w-full text-center"
           style={{ background: C.white, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
           onClick={(e) => e.stopPropagation()}>
        <div className="text-5xl mb-3">🚪</div>
        <h3 className="text-xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          Quitter la partie ?
        </h3>
        <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
          Tu ne pourras pas revenir en arrière.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 rounded-2xl clic-press"
            style={{ background: C.cream, color: C.ink, fontWeight: 700,
                     fontFamily: '"Fredoka", sans-serif',
                     boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
            Rester
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                     fontFamily: '"Fredoka", sans-serif',
                     boxShadow: '0 3px 0 rgba(0,0,0,0.10)' }}>
            Quitter
          </button>
        </div>
      </div>
    </div>
  );
}


// ============================================================
// FRIENDS SCREEN — Mes amis (liste + recherche + demandes)
// ============================================================
function FriendsScreen({ profile, onBack, onInviteToGame, initialInviteFriend = null }) {
  // Onglets : 'friends' (mes amis) | 'requests' (demandes reçues) | 'search' (chercher)
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [pending, setPending] = useState([]);
  const [sent, setSent] = useState([]);
  const [loading, setLoading] = useState(true);
  // Pour l'invitation à jouer : quand on clique "Inviter" sur un ami,
  // on stocke ici l'ami choisi → on affiche un mini-écran de choix de jeu.
  // Si initialInviteFriend est fourni (tap sur la home), on démarre direct
  // sur ce picker.
  const [invitingFriend, setInvitingFriend] = useState(initialInviteFriend);

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
        <div className="text-6xl mb-3">🤗</div>
        <p className="text-base" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          Aucun ami pour l'instant
        </p>
        <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
          👉 Onglet <span style={{ color: C.accentPink, fontWeight: 700 }}>Ajouter</span>
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
// ============================================================
// HOOK : usePresence — abonnement à la présence des users
// ============================================================
// Renvoie un Set des userIds en ligne, augmenté d'une méthode .busy(id)
// pour savoir si l'utilisateur est en partie. Compatible avec l'ancien
// usage (onlineIds.has(id)) tout en exposant onlineIds.busy(id).
function usePresence() {
  const [state, setState] = useState({ online: new Set(), busy: new Set() });
  useEffect(() => {
    const unsub = subscribePresence(setState);
    return unsub;
  }, []);
  // On retourne le Set des online + une méthode .busy(id) attachée
  // (Set étant un objet, on peut lui coller une prop sans drame)
  const augmented = state.online;
  augmented.busy = (id) => state.busy.has(id);
  return augmented;
}

// ============================================================
// Composant : pastille de statut
//   - vert  = online + libre
//   - jaune = online + en partie
//   - gris  = hors ligne
// ============================================================
function OnlineDot({ online, busy = false, size = 10 }) {
  const color = !online ? '#C7C7C7' : busy ? '#FFB547' : '#4CD964';
  const glow = !online ? 'none'
             : busy ? '0 0 0 2px #fff, 0 0 6px rgba(255,181,71,0.5)'
                    : '0 0 0 2px #fff, 0 0 6px rgba(76,217,100,0.5)';
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      boxShadow: glow,
      flexShrink: 0,
    }} />
  );
}

// Helper : libellé court à mettre sous le pseudo (en jeu / en ligne / rien)
function presenceLabel(online, busy) {
  if (!online) return null;
  return busy
    ? { text: 'en jeu', color: '#E69500' }
    : { text: 'en ligne', color: '#4CD964' };
}

function FriendRow({ friend, onRemoved, onInvite }) {
  const [confirming, setConfirming] = useState(false);
  const onlineIds = usePresence();
  const isOnline = onlineIds.has(friend.id);
  const isBusy = isOnline && onlineIds.busy(friend.id);
  const label = presenceLabel(isOnline, isBusy);

  const handleRemove = async () => {
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
    await removeFriend(friend.id);
    onRemoved();
  };

  return (
    <div className="flex items-center gap-2 p-3 rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
      <div className="relative">
        <div className="text-3xl">{friend.avatar || '👤'}</div>
        <div style={{ position: 'absolute', right: -2, bottom: -2 }}>
          <OnlineDot online={isOnline} busy={isBusy} size={11} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          {friend.pseudo}
        </div>
        {label && (
          <div className="text-xs" style={{ color: label.color, fontWeight: 700 }}>
            {label.text}
          </div>
        )}
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
        <button onClick={shareApp}
          className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 clic-press"
          style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-2xl">📲</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            Inviter un copain
          </span>
        </button>
        <p className="text-xs mt-2 text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          Partage le lien à un ami pour qu'il rejoigne 🎮
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

// --- Barre de profil : 3 boutons à rôles clairs ---
// LEFT : profil (avatar + pseudo) → menu identité (déconnexion)
// MIDDLE : ⚙️ réglages (son, vibration)
// RIGHT : 👥 amis (avec badge)
function ProfileBar({ profile, onLogout, onOpenFriends, pendingFriends = 0 }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSnd] = useState(isSoundOn());
  const [vibOn, setVib]   = useState(isVibrationOn());

  // Refs pour détecter les clics en dehors du dropdown
  const profileRef  = useRef(null);
  const settingsRef = useRef(null);

  // Ferme les dropdowns quand on tape ailleurs sur l'écran
  useEffect(() => {
    if (!profileOpen && !settingsOpen) return;
    const onDocClick = (e) => {
      if (profileOpen && profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    // pointerdown fire AVANT click, donc on capture le tap initial même
    // sur un bouton qui va ré-ouvrir le menu
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  }, [profileOpen, settingsOpen]);

  const toggleSound = () => {
    const v = !soundOn;
    setSnd(v); setSoundOn(v);
    if (v) playSound('pop');
  };
  const toggleVib = () => {
    const v = !vibOn;
    setVib(v); setVibrationOn(v);
    if (v) vibrate(40);
  };

  // Ferme tout autre menu quand on en ouvre un (sinon ils se superposent)
  const openProfile  = () => { tap(); setSettingsOpen(false); setProfileOpen(v => !v); };
  const openSettings = () => { tap(); setProfileOpen(false);  setSettingsOpen(v => !v); };

  // Style commun pour les pills du haut
  const pillStyle = {
    background: C.white,
    boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
  };

  return (
    <div className="flex items-center justify-between mb-6 gap-2">
      {/* GAUCHE : profil */}
      <div className="relative" ref={profileRef}>
        <button onClick={openProfile}
          className="flex items-center gap-2 px-3 py-2 rounded-full clic-press"
          style={pillStyle}>
          <span className="text-2xl">{profile.avatar}</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {profile.pseudo}
          </span>
        </button>

        {profileOpen && (
          <div className="absolute left-0 top-full mt-2 rounded-2xl p-2 z-20" style={{
            background: C.white, minWidth: 180,
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
          }}>
            <button onClick={() => { setProfileOpen(false); onLogout(); }}
              className="w-full text-left px-3 py-2 rounded-xl text-sm clic-press"
              style={{ color: C.accentPink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              🚪 Se déconnecter
            </button>
          </div>
        )}
      </div>

      {/* DROITE : 2 icônes côte à côte */}
      <div className="flex items-center gap-2">
        {/* Réglages */}
        <div className="relative" ref={settingsRef}>
          <button onClick={openSettings}
            className="w-11 h-11 rounded-full flex items-center justify-center text-xl clic-press"
            style={pillStyle}
            aria-label="Réglages">
            ⚙️
          </button>

          {settingsOpen && (
            <div className="absolute right-0 top-full mt-2 rounded-2xl p-2 z-20" style={{
              background: C.white, minWidth: 200,
              boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            }}>
              <button onClick={toggleSound}
                className="w-full px-3 py-3 rounded-xl text-sm clic-press flex items-center justify-between"
                style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                <span>{soundOn ? '🔊 Son' : '🔇 Son'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: soundOn ? C.mint : C.cream,
                               color: soundOn ? C.ink : C.inkSoft, fontWeight: 700 }}>
                  {soundOn ? 'ON' : 'OFF'}
                </span>
              </button>
              <button onClick={toggleVib}
                className="w-full px-3 py-3 rounded-xl text-sm clic-press flex items-center justify-between"
                style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                <span>{vibOn ? '📳 Vibration' : '🚫 Vibration'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: vibOn ? C.mint : C.cream,
                               color: vibOn ? C.ink : C.inkSoft, fontWeight: 700 }}>
                  {vibOn ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Amis */}
        {onOpenFriends && (
          <button onClick={() => { tap(); onOpenFriends(); }}
            className="relative w-11 h-11 rounded-full flex items-center justify-center text-xl clic-press"
            style={pillStyle}
            aria-label="Amis">
            👥
            {pendingFriends > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-xs flex items-center justify-center"
                    style={{ background: C.accentPink, color: C.white, fontWeight: 700 }}>
                {pendingFriends}
              </span>
            )}
          </button>
        )}
      </div>
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
              className="text-xs px-3 py-2 rounded-full clic-press"
              style={{ background: C.white, color: C.inkLight, fontWeight: 700,
                       fontFamily: '"Fredoka", sans-serif' }}
              aria-label="Plus tard">
              Plus tard
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
                      pendingFriendRequests = 0, friends = [],
                      onQuickInvite,
                      incomingInvites = [], onAcceptInvite, onIgnoreInvite,
                      toast = null }) {
  const ids = Object.keys(GAMES);
  const onlineIds = usePresence();

  // Liste des amis actuellement en ligne (pour l'avatar bar)
  const onlineFriends = useMemo(
    () => friends.filter((f) => onlineIds.has(f.id)),
    [friends, onlineIds]
  );

  // Partage du lien d'invitation (?ref=PSEUDO) via le sheet natif si dispo
  const shareApp = async () => {
    tap();
    const url = `https://clicjeu.com/?ref=${encodeURIComponent(profile.pseudo)}`;
    const text = `Viens jouer avec moi sur ClicJeu ! 🎮`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'ClicJeu', text, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch { /* l'utilisateur a annulé */ }
  };

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

      <header className="text-center mb-4">
        <div className="mb-2"><Logo size={140} /></div>
        <p className="text-base" style={{ color: C.inkLight, fontWeight: 600 }}>
          Salut <span style={{ color: C.ink, fontWeight: 700 }}>{profile.pseudo}</span> ! ✨
        </p>
      </header>

      {/* Actions sociales : 2 boutons côte à côte, toujours visibles
          (pas de flicker au montage : on n'attend pas friendCount pour rendre).
          - Gauche : partage du lien d'invitation (?ref=)
          - Droite : ouvre l'écran Amis avec le nombre d'amis en ligne en badge */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <button onClick={shareApp}
          className="rounded-3xl p-3 flex items-center justify-center gap-2 clic-press"
          style={{
            background: C.lavender,
            boxShadow: '0 5px 0 rgba(0,0,0,0.08)',
            minHeight: 72,
          }}>
          <span className="text-2xl">📲</span>
          <div className="text-left">
            <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                          color: C.ink, fontSize: '0.9rem', lineHeight: 1.15 }}>
              Inviter
            </div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600, lineHeight: 1.2 }}>
              un copain
            </div>
          </div>
        </button>

        <button onClick={() => { tap(); onOpenFriends(); }}
          className="rounded-3xl p-3 flex items-center justify-center gap-2 clic-press relative"
          style={{
            background: C.lavender,
            boxShadow: '0 5px 0 rgba(0,0,0,0.08)',
            minHeight: 72,
          }}>
          <span className="text-2xl">👥</span>
          <div className="text-left">
            <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                          color: C.ink, fontSize: '0.9rem', lineHeight: 1.15 }}>
              Mes amis
            </div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600, lineHeight: 1.2 }}>
              {onlineFriends.length > 0
                ? `${onlineFriends.length} en ligne`
                : 'voir la liste'}
            </div>
          </div>
          {/* Pastille verte si au moins un ami est en ligne */}
          {onlineFriends.length > 0 && (
            <div style={{ position: 'absolute', top: 6, right: 6 }}>
              <OnlineDot online size={9} />
            </div>
          )}
        </button>
      </div>

      {/* Amis en ligne — hidden si personne en ligne (clean home) */}
      {onlineFriends.length > 0 && (
        <div className="rounded-2xl p-3 mb-4"
             style={{ background: 'rgba(255,255,255,0.7)',
                      boxShadow: '0 3px 0 rgba(0,0,0,0.04)' }}>
          <div className="flex items-center gap-2 mb-2 px-1">
            <OnlineDot online size={8} />
            <div className="text-xs"
                 style={{ color: C.ink, fontWeight: 700,
                          fontFamily: '"Fredoka", sans-serif' }}>
              {onlineFriends.length === 1
                ? '1 ami en ligne'
                : `${onlineFriends.length} amis en ligne`}
            </div>
          </div>
          {/* Scroll horizontal d'avatars */}
          <div className="flex gap-3 overflow-x-auto pb-1"
               style={{ scrollbarWidth: 'none' }}>
            {onlineFriends.map((f) => {
              const isBusy = onlineIds.busy(f.id);
              return (
                <button key={f.id}
                  onClick={() => {
                    if (isBusy) {
                      tap();
                      toastEmit({ kind: 'info', message: `${f.pseudo} est en partie` });
                      return;
                    }
                    tap();
                    onQuickInvite && onQuickInvite(f);
                  }}
                  className="flex flex-col items-center clic-press flex-shrink-0"
                  style={{ minWidth: 56, opacity: isBusy ? 0.65 : 1 }}>
                  <div className="relative">
                    <div className="text-3xl">{f.avatar || '👤'}</div>
                    <div style={{ position: 'absolute', right: -2, bottom: -2 }}>
                      <OnlineDot online busy={isBusy} size={10} />
                    </div>
                  </div>
                  <div className="text-xs mt-1 truncate" style={{
                    color: C.ink, fontWeight: 700, maxWidth: 64,
                    fontFamily: '"Fredoka", sans-serif',
                  }}>
                    {f.pseudo}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Grille Netflix-style — 1 col mobile, 2 col tablette */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ids.map((id) => {
          const g = GAMES[id];
          return (
            <button key={id} onClick={() => { tap(); onPickGame(id); }}
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
                <p className="text-sm mb-3" style={{ color: C.inkLight, fontWeight: 600 }}>
                  {g.tagline}
                </p>
                {/* Pill "Jouer" pour rendre l'intention clair (look bouton, pas bannière) */}
                <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full"
                     style={{
                       background: C.white,
                       color: C.accentPink,
                       fontWeight: 700,
                       fontSize: '0.85rem',
                       fontFamily: '"Fredoka", sans-serif',
                       boxShadow: '0 2px 0 rgba(0,0,0,0.06)',
                     }}>
                  Jouer <span>▶️</span>
                </div>
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

      <p className="text-center text-base mb-4" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
        Avec qui ?
      </p>

      {/* En ligne en premier (plus mis en avant) */}
      <button onClick={() => { tap(); onPickMode('online'); }}
        className="w-full p-5 rounded-3xl mb-3 text-left clic-press"
        style={{
          background: C.lavender,
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="flex items-center gap-4">
          <div className="text-5xl">🌐</div>
          <div className="flex-1">
            <h3 className="text-xl"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              Un ami à distance
            </h3>
            <p className="text-xs mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
              Invite un copain 📲
            </p>
          </div>
        </div>
      </button>

      {/* Mode local (désactivé si jeu onlineOnly) */}
      <button onClick={() => { if (onlineOnly) return; tap(); onPickMode('local'); }}
        disabled={onlineOnly}
        className="w-full p-5 rounded-3xl text-left clic-press"
        style={{
          background: C.mint,
          opacity: onlineOnly ? 0.4 : 1,
          cursor: onlineOnly ? 'not-allowed' : 'pointer',
          boxShadow: '0 6px 0 rgba(0,0,0,0.06), 0 8px 18px rgba(0,0,0,0.08)',
        }}>
        <div className="flex items-center gap-4">
          <div className="text-5xl">🤝</div>
          <div className="flex-1">
            <h3 className="text-xl"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              Sur le même téléphone
            </h3>
            <p className="text-xs mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
              {onlineOnly ? 'Pas dispo ici' : 'À côté de toi 👫'}
            </p>
          </div>
        </div>
      </button>
    </div>
  );
}

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
  const onlineIds = usePresence();

  useEffect(() => {
    listFriends().then((f) => { setFriends(f); setLoading(false); });
  }, []);

  // Trie : amis en ligne d'abord (plus pertinent pour inviter sur le moment)
  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      const aOn = onlineIds.has(a.id) ? 0 : 1;
      const bOn = onlineIds.has(b.id) ? 0 : 1;
      return aOn - bOn;
    });
  }, [friends, onlineIds]);

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
        <div className="text-center py-4">
          <div className="text-4xl mb-2">🤗</div>
          <p className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            Aucun ami pour l'instant
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          {sortedFriends.map((f) => {
            const wasInvited = invited.has(f.id);
            const isOnline = onlineIds.has(f.id);
            const isBusy = isOnline && onlineIds.busy(f.id);
            const label = presenceLabel(isOnline, isBusy);
            return (
              <div key={f.id} className="flex items-center gap-2 p-3 rounded-2xl"
                   style={{ background: C.cream, boxShadow: '0 2px 0 rgba(0,0,0,0.04)' }}>
                <div className="relative">
                  <div className="text-2xl">{f.avatar || '👤'}</div>
                  <div style={{ position: 'absolute', right: -2, bottom: -2 }}>
                    <OnlineDot online={isOnline} busy={isBusy} size={9} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate"
                       style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                    {f.pseudo}
                  </div>
                  {label && (
                    <div className="text-xs" style={{ color: label.color, fontWeight: 700 }}>
                      {label.text}
                    </div>
                  )}
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
        <button onClick={shareApp}
          className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 clic-press"
          style={{ background: C.lavender, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-2xl">📲</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            Inviter un copain
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
  const onlineIds = usePresence();

  useEffect(() => {
    listFriends().then((f) => { setFriends(f); setLoading(false); });
  }, []);

  // Amis en ligne en premier (plus pertinent quand on cherche à inviter)
  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      const aOn = onlineIds.has(a.id) ? 0 : 1;
      const bOn = onlineIds.has(b.id) ? 0 : 1;
      return aOn - bOn;
    });
  }, [friends, onlineIds]);

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
    playSound('notify');
    vibrate(40);
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
          {sortedFriends.map((f) => {
            const isOnline = onlineIds.has(f.id);
            const isBusy = isOnline && onlineIds.busy(f.id);
            const label = presenceLabel(isOnline, isBusy);
            return (
              <div key={f.id} className="flex items-center gap-3 p-3 rounded-2xl"
                   style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
                <div className="relative">
                  <div className="text-3xl">{f.avatar || '👤'}</div>
                  <div style={{ position: 'absolute', right: -2, bottom: -2 }}>
                    <OnlineDot online={isOnline} busy={isBusy} size={11} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate"
                       style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
                    {f.pseudo}
                  </div>
                  {label && (
                    <div className="text-xs" style={{ color: label.color, fontWeight: 700 }}>
                      {label.text}
                    </div>
                  )}
                </div>
                <button onClick={() => handleInvite(f)} disabled={inviting === f.id || isBusy}
                  className="text-xs px-3 py-2 rounded-full clic-press"
                  style={{ background: isBusy ? '#CCC' : C.accentPink, color: C.white, fontWeight: 700,
                           opacity: (inviting === f.id || isBusy) ? 0.6 : 1 }}>
                  {inviting === f.id ? '...' : isBusy ? 'En jeu' : '+ Inviter'}
                </button>
              </div>
            );
          })}
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

function Lobby({ profile, room, onLeave, onCancel, onFinished, onRoomUpdate, onChangeGame }) {
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

          {/* Bouton "Annuler" gros + bien visible (UX enfant : "← Quitter"
              en haut à gauche c'était pas évident) */}
          {waiting && (
            <button onClick={onLeave}
              className="w-full py-3 rounded-2xl clic-press flex items-center justify-center gap-2"
              style={{
                background: 'rgba(255,208,208,0.6)',
                color: '#B33',
                fontWeight: 700,
                fontFamily: '"Fredoka", sans-serif',
                boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
              }}>
              <span>✕</span>
              <span>Annuler l'invitation</span>
            </button>
          )}
        </>
      )}

      {ready && (() => {
        // Routage : pour chaque jeu, on lance le composant online correspondant
        // "Autre jeu" : on quitte ce salon, et l'hôte est routé vers un picker
        // pour rejouer avec le même ami à un autre jeu.
        const opponent = isHost ? player2 : player1;
        const wrappedChangeGame = (onChangeGame && opponent)
          ? () => onChangeGame({ id: opponent.id, pseudo: opponent.pseudo, avatar: opponent.avatar })
          : null;
        const gameProps = {
          room: currentRoom,
          profile,
          player1,
          player2,
          onUpdate: updateCurrent,
          onChangeGame: wrappedChangeGame,
        };
        switch (currentRoom.game) {
          case 'morpion':  return <TicTacToeOnline {...gameProps} />;
          case 'connect4': return <Connect4Online  {...gameProps} />;
          case 'pendu':    return <PenduOnline     {...gameProps} />;
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

function Banner({ text, color = C.accentPink, thinking = false }) {
  return (
    <div className="rounded-2xl p-3 mb-4 text-center flex items-center justify-center gap-2" style={{
      background: color, color: C.white,
      fontFamily: '"Fredoka", sans-serif', fontWeight: 600, fontSize: '1.1rem',
      boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
    }}>
      <span>{text}</span>
      {thinking && (
        <span className="cj-thinking" aria-hidden>
          <span style={{ animationDelay: '0ms' }}>•</span>
          <span style={{ animationDelay: '180ms' }}>•</span>
          <span style={{ animationDelay: '360ms' }}>•</span>
        </span>
      )}
    </div>
  );
}

function KawaiiButton({ children, onClick, color = C.accentPink, fullWidth = false }) {
  const handleClick = (e) => {
    tap();
    if (onClick) onClick(e);
  };
  return (
    <button onClick={handleClick}
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
// Composant : actions de fin de partie (host uniquement)
// 2 boutons côte à côte : Revanche (même jeu, même salon) + Autre jeu
// (quitte ce salon et lance le picker de jeu pour le même ami).
// ============================================================
function EndGameActions({ onRematch, onChangeGame, opponentName }) {
  return (
    <div className="space-y-2">
      <KawaiiButton fullWidth onClick={onRematch}>🔄 Revanche !</KawaiiButton>
      {onChangeGame && (
        <button onClick={() => { tap(); onChangeGame(); }}
          className="w-full px-5 py-3 rounded-2xl clic-press"
          style={{
            background: C.white,
            color: C.ink,
            fontFamily: '"Fredoka", sans-serif',
            fontWeight: 600, fontSize: '0.95rem',
            boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
          }}>
          🎲 Autre jeu{opponentName ? ` avec ${opponentName}` : ''}
        </button>
      )}
    </div>
  );
}

// ============================================================
// HOOK : useMyTurnEffect — son + vibration discrets quand c'est mon tour
// À appeler dans chaque jeu online avec :
//   isMyTurn : booléen (est-ce mon tour de jouer ?)
//   gameOver : booléen (true si la partie est finie, pour ne plus rien jouer)
// On ne déclenche que sur transition false → true (pas au mount initial).
// ============================================================
function useMyTurnEffect(isMyTurn, gameOver = false) {
  const prevRef = useRef(null);
  useEffect(() => {
    if (gameOver) { prevRef.current = isMyTurn; return; }
    // Premier render : on mémorise sans rien jouer
    if (prevRef.current === null) { prevRef.current = isMyTurn; return; }
    // Transition vers "à moi" : pop + petite vibration
    if (!prevRef.current && isMyTurn) {
      playSound('pop');
      vibrate(40);
    }
    prevRef.current = isMyTurn;
  }, [isMyTurn, gameOver]);
}

// ============================================================
// HOOK : Effets de fin de partie (son + confettis + vibration)
// À appeler dans chaque jeu online avec :
//   winner : null | 'draw' | identifiant du gagnant
//   didIWin : booléen (suis-je le gagnant ?)
// ============================================================
function useGameEndEffects(winner, didIWin) {
  const [lastFiredFor, setLastFiredFor] = useState(null);
  useEffect(() => {
    // 🚨 IMPORTANT : on teste `== null` et pas `!winner` car winner peut valoir 0
    // (index du joueur 1 aux échecs notamment). `!0 === true` → bug : sons et
    // confettis ne se déclencheraient pas quand le J1 gagne.
    if (winner == null) { setLastFiredFor(null); return; }
    if (winner === lastFiredFor) return;
    setLastFiredFor(winner);

    if (winner === 'draw') {
      playSound('draw');
      vibrate([80, 50, 80]);
    } else if (didIWin) {
      playSound('victory');
      vibrate([100, 50, 100, 50, 200]);
      launchConfetti({ count: 80, duration: 3000 });
    } else {
      playSound('defeat');
      vibrate([200, 100, 200]);
    }
  }, [winner, didIWin, lastFiredFor]);
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
function TicTacToeOnline({ room, profile, player1, player2, onUpdate, onChangeGame }) {
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
  useGameEndEffects(result?.winner, result?.winner === mySymbol);
  useMyTurnEffect(isMyTurn, !!result);

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

      <Banner text={banner}
        color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink}
        thinking={!isMyTurn && !result} />

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
            <EndGameActions
              onRematch={newRound}
              onChangeGame={onChangeGame}
              opponentName={players[1]?.pseudo}
            />
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
      {result && (<KawaiiButton fullWidth onClick={newRound}>🔄 Revanche !</KawaiiButton>)}
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
function Connect4Online({ room, profile, player1, player2, onUpdate, onChangeGame }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const symbols = ['🔴', '🟡'];
  const colors = [C.pink, '#FFE89E'];
  const mySymbol = symbols[myIndex];
  const players = [player1, player2];

  const state = (room.state && room.state.grid) ? room.state : makeConnect4State();
  const { grid, turn, scores } = state;
  const result = checkConnect4Winner(grid);
  const isMyTurn = turn === myIndex && !result;
  useGameEndEffects(result?.winner, result?.winner === mySymbol);
  useMyTurnEffect(isMyTurn, !!result);

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

      <Banner text={banner}
        color={result?.winner && result.winner !== 'draw' ? '#6BCB77' : C.accentPink}
        thinking={!isMyTurn && !result} />

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
            <EndGameActions
              onRematch={newRound}
              onChangeGame={onChangeGame}
              opponentName={players[1]?.pseudo}
            />
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
      {result && (<div className="mt-4"><KawaiiButton fullWidth onClick={newRound}>🔄 Revanche !</KawaiiButton></div>)}
    </GameShell>
  );
}

// ============================================================
// ============================================================
// JEU 4 — ÉCHECS (online uniquement)
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
function EchecsOnline({ room, profile, player1, player2, onUpdate, onChangeGame }) {
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

  // === Anti-forgery : on vérifie que la fin annoncée correspond bien à la
  // position FEN actuelle (échec et mat / pat / nulle). Si un client triche
  // en pushant un faux winner, chess.js le détecte ici et on l'ignore. ===
  const verifiedWinner = useMemo(() => {
    if (winner == null) return null;
    if (winner === 'draw') {
      return (game.isStalemate() || game.isDraw() || game.isThreefoldRepetition() || game.isInsufficientMaterial())
        ? 'draw' : null;
    }
    // winner === 0 ou 1 → on accepte uniquement si la position est réellement un mat
    return game.isCheckmate() ? winner : null;
  }, [winner, game]);

  // À qui c'est de jouer ? (selon chess.js)
  const turnColor = game.turn();              // 'w' ou 'b'
  const isMyTurn = turnColor === myColor && verifiedWinner == null;

  // Effets de fin (sons + confettis) — utilise verifiedWinner, et bonne comparaison index/index
  useGameEndEffects(verifiedWinner, verifiedWinner === myIndex);
  useMyTurnEffect(isMyTurn, verifiedWinner != null);

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
  if (game.isCheck() && verifiedWinner == null) {
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
  if (verifiedWinner !== null) {
    const isDraw = verifiedWinner === 'draw';
    const isMyWin = verifiedWinner === myIndex;
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
            {isDraw ? 'Match nul !' : `${players[verifiedWinner]?.pseudo || 'Joueur'} gagne !`}
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
          <EndGameActions
            onRematch={newGame}
            onChangeGame={onChangeGame}
            opponentName={players[1]?.pseudo}
          />
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

      <Banner text={banner}
        color={game.isCheck() ? '#FF8FB1' : C.accentPink}
        thinking={!isMyTurn && verifiedWinner == null} />

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

// ============================================================
// JEU 3 — PENDU
// ============================================================
const PENDU_MAX_WRONG = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Strip accents : "Été" → "ETE"
const penduStripAccents = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const penduNorm = (s) => penduStripAccents(s).toUpperCase();

// État initial du Pendu online
// phase: 'theme-select' (l'hôte choisit un thème) | 'guessing' (J2 devine) | 'win' | 'lose'
// On ne stocke PAS le mot en clair dans state : seulement le thème + l'index.
// Chaque client résout le mot localement via WORDS_JSON. Ça évite que quelqu'un
// qui sniffe le réseau (ou un parent qui ouvre Supabase) voie le mot.
function makePenduState() {
  return {
    phase: 'theme-select',
    theme: null,       // 'animaux' | 'ecole' | ...
    wordIdx: null,     // index dans WORDS_JSON.themes[theme].words
    guessed: [],
  };
}

// Helper : récupère le mot en clair à partir du state.
// Renvoie '' tant que le thème n'est pas choisi.
function resolvePenduWord(state) {
  if (!state || !state.theme || state.wordIdx == null) return '';
  const theme = WORDS_JSON.themes[state.theme];
  if (!theme) return '';
  return theme.words[state.wordIdx] || '';
}

// ============================================================
// PENDU — VERSION ONLINE
// ------------------------------------------------------------
// Nouveau flow : l'hôte choisit un thème (Animaux, École, Maison...) et le
// mot est tiré au sort dans /src/words.json. On ne transmet QUE le couple
// (theme, wordIdx) via Supabase, jamais le mot en clair. Ça évite que :
//   - le mot soit visible dans les logs Supabase (parent admin)
//   - le mot transite en clair sur le réseau (mode debug, proxy d'école)
//   - un enfant puisse écrire un mot inapproprié (insulte, nom d'élève...)
// Les deux clients résolvent le mot localement via resolvePenduWord(state).
// ============================================================
function PenduOnline({ room, profile, player1, player2, onUpdate, onChangeGame }) {
  const myIndex = room.player1_id === profile.id ? 0 : 1;
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makePenduState();
  const { phase, guessed } = state;

  // Mot résolu localement via le dictionnaire
  const word = resolvePenduWord(state);

  // Calculs dérivés
  const normWord = penduNorm(word);
  const wrongLetters = guessed.filter((L) => !normWord.includes(L));
  const wrongCount = wrongLetters.length;

  // Effets de fin — J2 (guesser) gagne si 'win', J1 (setter) gagne si 'lose'
  const penduWinner = phase === 'win' ? 'guesser' : phase === 'lose' ? 'setter' : null;
  const didIWinPendu = (phase === 'win' && myIndex === 1) || (phase === 'lose' && myIndex === 0);
  useGameEndEffects(penduWinner, didIWinPendu);

  // L'hôte choisit un thème → on tire un index au hasard et on passe en phase guessing
  const pickTheme = async (themeId) => {
    const theme = WORDS_JSON.themes[themeId];
    if (!theme) return;
    const wordIdx = Math.floor(Math.random() * theme.words.length);
    const newState = { phase: 'guessing', theme: themeId, wordIdx, guessed: [] };
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

  // Rejouer : seul J1 peut relancer
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makePenduState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : L'hôte choisit un thème ===
  if (phase === 'theme-select' && isHost) {
    const themes = Object.entries(WORDS_JSON.themes);
    return (
      <div className="rounded-3xl p-5" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">✏️</div>
          <h3 className="text-2xl"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Choisis un thème
          </h3>
          <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
            Un mot sera tiré au hasard
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {themes.map(([id, t]) => (
            <button key={id} onClick={() => pickTheme(id)}
              className="p-4 rounded-2xl clic-press text-center"
              style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
              <div className="text-3xl mb-1">{t.emoji}</div>
              <div className="text-sm"
                   style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                {t.label}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // === ÉCRAN 1 bis : J2 attend que J1 choisisse ===
  if (phase === 'theme-select' && !isHost) {
    return (
      <div className="rounded-3xl p-8 text-center" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[0]?.pseudo || 'L\'hôte'} choisit un thème.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : victoire ou défaite ===
  if (phase === 'win' || phase === 'lose') {
    const isWin = phase === 'win';
    const winnerPseudo = isWin ? (players[1]?.pseudo || 'Le devineur') : (players[0]?.pseudo || 'L\'hôte');
    const themeMeta = state.theme ? WORDS_JSON.themes[state.theme] : null;
    return (
      <div className="rounded-3xl p-8 text-center" style={{
        background: isWin ? C.mint : C.pink, boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">{isWin ? <span className="clic-celebrate">🎉</span> : '😢'}</div>
        <h3 className="text-3xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {winnerPseudo} gagne !
        </h3>
        {themeMeta && (
          <p className="text-xs mb-1" style={{ color: C.inkSoft, fontWeight: 700 }}>
            Thème : {themeMeta.emoji} {themeMeta.label}
          </p>
        )}
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          Le mot était : <span style={{ color: C.ink, fontWeight: 700 }}>{word.toUpperCase()}</span>
        </p>
        <div className="mt-5">
          {isHost ? (
            <EndGameActions
              onRematch={newGame}
              onChangeGame={onChangeGame}
              opponentName={players[1]?.pseudo}
            />
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
          ? `🔍 ${players[1]?.pseudo || 'Le devineur'} cherche`
          : `❤️ ${PENDU_MAX_WRONG - wrongCount} vies restantes`
      } color={wrongCount >= 4 ? '#FF8FB1' : C.accentPink}
        thinking={isHost} />

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
          <div className="mt-5"><KawaiiButton fullWidth onClick={fullReset}>🔄 Revanche !</KawaiiButton></div>
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
