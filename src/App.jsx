import React, { useState, useEffect, useMemo, useRef } from 'react';
import { signup as sbSignup, login as sbLogin, logout as sbLogout,
         getProfile, saveAvatar as sbSaveAvatar, supabase } from './supabase';
import { createRoom, joinRoom, subscribeToRoom, getProfilesByIds, updateRoomState,
         listIncomingInvitations, subscribeToInvitations, cancelInvitation,
         updateRoomInvite, dismissInvitation, cleanupStaleWaitingRooms,
         restoreActiveRoom, subscribeToReactions, sendReaction,
         subscribeToGameSignals, sendGameSignal,
         findRoomToSpectate, findFriendActiveRoom, recordMatchResult,
         fetchMyMatchResults } from './rooms';
import { searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
         removeFriend, listFriends, listPendingRequests, listSentRequests, syncFriendships } from './friends';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { tap, playSound, vibrate, launchConfetti,
         isSoundOn, setSoundOn, isVibrationOn, setVibrationOn } from './effects';
import { startPresence, stopPresence, subscribePresence, setBusy } from './presence';
import WORDS_JSON from './words.json';
import COUNTRIES_JSON from './countries.json';
import CULTURE_JSON from './culture.json';

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

const AVATARS = [
  // Animaux mignons
  '🦊','🐼','🐶','🐱','🐰','🦁',
  '🐯','🐸','🐨','🐵','🦄','🐙',
  // Plus d'animaux
  '🐻','🐺','🦝','🦔','🐧','🐢',
  // Personnages / fantaisie
  '🤖','👽','👻','🧚','🐲','🦖',
];

// On garde juste "vu l'onboarding" en localStorage.
// Le compte est dans Supabase maintenant.
// localStorage keys
const LS = {
  ONBOARDED: 'gh_onboarded',
  PENDING_REF: 'cj_pending_ref',  // pseudo du parrain à associer après inscription
  ACTIVE_ROOM: 'cj_active_room_id',  // id de la room où on était quand l'onglet a été tué
  SPECTATED: 'cj_has_spectated',  // a déjà regardé une partie (pour le badge Spectateur)
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
      @keyframes clic-reaction-pop {
        0%   { transform: scale(0.3); opacity: 0; }
        20%  { transform: scale(1.15); opacity: 1; }
        70%  { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0; }
      }
      .clic-fade-in     { animation: clic-fade-in 0.35s ease-out; }
      .clic-pop         { animation: clic-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
      .clic-celebrate   { animation: clic-celebrate 0.8s ease-in-out infinite; display: inline-block; }
      .clic-shake       { animation: clic-shake 0.4s ease-in-out; }
      .clic-reaction-pop{ animation: clic-reaction-pop 2.2s ease-in-out forwards; }
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
  // Ref pour lire hasActiveRoom à jour dans le handler d'événement
  const hasActiveRoomRef = useRef(hasActiveRoom);
  useEffect(() => { hasActiveRoomRef.current = hasActiveRoom; }, [hasActiveRoom]);

  useEffect(() => {
    const handler = (toast) => {
      // Les invitations sont déjà affichées par <IncomingInvitesBanner> (avec
      // avatar) sur l'écran d'accueil. Pour éviter le DOUBLON, on n'affiche le
      // toast d'invitation QUE lorsqu'on est dans une partie (hasActiveRoom),
      // car le banner d'accueil n'y est pas visible.
      if (toast.kind === 'invite' && !hasActiveRoomRef.current) return;
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
  const [editingAvatar, setEditingAvatar] = useState(false);  // true quand on veut re-choisir
                                                              // un avatar depuis la home

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
    if (result.ok) {
      setProfile((p) => ({ ...p, avatar }));
      setEditingAvatar(false);  // après save, on retourne sur le hub
    }
  };

  // --- Routage ---
  let screen;
  // On lit le pseudo de parrainage en attente (depuis un lien d'invitation)
  const pendingRef = (typeof window !== 'undefined') ? localStorage.getItem(LS.PENDING_REF) : null;

  if (loading) {
    screen = <LoadingScreen />;
  } else if (!profile) {
    screen = <AuthScreen onSignup={signup} onLogin={login} pendingRef={pendingRef} />;
  } else if (!profile.avatar || editingAvatar) {
    // Premier choix d'avatar OU clic explicite "Changer mon avatar"
    screen = <AvatarPicker
               pseudo={profile.pseudo}
               currentAvatar={profile.avatar}
               onSave={saveAvatar}
               onLogout={logout}
               onCancel={editingAvatar ? () => setEditingAvatar(false) : null} />;
  } else {
    screen = <GameHub profile={profile} onLogout={logout}
               onEditAvatar={() => setEditingAvatar(true)} />;
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
  // Logo final : chat kawaii avec manette, généré par Gemini.
  // Fichier dans /public/logo.png. Pour le remplacer plus tard, juste
  // changer le src ci-dessous (garder ratio carré).
  return (
    <img src="/logo.png" alt="ClicJeu"
         width={size} height={size}
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
  // Par défaut on montre la Connexion (cas le plus fréquent : un habitué qui
  // revient). Le bouton Inscription reste visible juste à côté pour les
  // nouveaux. Exception : si on arrive via un lien d'invitation (pendingRef),
  // c'est sûrement un nouveau → on bascule par défaut sur Inscription.
  const [mode, setMode] = useState(pendingRef ? 'signup' : 'login');
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
            background: mode === 'signup' ? C.accentPink : C.peach,
            color: mode === 'signup' ? C.white : C.ink,
            fontWeight: 700,
            fontFamily: '"Fredoka", sans-serif',
          }}>
          {mode === 'signup' ? 'Inscription' : '✨ Inscription'}
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
function AvatarPicker({ pseudo, onSave, onLogout, currentAvatar = null, onCancel = null }) {
  const [avatar, setAvatar] = useState(currentAvatar || AVATARS[0]);
  const isEditing = !!onCancel;

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <div className="text-center mb-6">
        <div key={avatar} className="text-7xl mb-3 clic-pop">{avatar}</div>
        <h2 className="text-3xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {isEditing ? 'Change ton avatar' : `Salut ${pseudo} !`}
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
        {isEditing ? 'Enregistrer ✨' : 'C\'est parti ! ✨'}
      </KawaiiButton>

      {isEditing ? (
        <button onClick={onCancel} className="mt-4 mx-auto block text-sm clic-press px-4 py-2 rounded-full"
          style={{ color: C.inkSoft, fontWeight: 700, background: 'rgba(255,255,255,0.6)' }}>
          ← Annuler
        </button>
      ) : (
        <button onClick={onLogout} className="mt-4 mx-auto block text-sm"
          style={{ color: C.inkSoft, fontWeight: 700 }}>
          ← Me déconnecter
        </button>
      )}
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
      { icon: '👤', text: 'Le 1er joue ❌, le 2e joue ⭕' },
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
      { icon: '👤', text: 'L\'un joue rouge 🔴, l\'autre jaune 🟡' },
      { icon: '👆', text: 'Touche une colonne, le pion tombe' },
      { icon: '📏', text: 'Aligne 4 dans tous les sens' },
      { icon: '🏆', text: 'Le 1er à 4 gagne !' },
    ],
  },
  pendu: {
    title: 'Pendu', cardEmoji: '✏️📝', headerEmoji: '✏️',
    bg: C.peach, tagline: 'Devine le mot !',
    objective: 'Trouve le mot avant 6 erreurs.',
    onlineOnly: true,  // le mode local "écrire un mot" cassait l'UX nouvelle
                       // (thème + alternance) qui dépend du dictionnaire safe.
    rules: [
      { icon: '🎨', text: 'L\'un choisit un thème' },
      { icon: '🔤', text: 'L\'autre propose des lettres' },
      { icon: '6️⃣', text: '6 erreurs max !' },
      { icon: '🔁', text: 'À la manche suivante, on change de rôle' },
    ],
  },
  echecs: {
    title: 'Échecs', cardEmoji: '♟️👑', headerEmoji: '♟️',
    bg: C.cream, tagline: 'Le roi des jeux !',
    objective: 'Capture le roi adverse.',
    onlineOnly: true,  // pas de mode local pour les échecs
    rules: [
      { icon: '👤', text: 'L\'un joue ⚪ blancs, l\'autre ⚫ noirs' },
      { icon: '👆', text: 'Touche une pièce pour bouger' },
      { icon: '👑', text: 'Piège le roi !' },
      { icon: '⚠️', text: 'Échec = menacé, Mat = piégé' },
    ],
  },
  math: {
    title: 'Math Duel', cardEmoji: '🔢⚡', headerEmoji: '🔢',
    bg: C.mint, tagline: 'Le plus rapide en calcul !',
    objective: 'Réponds vite et juste — 10 questions, le meilleur gagne.',
    hasSoloMode: true,  // jouable seul pour s'entraîner au calcul
    rules: [
      { icon: '🎚️', text: 'Choisis le niveau (Facile / Moyen / Difficile)' },
      { icon: '⚡', text: 'En multi, le 1er à toucher la bonne réponse marque' },
      { icon: '🔟', text: '10 questions par partie' },
      { icon: '🎓', text: 'En solo : entraîne-toi au calcul mental !' },
    ],
  },
  geo: {
    title: 'Géo Quiz', cardEmoji: '🌍🌎', headerEmoji: '🌍',
    bg: C.lavender, tagline: 'Drapeaux & capitales',
    objective: 'Reconnais drapeaux et capitales — solo ou contre un ami.',
    hasSoloMode: true,  // unique jeu avec mode solo en V1
    rules: [
      { icon: '🏁', text: 'Reconnais le drapeau ou la capitale' },
      { icon: '⚡', text: 'En multi, le 1er à toucher marque' },
      { icon: '🔟', text: '10 questions par partie' },
      { icon: '🎓', text: 'En solo : tu apprends en jouant !' },
    ],
  },
  pfc: {
    title: 'Pierre Feuille Ciseaux', cardEmoji: '✊✋✌️', headerEmoji: '✊',
    bg: C.mint, tagline: 'Le plus malin gagne !',
    objective: 'Choisis en secret, le meilleur de 5 manches l\'emporte.',
    rules: [
      { icon: '🤫', text: 'Choisis ton signe en secret' },
      { icon: '👀', text: 'On révèle en même temps' },
      { icon: '⚔️', text: 'Pierre bat ciseaux, ciseaux bat feuille, feuille bat pierre' },
      { icon: '🏆', text: 'Premier à 3 manches gagnées !' },
    ],
  },
  course: {
    title: 'Course au trésor', cardEmoji: '🎲🏆', headerEmoji: '🎲',
    bg: C.peach, tagline: 'Le premier au trésor gagne !',
    objective: 'Lance le dé, avance sur le plateau, attention aux cases pièges !',
    rules: [
      { icon: '🎲', text: 'Lance le dé chacun ton tour' },
      { icon: '⏩', text: 'Certaines cases te font avancer ou reculer' },
      { icon: '🌟', text: 'D\'autres te téléportent ou te font rejouer' },
      { icon: '🏆', text: 'Le premier au trésor a gagné !' },
    ],
  },
  culture: {
    title: 'Culture G', cardEmoji: '🧠💡', headerEmoji: '🧠',
    bg: C.blue, tagline: 'Le plus malin gagne !',
    objective: 'Réponds à des questions de culture générale plus vite que ton adversaire.',
    rules: [
      { icon: '🧠', text: '10 questions de culture générale' },
      { icon: '⚡', text: 'Le 1er à toucher la bonne réponse marque' },
      { icon: '🌍', text: 'Histoire, sciences, géo, sport, et plus !' },
      { icon: '🏆', text: 'Le meilleur score sur 10 gagne' },
    ],
  },
  motsmeles: {
    title: 'Mots Mêlés', cardEmoji: '🔤🔍', headerEmoji: '🔤',
    bg: C.mint, tagline: 'Trouve les mots cachés !',
    objective: 'Repère les mots cachés dans la grille de lettres avant ton adversaire.',
    rules: [
      { icon: '🔍', text: '6 mots sont cachés dans la grille' },
      { icon: '👆', text: 'Touche la 1re puis la dernière lettre du mot' },
      { icon: '↔️', text: 'Les mots sont en ligne, colonne ou diagonale' },
      { icon: '🏆', text: 'Le plus de mots trouvés gagne !' },
    ],
  },
  dominos: {
    title: 'Dominos', cardEmoji: '🁫🁌', headerEmoji: '🁫',
    bg: C.cream, tagline: 'Le jeu classique !',
    objective: 'Pose tes tuiles pour vider ta main avant l\'adversaire.',
    rules: [
      { icon: '🎴', text: '7 tuiles distribuées à chacun' },
      { icon: '🔢', text: 'Pose une tuile qui correspond à un bout de la chaîne' },
      { icon: '🃏', text: 'Si tu ne peux pas jouer, pioche une tuile' },
      { icon: '🏆', text: 'Le 1er à vider sa main gagne !' },
    ],
  },
};

// ============================================================
// STATS & BADGES — calcul côté client à partir des match_results
// ------------------------------------------------------------
// Tout est calculé en JS depuis la liste des parties où le joueur a
// participé. Pas de fonction SQL : tant qu'un enfant n'a pas des milliers
// de parties, c'est instantané.
// ============================================================

// Définition des badges. `check(stats)` renvoie true si débloqué.
// L'ordre = ordre d'affichage dans la page Trophées.
const BADGES = [
  { id: 'first_game',  emoji: '🎮', title: 'Première partie',  desc: 'Joue ta 1re partie',
    check: (s) => s.totalGames >= 1 },
  { id: 'first_win',   emoji: '🏆', title: 'Première victoire', desc: 'Gagne 1 partie',
    check: (s) => s.totalWins >= 1 },
  { id: 'streak3',     emoji: '🔥', title: 'Sur ta lancée',     desc: 'Gagne 3 fois de suite',
    check: (s) => s.bestStreak >= 3 },
  { id: 'regular',     emoji: '💪', title: 'Habitué',           desc: 'Joue 10 parties',
    check: (s) => s.totalGames >= 10 },
  { id: 'veteran',     emoji: '🌟', title: 'Vétéran',           desc: 'Joue 50 parties',
    check: (s) => s.totalGames >= 50 },
  { id: 'all_games',   emoji: '🎯', title: 'Touche-à-tout',     desc: 'Joue aux 11 jeux',
    check: (s) => s.distinctGames >= 11 },
  { id: 'champion',    emoji: '👑', title: 'Champion',          desc: 'Gagne 25 parties',
    check: (s) => s.totalWins >= 25 },
  { id: 'social',      emoji: '🤝', title: 'Sociable',          desc: 'Joue avec 3 amis différents',
    check: (s) => s.distinctOpponents >= 3 },
  { id: 'spectator',   emoji: '👀', title: 'Spectateur',        desc: 'Regarde une partie d\'amis',
    check: (s) => s.hasSpectated },
];

// Calcule toutes les stats d'un joueur à partir de ses parties.
// myId : mon id. results : lignes match_results (triées par date croissante).
// extras : { hasSpectated } — infos qui ne viennent pas de la base.
function computeStats(myId, results, extras = {}) {
  let totalWins = 0, totalLosses = 0, totalDraws = 0;
  let bestStreak = 0, currentStreak = 0;
  const games = new Set();
  const opponents = new Set();

  for (const r of results) {
    games.add(r.game);
    const oppId = r.player1_id === myId ? r.player2_id : r.player1_id;
    if (oppId) opponents.add(oppId);

    if (r.winner_id == null) {
      totalDraws++;
      currentStreak = 0;
    } else if (r.winner_id === myId) {
      totalWins++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      totalLosses++;
      currentStreak = 0;
    }
  }

  return {
    totalGames: results.length,
    totalWins, totalLosses, totalDraws,
    bestStreak,
    distinctGames: games.size,
    distinctOpponents: opponents.size,
    hasSpectated: !!extras.hasSpectated,
  };
}

// Bilan détaillé contre UN adversaire donné, par jeu + total.
// Renvoie { wins, losses, draws, byGame: { morpion: {w,l,d}, ... } }
function computeHeadToHead(myId, opponentId, results) {
  const tally = { wins: 0, losses: 0, draws: 0, byGame: {} };
  for (const r of results) {
    const isVsThisOpp =
      (r.player1_id === myId && r.player2_id === opponentId) ||
      (r.player2_id === myId && r.player1_id === opponentId);
    if (!isVsThisOpp) continue;

    if (!tally.byGame[r.game]) tally.byGame[r.game] = { w: 0, l: 0, d: 0 };
    if (r.winner_id == null) {
      tally.draws++; tally.byGame[r.game].d++;
    } else if (r.winner_id === myId) {
      tally.wins++; tally.byGame[r.game].w++;
    } else {
      tally.losses++; tally.byGame[r.game].l++;
    }
  }
  return tally;
}

// ============================================================
// GAMEHUB — niveau supérieur de l'app connectée
// Gère plusieurs rooms ouvertes + notifications de tour
// ============================================================
function GameHub({ profile, onLogout, onEditAvatar }) {
  // Navigation
  const [selectedGame, setSelectedGame] = useState(null);
  const [soloGame, setSoloGame]         = useState(null);  // 'math' | 'geo' | null
  const [spectatorRoom, setSpectatorRoom] = useState(null);  // room qu'on regarde
  const [showFriends, setShowFriends]   = useState(false);
  const [showTrophies, setShowTrophies] = useState(false);
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

        // Si la présence a été coupée par un pagehide (mise en arrière-plan),
        // on la relance. startPresence est idempotent : sans coupure
        // préalable, cet appel ne fait rien. Avec coupure, il rétablit le
        // channel et notre statut "busy" si on est en partie.
        if (profile?.id) {
          startPresence(profile.id);
          setBusy(!!activeRoomRef.current?.id);
        }

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

  // === Fermeture de l'appli (pagehide) : on libère la présence ===
  // pagehide est plus fiable que beforeunload sur mobile. Quand l'utilisateur
  // ferme l'onglet ou bascule l'appli en arrière-plan définitivement, on
  // sort proprement du channel de présence pour que les autres voient tout
  // de suite qu'on n'est plus là (au lieu d'attendre le timeout ~30s de
  // Supabase, qui laissait le point 🟡 figé). Best-effort : si le navigateur
  // tue l'onglet trop vite, le timeout serveur prendra le relais.
  useEffect(() => {
    const onPageHide = () => {
      try { stopPresence(); } catch {}
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
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
    setSelectedGame(null); setSoloGame(null);
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

  // Regarder la partie en cours d'un ami (mode spectateur)
  const watchFriend = async (friendId) => {
    const result = await findFriendActiveRoom(friendId);
    if (result.ok) {
      // Mémorise qu'on a regardé une partie (badge Spectateur)
      try { localStorage.setItem(LS.SPECTATED, '1'); } catch {}
      setSpectatorRoom(result.room);
      const ids = [result.room.player1_id, result.room.player2_id].filter(Boolean);
      if (ids.length > 0) {
        getProfilesByIds(ids).then((p) => setRoomProfiles((prev) => ({ ...prev, ...p })));
      }
    } else {
      setToast({ message: result.error || 'Impossible de regarder', type: 'info' });
      setTimeout(() => setToast(null), 3500);
    }
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
    if (showTrophies) {
      return <TrophiesScreen profile={profile} onBack={() => setShowTrophies(false)} />;
    }
    if (showFriends) {
      return <FriendsScreen profile={profile}
        onBack={() => { setShowFriends(false); setQuickInviteFriend(null); }}
        initialInviteFriend={quickInviteFriend}
        onInviteToGame={async (friend, gameId) => {
          setShowFriends(false);
          setQuickInviteFriend(null);
          await createOnlineRoom(gameId, friend.id);
        }}
        onWatchFriend={async (friend) => {
          setShowFriends(false);
          await watchFriend(friend.id);
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
    if (spectatorRoom) {
      return (
        <LobbyErrorBoundary key={'spec-' + spectatorRoom.id} onLeave={() => setSpectatorRoom(null)}>
          <Lobby
            profile={profile}
            room={spectatorRoom}
            roomProfiles={roomProfiles}
            isSpectator={true}
            onRoomUpdate={setSpectatorRoom}
            onLeave={() => setSpectatorRoom(null)}
            onFinished={() => setSpectatorRoom(null)}
          />
        </LobbyErrorBoundary>
      );
    }
    // Mode solo : aucun appel à Supabase, pas de room. Écran 100% local.
    if (soloGame === 'math') {
      return <MathDuelSolo onBack={() => setSoloGame(null)} />;
    }
    if (soloGame === 'geo') {
      return <GeoQuizSolo onBack={() => setSoloGame(null)} />;
    }
    if (selectedGame) {
      // Tous les jeux sont online uniquement. Tap sur un jeu → écran invitation.
      // Si le jeu a un mode solo (hasSoloMode), l'écran proposera aussi
      // le solo (en fallback si aucun ami n'est en ligne, ou en lien
      // discret sinon).
      return <InviteToPlayScreen
        profile={profile}
        gameId={selectedGame}
        onBack={() => setSelectedGame(null)}
        onInviteFriend={async (friend) => {
          await createOnlineRoom(selectedGame, friend.id);
        }}
        onStartSolo={() => {
          const g = selectedGame;
          setSelectedGame(null);
          setSoloGame(g);
        }}
      />;
    }
    // Par défaut : grille des jeux
    return (
      <GamesGrid
        profile={profile} onLogout={onLogout} onEditAvatar={onEditAvatar}
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
        onWatchFriend={(friend) => watchFriend(friend.id)}
        incomingInvites={incomingInvites}
        onAcceptInvite={acceptIncoming}
        onIgnoreInvite={(roomId) => {
          setIncomingInvites((prev) => prev.filter((r) => r.id !== roomId));
          dismissInvitation(roomId).catch(() => {});
          playSound('pop');
        }}
        toast={toast}
        onOpenTrophies={() => setShowTrophies(true)}
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
function FriendsScreen({ profile, onBack, onInviteToGame, initialInviteFriend = null, onWatchFriend = null }) {
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
  const [matchResults, setMatchResults] = useState([]);

  // Charger toutes les listes au montage
  const refresh = async () => {
    setLoading(true);
    const [f, p, s, mr] = await Promise.all([
      listFriends(),
      listPendingRequests(),
      listSentRequests(),
      fetchMyMatchResults(),
    ]);
    setFriends(f);
    setPending(p);
    setSent(s);
    setMatchResults(mr.results || []);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  // Quand l'utilisateur a choisi un jeu pour l'invitation
  const handleGamePicked = (gameId) => {
    const friend = invitingFriend;
    setInvitingFriend(null);
    onInviteToGame(friend, gameId);
  };

  // Si on est en train d'inviter un ami, on affiche l'écran de choix de jeu.
  // RETOUR DE LA SESSION : l'utilisateur s'est plaint qu'après une invitation
  // (ou son annulation), on lui re-montrait toute la liste d'amis. Si l'invite
  // a démarré depuis la home (= quickInvite, signalé par initialInviteFriend),
  // on revient direct à la home au lieu d'afficher la liste.
  if (invitingFriend) {
    const cameFromHome = !!initialInviteFriend;
    return <InviteGamePicker friend={invitingFriend}
             onPick={handleGamePicked}
             onCancel={() => {
               setInvitingFriend(null);
               if (cameFromHome) onBack();
             }} />;
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
                     onInvite={setInvitingFriend} onWatch={onWatchFriend}
                     matchResults={matchResults} myId={profile.id} />
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
function FriendsList({ friends, loading, onRefresh, onInvite, onWatch, matchResults = [], myId = null }) {
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
        <FriendRow key={f.id} friend={f} onRemoved={onRefresh} onInvite={onInvite} onWatch={onWatch}
                   headToHead={myId ? computeHeadToHead(myId, f.id, matchResults) : null} />
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

function FriendRow({ friend, onRemoved, onInvite, onWatch, headToHead = null }) {
  const [confirming, setConfirming] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const onlineIds = usePresence();
  const isOnline = onlineIds.has(friend.id);
  const isBusy = isOnline && onlineIds.busy(friend.id);
  const label = presenceLabel(isOnline, isBusy);

  const handleRemove = async () => {
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
    await removeFriend(friend.id);
    onRemoved();
  };

  // Bilan total contre cet ami (parties jouées ensemble)
  const h2h = headToHead;
  const totalH2H = h2h ? (h2h.wins + h2h.losses + h2h.draws) : 0;
  const hasDetail = totalH2H > 0;

  return (
    <div className="rounded-2xl"
         style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
      <div className="flex items-center gap-2 p-3">
        <div className="relative">
          <div className="text-3xl">{friend.avatar || '👤'}</div>
          <div style={{ position: 'absolute', right: -2, bottom: -2 }}>
            <OnlineDot online={isOnline} busy={isBusy} size={11} />
          </div>
        </div>
        <div className="flex-1 min-w-0"
             onClick={() => hasDetail && setShowDetail((v) => !v)}
             style={{ cursor: hasDetail ? 'pointer' : 'default' }}>
          <div className="truncate" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {friend.pseudo}
          </div>
          {/* Bilan "Toi X - Y" si on a déjà joué ensemble */}
          {hasDetail ? (
            <div className="text-xs flex items-center gap-1" style={{ color: C.inkLight, fontWeight: 700 }}>
              <span>🏆 Toi {h2h.wins}</span>
              <span style={{ color: C.inkSoft }}>-</span>
              <span>{h2h.losses}</span>
              {h2h.draws > 0 && <span style={{ color: C.inkSoft }}>({h2h.draws} nul{h2h.draws > 1 ? 's' : ''})</span>}
              <span style={{ color: C.accentPink }}>{showDetail ? '▴' : '▾'}</span>
            </div>
          ) : label ? (
            <div className="text-xs" style={{ color: label.color, fontWeight: 700 }}>
              {label.text}
            </div>
          ) : null}
        </div>
        {/* Ami en partie → bouton "Regarder". Sinon → bouton "Inviter". */}
        {isBusy && onWatch ? (
          <button onClick={() => onWatch(friend)}
            className="text-sm px-4 py-3 rounded-full clic-press"
            style={{ background: C.lavender, color: C.ink, fontWeight: 700,
                     fontFamily: '"Fredoka", sans-serif',
                     boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
            👀 Regarder
          </button>
        ) : onInvite ? (
          <button onClick={() => onInvite(friend)}
            className="text-sm px-4 py-3 rounded-full clic-press"
            style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                     fontFamily: '"Fredoka", sans-serif',
                     boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
            🎮 Inviter
          </button>
        ) : null}
        <button onClick={handleRemove}
          className="text-sm px-4 py-3 rounded-full clic-press"
          style={{
            background: confirming ? '#B33' : '#E15151',
            color: C.white,
            fontWeight: 700,
            fontFamily: '"Fredoka", sans-serif',
            boxShadow: '0 3px 0 rgba(0,0,0,0.08)',
          }}>
          {confirming ? 'Sûr ?' : 'Retirer'}
        </button>
      </div>

      {/* Détail par jeu (déplié au tap sur le pseudo) */}
      {showDetail && hasDetail && (
        <div className="px-3 pb-3 clic-fade-in">
          <div className="rounded-xl p-2" style={{ background: C.cream }}>
            {Object.entries(h2h.byGame).map(([gid, rec]) => {
              const g = GAMES[gid];
              if (!g) return null;
              return (
                <div key={gid} className="flex items-center justify-between py-1 px-1">
                  <span className="text-xs" style={{ color: C.ink, fontWeight: 700 }}>
                    {g.cardEmoji} {g.title}
                  </span>
                  <span className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                    {rec.w} - {rec.l}{rec.d > 0 ? ` (${rec.d} nul${rec.d > 1 ? 's' : ''})` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
            Inviter un ami
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
function ProfileBar({ profile, onLogout, onOpenFriends, pendingFriends = 0, onEditAvatar }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSnd] = useState(isSoundOn());
  const [vibOn, setVib]   = useState(isVibrationOn());

  // Ref pour détecter le clic en dehors du dropdown réglages
  const settingsRef = useRef(null);

  // Ferme le dropdown réglages quand on tape ailleurs sur l'écran
  useEffect(() => {
    if (!settingsOpen) return;
    const onDocClick = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  }, [settingsOpen]);

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

  const openSettings = () => { tap(); setSettingsOpen(v => !v); };

  // Style commun pour les pills du haut
  const pillStyle = {
    background: C.white,
    boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
  };

  return (
    <div className="flex items-center justify-between mb-6 gap-2">
      {/* GAUCHE : marque de l'app (mini-logo + clicjeu.com) */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-full"
           style={pillStyle}>
        <img src="/logo.png" alt=""
             width={28} height={28}
             style={{ display: 'block' }} />
        <span style={{ color: C.ink, fontWeight: 700,
                       fontFamily: '"Fredoka", sans-serif',
                       fontSize: '0.95rem' }}>
          clicjeu.com
        </span>
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

// ============================================================
// AvatarCard — Carte d'avatar centrée (remplace l'ancien Logo géant
// au-dessus de "Salut Pseudo"). Cliquable → dropdown avec
// "Changer mon avatar" et "Se déconnecter".
// ============================================================
function AvatarCard({ profile, onEditAvatar, onLogout, onOpenTrophies }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocClick);
    return () => document.removeEventListener('pointerdown', onDocClick);
  }, [open]);

  return (
    <div className="text-center mb-5 relative" ref={ref}>
      <button onClick={() => { tap(); setOpen(v => !v); }}
        className="inline-flex flex-col items-center clic-press p-3 rounded-3xl"
        style={{
          background: C.white,
          boxShadow: '0 5px 0 rgba(0,0,0,0.06)',
          minWidth: 180,
        }}>
        {/* Gros emoji avatar */}
        <div className="text-6xl mb-1" style={{ lineHeight: 1 }}>
          {profile.avatar}
        </div>
        {/* Pseudo en dessous */}
        <div style={{
          fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
          color: C.ink, fontSize: '1.2rem',
        }}>
          {profile.pseudo}
        </div>
        {/* Petit hint visuel pour montrer que c'est cliquable */}
        <div className="text-xs mt-1" style={{ color: C.inkSoft, fontWeight: 600 }}>
          Tape pour le menu ▾
        </div>
      </button>

      {open && (
        <div className="absolute left-1/2 top-full mt-2 rounded-2xl p-2 z-20"
             style={{
               background: C.white,
               minWidth: 220,
               boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
               transform: 'translateX(-50%)',
             }}>
          {onEditAvatar && (
            <button onClick={() => { setOpen(false); onEditAvatar(); }}
              className="w-full text-left px-3 py-3 rounded-xl text-sm clic-press"
              style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              🎨 Changer mon avatar
            </button>
          )}
          {onOpenTrophies && (
            <button onClick={() => { setOpen(false); onOpenTrophies(); }}
              className="w-full text-left px-3 py-3 rounded-xl text-sm clic-press"
              style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              🏆 Mes trophées
            </button>
          )}
          <div style={{ height: 1, background: C.cream, margin: '4px 8px' }} />
          <button onClick={() => { setOpen(false); onLogout(); }}
            className="w-full text-left px-3 py-3 rounded-xl text-sm clic-press"
            style={{ color: C.accentPink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            🚪 Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function TrophiesScreen({ profile, onBack }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const mr = await fetchMyMatchResults();
      let hasSpectated = false;
      try { hasSpectated = localStorage.getItem(LS.SPECTATED) === '1'; } catch {}
      const s = computeStats(profile.id, mr.results || [], { hasSpectated });
      if (mounted) { setStats(s); setLoading(false); }
    })();
    return () => { mounted = false; };
  }, [profile.id]);

  const unlockedCount = stats ? BADGES.filter((b) => b.check(stats)).length : 0;

  return (
    <div className="max-w-md mx-auto px-5 py-8">
      <button onClick={onBack} className="mb-4 px-4 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Retour
      </button>

      <h2 className="text-2xl mb-1 text-center"
          style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
        🏆 Mes trophées
      </h2>

      {loading ? (
        <div className="text-center text-sm py-8" style={{ color: C.inkLight, fontWeight: 600 }}>
          ⏳ Chargement...
        </div>
      ) : (
        <>
          <p className="text-sm text-center mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            {unlockedCount} / {BADGES.length} débloqués
          </p>

          {/* Résumé de stats */}
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[
              { label: 'Parties', value: stats.totalGames, emoji: '🎮' },
              { label: 'Victoires', value: stats.totalWins, emoji: '🏆' },
              { label: 'Série max', value: stats.bestStreak, emoji: '🔥' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl p-3 text-center"
                   style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.05)' }}>
                <div className="text-2xl">{stat.emoji}</div>
                <div className="text-xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                  {stat.value}
                </div>
                <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Grille de badges */}
          <div className="grid grid-cols-2 gap-3">
            {BADGES.map((badge) => {
              const unlocked = badge.check(stats);
              return (
                <div key={badge.id} className="rounded-2xl p-4 text-center"
                     style={{
                       background: unlocked ? C.peach : '#F0EDE8',
                       boxShadow: unlocked ? '0 4px 0 rgba(0,0,0,0.06)' : 'none',
                       opacity: unlocked ? 1 : 0.6,
                     }}>
                  <div className="text-4xl mb-1"
                       style={{ filter: unlocked ? 'none' : 'grayscale(1)' }}>
                    {unlocked ? badge.emoji : '🔒'}
                  </div>
                  <div className="text-sm"
                       style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                                color: unlocked ? C.ink : C.inkSoft }}>
                    {badge.title}
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.inkSoft, fontWeight: 600 }}>
                    {badge.desc}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// INSTALL BANNER — proposer d'installer ClicJeu sur l'écran d'accueil
// ------------------------------------------------------------
// Calqué sur GeoDojo : on capte l'événement beforeinstallprompt (émis par
// Chrome/Android quand l'app est installable) et on affiche un petit
// bandeau "Installer". AUCUN Service Worker n'est utilisé (c'est lui qui
// causait le warning Play Protect). L'app reste installable via le manifest.
//
// Le bandeau ne s'affiche jamais si :
//   - l'app est déjà installée (mode standalone)
//   - le navigateur n'émet pas beforeinstallprompt (iOS Safari, etc.)
//   - l'utilisateur l'a fermé pour cette session
// ============================================================
function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Si déjà installée (lancée en standalone), on ne propose rien
    const isStandalone = window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches;
    if (isStandalone) return;

    const handler = (e) => {
      e.preventDefault();        // on garde la main pour déclencher plus tard
      setPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    // Quand l'app vient d'être installée, on cache le bandeau
    const installedHandler = () => setPromptEvent(null);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  if (!promptEvent || dismissed) return null;

  const doInstall = async () => {
    promptEvent.prompt();
    try {
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') setPromptEvent(null);
    } catch { /* ignore */ }
  };

  return (
    <div className="rounded-2xl p-3 mb-3 flex items-center gap-3 clic-fade-in"
         style={{ background: C.lavender, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
      <div className="text-2xl">📲</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
          Installer ClicJeu
        </div>
        <div className="text-xs" style={{ color: C.inkLight, fontWeight: 600 }}>
          Ajoute l'app à ton écran d'accueil
        </div>
      </div>
      <button onClick={doInstall}
        className="text-sm px-4 py-2 rounded-full clic-press"
        style={{ background: C.accentPink, color: C.white, fontWeight: 700,
                 fontFamily: '"Fredoka", sans-serif', flexShrink: 0,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.10)' }}>
        Installer
      </button>
      <button onClick={() => setDismissed(true)}
        aria-label="Fermer"
        style={{ background: 'none', border: 'none', color: C.inkSoft,
                 fontSize: 20, lineHeight: 1, cursor: 'pointer', flexShrink: 0, padding: '0 2px' }}>
        ×
      </button>
    </div>
  );
}

function GamesGrid({ profile, onLogout, onPickGame, onOpenFriends, onEditAvatar,
                      pendingFriendRequests = 0, friends = [],
                      onQuickInvite, onWatchFriend,
                      incomingInvites = [], onAcceptInvite, onIgnoreInvite,
                      toast = null, onOpenTrophies = null }) {
  // Ordre des cartes : les jeux jouables en solo en premier (priorité de
  // visibilité), suivis des jeux multi-uniquement. Tant qu'on n'a pas d'IA
  // pour TTT/C4/Pendu/Échecs, ça permet aux enfants seuls de repérer
  // immédiatement ce qui est jouable sans ami connecté.
  const ids = Object.keys(GAMES).sort((a, b) => {
    const aSolo = GAMES[a].hasSoloMode ? 0 : 1;
    const bSolo = GAMES[b].hasSoloMode ? 0 : 1;
    return aSolo - bSolo;
  });
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
                  onOpenFriends={onOpenFriends} pendingFriends={pendingFriendRequests}
                  onEditAvatar={onEditAvatar} />

      {/* Bandeau d'installation (PWA sans Service Worker) */}
      <InstallBanner />

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

      {/* Carte avatar centrée (remplace l'ancien gros logo) */}
      <AvatarCard profile={profile} onEditAvatar={onEditAvatar} onLogout={onLogout} onOpenTrophies={onOpenTrophies} />

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
              un ami
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
                    tap();
                    if (isBusy) {
                      // Ami occupé → on lance direct le mode spectateur.
                      // (Retour de la session : avant on affichait juste
                      // "X est en partie" sans rien faire, c'était frustrant.)
                      if (onWatchFriend) onWatchFriend(f);
                      return;
                    }
                    onQuickInvite && onQuickInvite(f);
                  }}
                  className="flex flex-col items-center clic-press flex-shrink-0"
                  style={{ minWidth: 56, opacity: isBusy ? 0.85 : 1 }}>
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

              {/* Badge mode (coin haut droit) : solo-capable ou multi-only.
                  Aide les enfants/parents à voir d'un coup d'œil ce qui
                  est jouable seul. */}
              <div className="absolute top-3 right-3"
                   style={{
                     background: g.hasSoloMode ? '#D4F5C9' : C.white,
                     color: g.hasSoloMode ? '#2D7A2D' : C.inkSoft,
                     fontFamily: '"Fredoka", sans-serif',
                     fontWeight: 700,
                     fontSize: '0.7rem',
                     padding: '4px 10px',
                     borderRadius: 999,
                     boxShadow: '0 2px 0 rgba(0,0,0,0.06)',
                     letterSpacing: 0.2,
                   }}>
                {g.hasSoloMode ? '🎯 Aussi solo' : '👥 À 2'}
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
            Inviter un ami
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
function InviteToPlayScreen({ profile, gameId, onBack, onInviteFriend, onStartSolo }) {
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

  // Combien d'amis en ligne ? Sert à décider si on highlight le solo
  const onlineFriendCount = useMemo(
    () => friends.filter(f => onlineIds.has(f.id)).length,
    [friends, onlineIds]
  );
  const showSolo = !!(g.hasSoloMode && onStartSolo);
  // Si solo dispo ET personne en ligne → on met le solo en avant
  const soloProminent = showSolo && onlineFriendCount === 0;

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
          {g.title}
        </h2>
      </div>

      {/* CTA solo PROMINENT — quand aucun ami n'est en ligne */}
      {soloProminent && (
        <div className="rounded-3xl p-5 mb-5 text-center"
             style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-4xl mb-2">🎯</div>
          <h3 className="text-lg mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Aucun ami en ligne pour le moment
          </h3>
          <p className="text-xs mb-4" style={{ color: C.inkLight, fontWeight: 600 }}>
            Tu peux jouer en solo en attendant !
          </p>
          <button onClick={() => { tap(); onStartSolo(); }}
            className="w-full py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     fontSize: '1.05rem',
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🚀 Jouer en solo
          </button>
        </div>
      )}

      <h3 className="text-base mb-3 text-center"
          style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
        {soloProminent ? 'Ou invite un ami 🎮' : 'Qui veux-tu inviter ? 🎮'}
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

      {/* Lien solo discret — quand solo dispo mais des amis sont en ligne */}
      {showSolo && !soloProminent && (
        <button onClick={() => { tap(); onStartSolo(); }}
          className="mt-4 mx-auto block text-sm clic-press px-4 py-2 rounded-full"
          style={{ color: C.inkSoft, fontWeight: 700,
                   background: 'rgba(255,255,255,0.6)',
                   fontFamily: '"Fredoka", sans-serif' }}>
          🎯 Ou jouer en solo
        </button>
      )}
    </div>
  );
}

// ============================================================
// REACTION LAYER — communication légère entre joueurs
// ------------------------------------------------------------
// Affiché par-dessus n'importe quel jeu pendant une partie. Fournit :
//   - un bouton flottant 💬 (bas-droite) qui ouvre un panneau
//   - le panneau : 8 emojis réactions + 6 phrases pré-écrites
//   - l'affichage animé d'une réaction reçue (gros emoji / bulle au centre)
//   - un cooldown anti-spam de 2 secondes
// Tout passe par un channel broadcast (éphémère), jamais par room.state,
// pour ne pas interférer avec l'état du jeu.
// ============================================================
const REACTION_EMOJIS = ['👋', '😄', '😮', '👏', '😢', '🎉', '🤔', '❤️'];
const REACTION_PHRASES = [
  'Bien joué ! 👏',
  'À toi de jouer 😊',
  'Oups 😅',
  'GG ! 🎉',
  'Bonne chance ! 🍀',
  'On rejoue ? 🔄',
];
const REACTION_COOLDOWN_MS = 2000;

function ReactionLayer({ roomId, myIndex, players, isSpectator = false, spectatorPseudo = null }) {
  const [open, setOpen] = useState(false);
  const [incoming, setIncoming] = useState(null);  // { kind, content, by, key }
  const [cooldown, setCooldown] = useState(false);
  const channelRef = useRef(null);
  const incomingTimer = useRef(null);

  // Abonnement au channel de réactions de la room
  useEffect(() => {
    if (!roomId) return;
    const sub = subscribeToReactions(roomId, (reaction) => {
      // On ignore nos propres réactions (déjà affichées localement à l'envoi).
      // - Joueur : on se reconnaît par l'index (by === myIndex).
      // - Spectateur (by===2) : plusieurs spectateurs partagent by=2, donc on
      //   se reconnaît par le pseudo envoyé dans reaction.name.
      const isMine = isSpectator
        ? (reaction.by === 2 && reaction.name === spectatorPseudo)
        : (reaction.by === myIndex && !reaction.name);
      if (isMine) return;
      showIncoming(reaction);
    });
    channelRef.current = sub.channel;
    return () => {
      sub.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myIndex, isSpectator, spectatorPseudo]);

  const showIncoming = (reaction) => {
    if (incomingTimer.current) clearTimeout(incomingTimer.current);
    setIncoming({ ...reaction, key: Date.now() });
    playSound('pop');
    incomingTimer.current = setTimeout(() => setIncoming(null), 2200);
  };

  const send = async (kind, content) => {
    if (cooldown) return;
    const reaction = { kind, content, by: myIndex, name: isSpectator ? spectatorPseudo : null };
    await sendReaction(channelRef.current, reaction);
    // Affichage local immédiat (l'autre le verra via broadcast)
    showIncoming(reaction);
    setOpen(false);
    // Cooldown anti-spam
    setCooldown(true);
    setTimeout(() => setCooldown(false), REACTION_COOLDOWN_MS);
  };

  // Nom de l'émetteur : un spectateur a envoyé son pseudo dans reaction.name
  const senderName = (reaction) => {
    if (reaction.name) return `👀 ${reaction.name}`;
    return players[reaction.by]?.pseudo || (reaction.by === 0 ? 'Hôte' : 'Invité');
  };

  return (
    <>
      {/* Réaction reçue / envoyée : overlay animé au centre */}
      {incoming && (
        <div key={incoming.key}
             className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="clic-reaction-pop text-center">
            {incoming.kind === 'phrase' ? (
              <div className="px-5 py-3 rounded-3xl mx-4"
                   style={{ background: C.white, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                            maxWidth: 320 }}>
                <div className="text-xs mb-1" style={{ color: C.inkSoft, fontWeight: 700 }}>
                  {senderName(incoming)}
                </div>
                <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                              color: C.ink, fontSize: '1.3rem' }}>
                  {incoming.content}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '6rem', lineHeight: 1,
                            filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.2))' }}>
                {incoming.content}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bouton flottant : plus parlant qu'une simple bulle 💬.
          On affiche une étiquette "Réagir" à côté de l'icône pour que les
          enfants comprennent tout de suite à quoi ça sert. */}
      <button onClick={() => { tap(); setOpen(v => !v); }}
        className="fixed z-40 clic-press"
        aria-label="Réagir"
        style={{
          right: 'calc(16px + env(safe-area-inset-right))',
          bottom: 'calc(16px + env(safe-area-inset-bottom))',
          height: 52, borderRadius: 999,
          background: C.accentPink,
          color: C.white,
          boxShadow: '0 5px 16px rgba(255,143,177,0.5)',
          fontSize: '1.1rem',
          fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '0 18px',
        }}>
        {open ? (
          <span style={{ fontSize: '1.3rem' }}>✕</span>
        ) : (
          <>
            <span style={{ fontSize: '1.4rem' }}>😄</span>
            <span>Réagir</span>
          </>
        )}
      </button>

      {/* Panneau réactions */}
      {open && (
        <div className="fixed z-40 clic-fade-in"
             style={{
               right: 'calc(16px + env(safe-area-inset-right))',
               bottom: 'calc(84px + env(safe-area-inset-bottom))',
               width: 'min(320px, calc(100vw - 32px))',
               background: C.white,
               borderRadius: 24,
               boxShadow: '0 8px 28px rgba(0,0,0,0.20)',
               padding: 16,
             }}>
          {/* Emojis */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => send('emoji', e)}
                disabled={cooldown}
                className="rounded-2xl clic-press"
                style={{
                  aspectRatio: '1 / 1', fontSize: '1.8rem',
                  background: C.cream,
                  opacity: cooldown ? 0.4 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                {e}
              </button>
            ))}
          </div>
          {/* Phrases */}
          <div className="flex flex-col gap-2">
            {REACTION_PHRASES.map((p) => (
              <button key={p} onClick={() => send('phrase', p)}
                disabled={cooldown}
                className="rounded-2xl px-3 py-2 text-left clic-press text-sm"
                style={{
                  background: C.lavender, color: C.ink,
                  fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                  opacity: cooldown ? 0.4 : 1,
                }}>
                {p}
              </button>
            ))}
          </div>
          {cooldown && (
            <div className="text-xs text-center mt-2" style={{ color: C.inkSoft, fontWeight: 600 }}>
              Attends un instant... ⏳
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Lobby({ profile, room, onLeave, onCancel, onFinished, onRoomUpdate, onChangeGame, isSpectator = false }) {
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

  // === DÉTECTION DU DÉPART DE L'ADVERSAIRE ===========================
  // Deux mécanismes complémentaires :
  //  1. Signal instantané : quand un joueur quitte volontairement, il
  //     broadcaste { kind: 'left' } sur le channel de réactions. L'autre
  //     le reçoit en ~100ms.
  //  2. Filet de sécurité présence : si le joueur ferme brutalement l'appli
  //     (crash, OS qui tue l'onglet), aucun signal n'est envoyé. On surveille
  //     alors sa présence Realtime : s'il disparaît pendant >8s en pleine
  //     partie, on considère qu'il est parti.
  const onlineIds = usePresence();
  const [opponentLeft, setOpponentLeft] = useState(false);
  const leaveChannelRef = useRef(null);

  // Qui est l'adversaire ?
  const opponentId = currentRoom.player1_id === profile.id
    ? currentRoom.player2_id
    : currentRoom.player1_id;

  // Mécanisme 1 : écoute le signal "left" sur le channel de signaux
  // (désactivé pour les spectateurs : ils n'ont pas d'adversaire)
  useEffect(() => {
    if (isSpectator || !ready || !currentRoom.id) return;
    const sub = subscribeToGameSignals(currentRoom.id, (signal) => {
      if (signal.kind === 'left' && signal.byId && signal.byId !== profile.id) {
        setOpponentLeft(true);
      }
    });
    leaveChannelRef.current = sub.channel;
    return () => { sub.unsubscribe(); leaveChannelRef.current = null; };
  }, [isSpectator, ready, currentRoom.id, profile.id]);

  // Mécanisme 2 : filet présence — l'adversaire absent >8s = parti
  useEffect(() => {
    if (isSpectator || !ready || !opponentId) return;
    let timer = null;
    const present = onlineIds.has(opponentId);
    if (!present) {
      // On attend 8s avant de conclure (évite les faux positifs lors d'un
      // simple changement d'onglet ou d'un micro-décrochage réseau)
      timer = setTimeout(() => setOpponentLeft(true), 8000);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [isSpectator, ready, opponentId, onlineIds]);

  // Helper : prévenir l'adversaire qu'on part (signal instantané)
  const broadcastLeave = async () => {
    if (leaveChannelRef.current) {
      await sendGameSignal(leaveChannelRef.current, {
        kind: 'left', byId: profile.id,
      });
    }
  };

  // Wrappers autour de onLeave : on broadcaste AVANT de partir
  const handleLeave = async () => {
    if (!isSpectator) {
      // Un spectateur ne joue pas : pas de signal "left", pas de busy à libérer
      await broadcastLeave();
      try { setBusy(false); } catch {}
    }
    if (onLeave) onLeave();
  };

  return (
    <div className="max-w-md mx-auto px-5 py-8"
         style={{ paddingBottom: ready ? 'calc(88px + env(safe-area-inset-bottom))' : undefined }}>
      {/* paddingBottom quand on joue : laisse de la place pour le bouton
          flottant "Réagir" (fixed bas-droite) afin qu'il ne recouvre pas
          le dernier élément du jeu (ex: la barre d'indice aux échecs). */}
      {/* Bandeau "l'adversaire est parti" — bloque le jeu et propose de sortir */}
      {opponentLeft && ready && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 text-center clic-pop"
               style={{ background: C.white, boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
            <div className="text-5xl mb-3">😢</div>
            <h3 className="text-xl mb-2"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              {(opponentId && profiles[opponentId]?.pseudo) || 'Ton adversaire'} a quitté la partie
            </h3>
            <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
              La partie est terminée. Tu peux revenir à l'accueil.
            </p>
            <button onClick={() => { tap(); if (onFinished) onFinished(); else if (onLeave) onLeave(); }}
              className="w-full py-3 rounded-2xl clic-press"
              style={{ background: C.accentPink, color: C.white,
                       fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                       boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
              🏠 Retour à l'accueil
            </button>
          </div>
        </div>
      )}

      {/* Barre de navigation : Quitter (= annuler la partie en attente) */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={handleLeave} className="px-4 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          {isSpectator ? '← Arrêter de regarder' : '← Quitter'}
        </button>
        {waiting && (
          <WaitingTimer createdAt={currentRoom.created_at} />
        )}
      </div>

      {/* Bandeau spectateur : on regarde, on ne joue pas */}
      {isSpectator && ready && (
        <div className="rounded-2xl p-3 mb-4 flex items-center justify-center gap-2"
             style={{ background: C.lavender, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          <span className="text-xl">👀</span>
          <span style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif',
                         fontSize: '0.95rem' }}>
            Tu regardes {player1?.pseudo || 'Joueur 1'} vs {player2?.pseudo || 'Joueur 2'}
          </span>
        </div>
      )}

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
        const myIndex = isHost ? 0 : 1;
        const gameProps = {
          room: currentRoom,
          profile,
          player1,
          player2,
          onUpdate: updateCurrent,
          onChangeGame: wrappedChangeGame,
          isSpectator,
        };
        const gameView = (() => {
          switch (currentRoom.game) {
            case 'morpion':  return <TicTacToeOnline {...gameProps} />;
            case 'connect4': return <Connect4Online  {...gameProps} />;
            case 'pendu':    return <PenduOnline     {...gameProps} />;
            case 'echecs':   return <EchecsOnline    {...gameProps} />;
            case 'math':     return <MathDuelOnline  {...gameProps} />;
            case 'geo':      return <GeoQuizOnline   {...gameProps} />;
            case 'pfc':      return <PfcOnline       {...gameProps} />;
            case 'course':   return <CourseOnline    {...gameProps} />;
            case 'culture':  return <CultureGOnline  {...gameProps} />;
            case 'motsmeles': return <MotsMelesOnline {...gameProps} />;
            case 'dominos':  return <DominosOnline   {...gameProps} />;
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
        })();
        return (
          <>
            {gameView}
            <ReactionLayer
              roomId={currentRoom.id}
              myIndex={isSpectator ? 2 : myIndex}
              players={[player1, player2]}
              isSpectator={isSpectator}
              spectatorPseudo={profile.pseudo}
            />
          </>
        );
      })()}
    </div>
  );
}


// ============================================================
// RULES SCREEN
// ============================================================
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
// ============================================================
// HOOK : useRecordResult — enregistre le résultat en fin de partie
// ------------------------------------------------------------
// Appelé par chaque jeu. N'enregistre QUE si on est l'hôte (player1) et
// une seule fois par partie (garde anti-doublon local + UNIQUE(room_id)
// côté base). winnerIndex : 0 (J1 gagne), 1 (J2 gagne), 'draw', ou null
// (partie pas finie → ne rien faire).
// Les spectateurs n'enregistrent jamais (isHost est faux pour eux).
// ============================================================
function useRecordResult({ room, isHost, isSpectator, game, winnerIndex }) {
  const recordedRef = useRef(false);
  useEffect(() => {
    if (isSpectator || !isHost) return;
    if (winnerIndex == null) return;           // partie en cours
    if (recordedRef.current) return;           // déjà enregistré ce round
    if (!room?.player1_id || !room?.player2_id) return;

    recordedRef.current = true;
    let winnerId = null;
    if (winnerIndex === 0) winnerId = room.player1_id;
    else if (winnerIndex === 1) winnerId = room.player2_id;
    // 'draw' → winnerId reste null

    recordMatchResult({
      roomId: room.id,
      game,
      player1Id: room.player1_id,
      player2Id: room.player2_id,
      winnerId,
    }).catch(() => {});
  }, [room?.id, isHost, isSpectator, game, winnerIndex]);

  // Quand une nouvelle manche commence (winnerIndex repasse à null), on
  // réarme pour pouvoir enregistrer le prochain résultat (revanche).
  useEffect(() => {
    if (winnerIndex == null) recordedRef.current = false;
  }, [winnerIndex]);
}

// ============================================================
// HOOK : useQuizTimer — chrono partagé pour les quiz (Culture G, Géo, Math)
// ------------------------------------------------------------
// Source de vérité = questionStartedAt (timestamp ms) dans room.state.
// Chaque client calcule le temps restant localement à partir de ce
// timestamp + une horloge locale qui tick toutes les 200ms. Pas de
// dérive : si un client perd quelques rafraîchissements réseau,
// le temps restant reste correct au prochain rendu.
//
// Quand le temps tombe à 0 : on entre en phase "reveal" pendant
// REVEAL_MS ms (on montre la bonne réponse), puis on passe à la question
// suivante (l'hôte écrit la transition, comme pour les autres jeux).
// ============================================================
const QUIZ_QUESTION_MS = 10000;   // 10 secondes par question
const QUIZ_REVEAL_MS = 2000;      // 2s pour montrer la bonne réponse

function useQuizTimer(startedAt, active) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active || startedAt == null) return;
    const t = setInterval(() => force((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [active, startedAt]);
  if (startedAt == null) return { msLeft: QUIZ_QUESTION_MS, expired: false };
  const elapsed = Date.now() - startedAt;
  const msLeft = Math.max(0, QUIZ_QUESTION_MS - elapsed);
  return { msLeft, expired: msLeft === 0 };
}

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
function TicTacToeOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  // Suis-je player 1 (hôte) ou player 2 (invité) ? Spectateur → -1 (ne joue jamais)
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
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

  // Enregistrement du résultat (hôte uniquement). winner symbole → index.
  const ttWinnerIndex = !result ? null
    : (result.winner === 'draw' ? 'draw' : symbols.indexOf(result.winner));
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'morpion', winnerIndex: ttWinnerIndex });

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

// ============================================================
// JEU — PIERRE FEUILLE CISEAUX (PFC) — VERSION ONLINE
// ------------------------------------------------------------
// Les 2 joueurs choisissent EN SECRET. Quand les deux ont choisi, on
// révèle simultanément et on attribue la manche. Premier à 3 manches
// gagnées remporte le match (best-of-5).
//
// Subtilité réseau : le choix de chacun est écrit dans room.state. Tant
// que l'adversaire n'a pas choisi, on n'affiche PAS son choix (on montre
// juste "a choisi / réfléchit"). La révélation se fait quand les 2 choix
// sont présents.
// ============================================================
const PFC_SIGNS = [
  { id: 'rock',     emoji: '✊', label: 'Pierre' },
  { id: 'paper',    emoji: '✋', label: 'Feuille' },
  { id: 'scissors', emoji: '✌️', label: 'Ciseaux' },
];
const PFC_WIN_TARGET = 3;  // premier à 3 manches gagnées

// Qui gagne la manche ? renvoie 0 (J1), 1 (J2) ou 'draw'.
// Règle : pierre>ciseaux, ciseaux>feuille, feuille>pierre.
function pfcRoundWinner(c0, c1) {
  if (c0 === c1) return 'draw';
  const beats = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
  return beats[c0] === c1 ? 0 : 1;
}

function makePfcState() {
  return {
    choices: [null, null],   // choix secret de J1 et J2 pour la manche en cours
    scores: [0, 0],          // manches gagnées
    roundNo: 1,
  };
}

function PfcOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const players = [player1, player2];

  const state = (room.state && room.state.choices) ? room.state : makePfcState();
  const { choices, scores, roundNo } = state;

  // Les 2 ont choisi → on révèle cette manche
  const bothChosen = choices[0] != null && choices[1] != null;
  const roundWinner = bothChosen ? pfcRoundWinner(choices[0], choices[1]) : null;

  // Match terminé ? (premier à 3)
  const matchWinner = scores[0] >= PFC_WIN_TARGET ? 0
    : scores[1] >= PFC_WIN_TARGET ? 1 : null;

  // Effets sonores + enregistrement (seulement à la FIN du match)
  useGameEndEffects(matchWinner, matchWinner === myIndex);
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'pfc', winnerIndex: matchWinner });

  // J'ai déjà choisi pour cette manche ?
  const myChoice = myIndex >= 0 ? choices[myIndex] : null;

  // === Je choisis un signe (secret) ===
  const pickSign = async (signId) => {
    if (isSpectator) return;
    if (matchWinner != null) return;     // match fini
    if (myChoice != null) return;        // déjà choisi cette manche
    if (bothChosen) return;              // manche en cours de révélation
    const newChoices = [...choices];
    newChoices[myIndex] = signId;
    const newState = { ...state, choices: newChoices };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Manche suivante (hôte uniquement, après révélation) ===
  const nextRound = async () => {
    if (myIndex !== 0) return;
    if (!bothChosen) return;
    // On crédite le gagnant de la manche
    let newScores = [...scores];
    if (roundWinner === 0) newScores[0] += 1;
    else if (roundWinner === 1) newScores[1] += 1;
    const newState = {
      choices: [null, null],
      scores: newScores,
      roundNo: roundNo + 1,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Rejouer un match complet (hôte) ===
  const newMatch = async () => {
    if (myIndex !== 0) return;
    const newState = makePfcState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  const signOf = (id) => PFC_SIGNS.find((s) => s.id === id);

  // Bannière d'état
  let banner;
  if (matchWinner != null) {
    banner = `🎉 ${players[matchWinner]?.pseudo || 'Joueur'} remporte le match !`;
  } else if (bothChosen) {
    if (roundWinner === 'draw') banner = '🤝 Égalité ! Personne ne marque.';
    else banner = `✨ ${players[roundWinner]?.pseudo || 'Joueur'} gagne la manche !`;
  } else if (isSpectator) {
    banner = '👀 Les joueurs choisissent...';
  } else if (myChoice != null) {
    banner = `🤫 Tu as choisi ${signOf(myChoice)?.emoji} — on attend ${players[1 - myIndex]?.pseudo || 'l\'autre'}...`;
  } else {
    banner = '👇 Choisis ton signe en secret !';
  }

  return (
    <div>
      {/* Scoreboard */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1].map((i) => {
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-3 rounded-2xl text-center"
              style={{
                background: i === 0 ? C.mint : C.blue,
                outline: matchWinner === i ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {players[i]?.pseudo || '...'} {isMe && !isSpectator && '(toi)'}
              </div>
              <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                {scores[i]}
              </div>
            </div>
          );
        })}
      </div>

      <Banner text={banner}
        color={matchWinner != null || (bothChosen && roundWinner !== 'draw') ? '#6BCB77' : C.accentPink}
        thinking={!isSpectator && myChoice != null && !bothChosen} />

      {/* Zone de révélation : les 2 signes côte à côte */}
      {bothChosen && (
        <div className="grid grid-cols-2 gap-3 mb-4 clic-pop">
          {[0, 1].map((i) => (
            <div key={i} className="p-4 rounded-2xl text-center"
              style={{
                background: C.white,
                boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
                outline: roundWinner === i ? `3px solid #6BCB77` : 'none',
                outlineOffset: '2px',
              }}>
              <div style={{ fontSize: '3.5rem', lineHeight: 1 }}>
                {signOf(choices[i])?.emoji}
              </div>
              <div className="text-xs mt-1" style={{ color: C.inkLight, fontWeight: 700 }}>
                {players[i]?.pseudo || '...'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Boutons de choix (cachés en révélation et pour spectateur) */}
      {!bothChosen && matchWinner == null && !isSpectator && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {PFC_SIGNS.map((sign) => {
            const chosen = myChoice === sign.id;
            const locked = myChoice != null;
            return (
              <button key={sign.id} onClick={() => pickSign(sign.id)}
                disabled={locked}
                className="rounded-2xl flex flex-col items-center justify-center py-5 clic-press transition-all"
                style={{
                  background: chosen ? C.accentPink : C.white,
                  boxShadow: '0 4px 0 rgba(0,0,0,0.08)',
                  opacity: locked && !chosen ? 0.4 : 1,
                }}>
                <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>{sign.emoji}</span>
                <span className="text-xs mt-1"
                      style={{ color: chosen ? C.white : C.ink, fontWeight: 700,
                               fontFamily: '"Fredoka", sans-serif' }}>
                  {sign.label}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Pour le spectateur : on montre où en sont les joueurs sans les signes */}
      {!bothChosen && isSpectator && (
        <div className="rounded-2xl p-4 text-center mb-4"
             style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
          {choices.map((c, i) => (
            <div key={i} className="text-sm py-1">
              {players[i]?.pseudo || '...'} : {c != null ? '✅ a choisi' : '🤔 réfléchit...'}
            </div>
          ))}
        </div>
      )}

      {/* Après une manche révélée (match pas fini) : bouton manche suivante */}
      {bothChosen && matchWinner == null && (
        myIndex === 0 ? (
          <button onClick={nextRound}
            className="w-full py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            Manche suivante →
          </button>
        ) : (
          <div className="rounded-2xl p-3 text-center text-sm"
               style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} lance la manche suivante...
          </div>
        )
      )}

      {/* Match terminé : rejouer / changer de jeu */}
      {matchWinner != null && (
        myIndex === 0 ? (
          <EndGameActions
            onRematch={newMatch}
            onChangeGame={onChangeGame}
            opponentName={players[1]?.pseudo}
          />
        ) : (
          <div className="rounded-2xl p-3 text-center text-sm"
               style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer une partie...
          </div>
        )
      )}
    </div>
  );
}

// ============================================================
// JEU — COURSE AU TRÉSOR — VERSION ONLINE
// ------------------------------------------------------------
// Plateau en ligne de 24 cases (0 = départ, 23 = trésor). À tour de rôle,
// on lance le dé, le pion avance, et l'effet de la case se déclenche.
// Premier au trésor gagne.
//
// Conception réseau : le joueur qui agit calcule TOUT (dé, déplacement,
// effet, position finale, à qui le tour suivant) et écrit l'état final.
// L'autre client anime simplement le pion de l'ancienne à la nouvelle
// position quand il reçoit la mise à jour. L'animation est purement
// visuelle et locale (pas stockée en base).
// ============================================================

// Types de cases et leur effet. Le plateau est FIXE (même pour les 2
// joueurs) pour que la partie soit lisible et équitable.
const COURSE_SIZE = 48;

// Plateau de 48 cases (0 = départ, 47 = trésor). Chaque case a un "type"
// qui déclenche un petit effet. Les échelles 🪜 et serpents 🐍 sont gérés
// à part (ce sont des paires départ→arrivée, voir COURSE_LADDERS/SNAKES).
const COURSE_BOARD = (() => {
  const b = new Array(COURSE_SIZE).fill('normal');
  b[0] = 'start';
  b[COURSE_SIZE - 1] = 'treasure';
  // Cases à effet réparties sur le parcours
  const place = (idx, type) => { if (idx > 0 && idx < COURSE_SIZE - 1) b[idx] = type; };
  place(3, 'forward');   place(7, 'replay');    place(11, 'back');
  place(15, 'surprise'); place(19, 'forward');  place(23, 'skip');
  place(27, 'teleport'); place(31, 'back');     place(35, 'surprise');
  place(39, 'replay');   place(43, 'forward');  place(45, 'back');
  // Cases étoiles à ramasser
  [5, 13, 21, 29, 37, 44].forEach((i) => place(i, 'star'));
  return b;
})();

// Échelles : { caseDépart: caseArrivée } — on monte (arrivée > départ)
const COURSE_LADDERS = { 4: 14, 9: 18, 22: 33, 28: 40 };
// Serpents : { caseTête: caseQueue } — on descend (queue < tête)
const COURSE_SNAKES  = { 17: 6, 25: 12, 34: 20, 42: 30 };

const COURSE_CASE_INFO = {
  start:    { emoji: '🏁', bg: '#D7F5E3' },
  normal:   { emoji: '',   bg: '#FFFFFF' },
  forward:  { emoji: '⏩', bg: '#C5DDF5' },
  back:     { emoji: '⏪', bg: '#FFD0D0' },
  replay:   { emoji: '🔄', bg: '#FFE89E' },
  skip:     { emoji: '⏸️', bg: '#E0D0F0' },
  teleport: { emoji: '🌟', bg: '#DCC5F7' },
  surprise: { emoji: '🎁', bg: '#FFD4B8' },
  star:     { emoji: '⭐', bg: '#FFF3C4' },
  treasure: { emoji: '🏆', bg: '#FFE89E' },
};

const COURSE_PAWNS = ['🐱', '🦊'];  // pion J1, pion J2
const COURSE_DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];  // index 1-6

function makeCourseState() {
  return {
    positions: [0, 0],     // case de chaque pion
    stars: [0, 0],         // étoiles ramassées par chaque joueur
    turn: 0,               // à qui de jouer
    lastRoll: null,        // dernier dé (pour l'afficher)
    lastActor: null,       // qui a lancé le dernier dé (0 | 1)
    skipNext: [false, false],
    winner: null,
    moveSeq: 0,            // incrémente à chaque coup (pour déclencher l'anim)
    lastEffect: null,      // texte du dernier effet (pour le log)
  };
}

// Applique l'effet d'une case. Renvoie { pos, replay, skipOpponent, star, effectText }.
// Les échelles/serpents sont gérés ici aussi (ils priment sur le type de case).
function applyCourseEffect(landedPos) {
  const clamp = (p) => Math.max(0, Math.min(COURSE_SIZE - 1, p));
  const base = { pos: landedPos, replay: false, skipOpponent: false, star: false, effectText: null };

  // Échelle : on grimpe
  if (COURSE_LADDERS[landedPos] != null) {
    return { ...base, pos: COURSE_LADDERS[landedPos], effectText: '🪜 Échelle ! Tu grimpes tout en haut !' };
  }
  // Serpent : on glisse
  if (COURSE_SNAKES[landedPos] != null) {
    return { ...base, pos: COURSE_SNAKES[landedPos], effectText: '🐍 Serpent ! Tu glisses en arrière...' };
  }

  const type = COURSE_BOARD[landedPos];
  switch (type) {
    case 'forward':
      return { ...base, pos: clamp(landedPos + 2), effectText: '⏩ Avance de 2 !' };
    case 'back':
      return { ...base, pos: clamp(landedPos - 3), effectText: '⏪ Recule de 3 !' };
    case 'teleport':
      return { ...base, pos: clamp(landedPos + 4), effectText: '🌟 Téléportation +4 !' };
    case 'replay':
      return { ...base, replay: true, effectText: '🔄 Rejoue !' };
    case 'skip':
      return { ...base, skipOpponent: true, effectText: '⏸️ L\'adversaire passe son tour !' };
    case 'star':
      return { ...base, star: true, effectText: '⭐ Étoile ramassée !' };
    case 'surprise': {
      const options = [
        { pos: clamp(landedPos + 3), effectText: '🎁 Surprise : avance de 3 !' },
        { pos: clamp(landedPos - 2), effectText: '🎁 Surprise : recule de 2 !' },
        { pos: clamp(landedPos + 5), effectText: '🎁 Surprise : bond de 5 !' },
        { pos: landedPos, star: true, effectText: '🎁 Surprise : une étoile ⭐ !' },
      ];
      const pick = options[Math.floor(Math.random() * options.length)];
      return { ...base, pos: pick.pos, star: !!pick.star, effectText: pick.effectText };
    }
    default:
      return base;
  }
}

function CourseOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const players = [player1, player2];

  const state = (room.state && room.state.positions) ? room.state : makeCourseState();
  const { positions, turn, lastRoll, lastActor, skipNext, winner, moveSeq, lastEffect } = state;
  const stars = state.stars || [0, 0];   // compat anciennes parties sans étoiles

  const isMyTurn = !isSpectator && turn === myIndex && winner == null;

  // Position animée du pion (purement visuelle). On part des positions du
  // state et on les rattrape en douceur quand elles changent.
  const [animPos, setAnimPos] = useState(positions);
  const [rolling, setRolling] = useState(false);
  // Écran de règles affiché au début (une fois par entrée dans le jeu).
  // Local à chaque joueur : chacun voit les règles sur son propre appareil.
  const [showRules, setShowRules] = useState(true);
  const lastSeqRef = useRef(moveSeq);

  // Quand le state change (nouveau coup), on anime le(s) pion(s) vers la
  // nouvelle position case par case.
  useEffect(() => {
    if (moveSeq === lastSeqRef.current) {
      // Pas un nouveau coup (montage initial, resync) → on cale directement
      setAnimPos(positions);
      return;
    }
    lastSeqRef.current = moveSeq;

    // On détecte quel pion a bougé et on l'anime
    let cancelled = false;
    (async () => {
      const start = animPos;
      const target = positions;
      // Animation pas-à-pas pour chaque pion qui a changé
      for (let i = 0; i < 2; i++) {
        if (start[i] === target[i]) continue;
        const dir = target[i] > start[i] ? 1 : -1;
        let cur = start[i];
        while (cur !== target[i]) {
          if (cancelled) return;
          cur += dir;
          // eslint-disable-next-line no-loop-func
          setAnimPos((prev) => { const n = [...prev]; n[i] = cur; return n; });
          playSound('pop');
          await new Promise((r) => setTimeout(r, 160));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSeq]);

  useGameEndEffects(winner, winner === myIndex);
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'course', winnerIndex: winner });

  // === Lancer le dé ===
  const rollDie = async () => {
    if (!isMyTurn || rolling) return;
    setRolling(true);

    // Petit suspense visuel sur le dé
    const roll = 1 + Math.floor(Math.random() * 6);
    await new Promise((r) => setTimeout(r, 350));

    // Etape 1 : avancer du nombre de cases, sans dépasser le trésor
    let landed = Math.min(positions[myIndex] + roll, COURSE_SIZE - 1);

    // Etape 2 : si on atteint le trésor, victoire immédiate
    if (landed >= COURSE_SIZE - 1) {
      const newPositions = [...positions];
      newPositions[myIndex] = COURSE_SIZE - 1;
      const newState = {
        ...state,
        positions: newPositions,
        lastRoll: roll,
        lastActor: myIndex,
        winner: myIndex,
        moveSeq: moveSeq + 1,
        lastEffect: '🏆 Trésor atteint !',
      };
      onUpdate({ ...room, state: newState });
      await updateRoomState(room.id, { state: newState });
      setRolling(false);
      return;
    }

    // Etape 3 : appliquer l'effet de la case d'arrivée
    const eff = applyCourseEffect(landed);
    const finalPos = eff.pos;

    // Etape 4 : l'effet peut faire atteindre le trésor aussi
    const reachedTreasure = finalPos >= COURSE_SIZE - 1;

    const newPositions = [...positions];
    newPositions[myIndex] = reachedTreasure ? COURSE_SIZE - 1 : finalPos;

    // Etape 5 : déterminer le tour suivant
    let nextTurn = turn;
    const newSkip = [...skipNext];
    if (!eff.replay) {
      // tour à l'adversaire, sauf si on lui a collé un "passe ton tour"
      nextTurn = 1 - myIndex;
      if (eff.skipOpponent) {
        newSkip[1 - myIndex] = true;
      }
    }
    // Si l'adversaire devait déjà passer son tour, on consomme et on revient à moi
    if (!eff.replay && newSkip[nextTurn]) {
      newSkip[nextTurn] = false;
      nextTurn = myIndex;
    }

    // Étoile ramassée ?
    const newStars = [...stars];
    if (eff.star) newStars[myIndex] += 1;

    const newState = {
      ...state,
      positions: newPositions,
      stars: newStars,
      turn: reachedTreasure ? turn : nextTurn,
      lastRoll: roll,
      lastActor: myIndex,
      skipNext: newSkip,
      winner: reachedTreasure ? myIndex : null,
      moveSeq: moveSeq + 1,
      lastEffect: reachedTreasure ? '🏆 Trésor atteint !' : (eff.effectText || null),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
    setRolling(false);
  };

  // === Rejouer (hôte) ===
  const newGame = async () => {
    if (myIndex !== 0) return;
    const newState = makeCourseState();
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Bannière d'état (le détail du dé + action est dans l'annonce dédiée)
  let banner;
  if (winner != null) {
    banner = `🏆 ${players[winner]?.pseudo || 'Joueur'} trouve le trésor !`;
  } else if (isSpectator) {
    banner = `👀 Au tour de ${players[turn]?.pseudo || 'Joueur'}`;
  } else if (isMyTurn) {
    banner = skipNext[myIndex] ? '⏸️ Tu passes ton tour...' : '🎲 À toi de lancer le dé !';
  } else {
    banner = `⏳ ${players[1 - myIndex]?.pseudo || 'L\'autre'} joue...`;
  }

  // Construction du plateau en serpentin (6 colonnes) pour tenir sur mobile
  const COLS = 6;
  const rows = [];
  for (let r = 0; r * COLS < COURSE_SIZE; r++) {
    let rowCells = [];
    for (let col = 0; col < COLS; col++) {
      const idx = r * COLS + col;
      if (idx < COURSE_SIZE) rowCells.push(idx);
    }
    // Serpentin : on inverse une ligne sur deux pour un vrai chemin continu
    if (r % 2 === 1) rowCells = rowCells.reverse();
    rows.push(rowCells);
  }

  return (
    <div>
      {/* === Écran de règles au démarrage === */}
      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 clic-pop"
               style={{ background: C.white, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                        maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="text-center mb-3">
              <div className="text-5xl mb-1">🎲🏆</div>
              <h3 className="text-xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                Course au trésor
              </h3>
              <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
                Le premier à atteindre le trésor 🏆 gagne !
              </p>
            </div>

            <div className="flex flex-col gap-2 mb-4">
              {[
                { e: '🎲', t: 'Chacun son tour, lance le dé pour avancer.' },
                { e: '🪜', t: 'Échelle : tu grimpes d\'un coup tout en haut !' },
                { e: '🐍', t: 'Serpent : tu glisses en arrière... attention !' },
                { e: '⭐', t: 'Étoile : ramasse-la en passant, collectionne-les !' },
                { e: '⏩', t: 'Case bleue : avance de 2 cases.' },
                { e: '⏪', t: 'Case rose : recule de 3 cases.' },
                { e: '🔄', t: 'Case jaune : tu rejoues tout de suite !' },
                { e: '⏸️', t: 'Case violette : ton adversaire passe son tour.' },
                { e: '🌟', t: 'Téléporteur : bond de 4 cases en avant.' },
                { e: '🎁', t: 'Cadeau : une surprise au hasard !' },
                { e: '🏆', t: 'Le premier au trésor a gagné !' },
              ].map((r, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-xl" style={{ background: C.cream }}>
                  <span className="text-xl" style={{ flexShrink: 0 }}>{r.e}</span>
                  <span className="text-xs" style={{ color: C.ink, fontWeight: 600 }}>{r.t}</span>
                </div>
              ))}
            </div>

            <button onClick={() => { tap(); setShowRules(false); }}
              className="w-full py-3 rounded-2xl clic-press"
              style={{ background: C.accentPink, color: C.white,
                       fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                       boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
              C'est parti ! 🚀
            </button>
          </div>
        </div>
      )}

      {/* Petit bouton "règles" pour les revoir */}
      <div className="flex justify-end mb-2">
        <button onClick={() => { tap(); setShowRules(true); }}
          className="text-xs px-3 py-1 rounded-full clic-press"
          style={{ background: C.white, color: C.inkLight, fontWeight: 700,
                   boxShadow: '0 2px 0 rgba(0,0,0,0.06)' }}>
          ❓ Règles
        </button>
      </div>

      {/* Scoreboard : position de chaque joueur */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[0, 1].map((i) => {
          const isActive = turn === i && winner == null;
          const isMe = i === myIndex;
          return (
            <div key={i} className="p-3 rounded-2xl text-center"
              style={{
                background: i === 0 ? C.peach : C.lavender,
                outline: isActive ? `3px solid ${C.accentPink}` : 'none',
                outlineOffset: '2px',
                boxShadow: '0 4px 0 rgba(0,0,0,0.06)',
              }}>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                {COURSE_PAWNS[i]} {players[i]?.pseudo || '...'} {isMe && !isSpectator && '(toi)'}
              </div>
              <div className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
                Case {animPos[i]} / {COURSE_SIZE - 1}
              </div>
              <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
                ⭐ {stars[i]}
              </div>
            </div>
          );
        })}
      </div>

      {/* === Annonce du dernier lancer : chiffre + action === */}
      {lastRoll && lastActor != null && winner == null && (
        <div key={moveSeq} className="rounded-2xl p-3 mb-4 flex items-center gap-3 clic-pop"
             style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
          <div className="flex items-center justify-center rounded-xl"
               style={{ width: 48, height: 48, background: C.mint, flexShrink: 0 }}>
            <span style={{ fontSize: '2rem', lineHeight: 1 }}>{COURSE_DICE_FACES[lastRoll]}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
              {COURSE_PAWNS[lastActor]} {players[lastActor]?.pseudo || 'Joueur'} a fait {lastRoll} !
            </div>
            {lastEffect && (
              <div className="text-xs" style={{ color: C.accentPink, fontWeight: 700 }}>
                {lastEffect}
              </div>
            )}
          </div>
        </div>
      )}

      <Banner text={banner}
        color={winner != null ? '#6BCB77' : C.accentPink}
        thinking={!isMyTurn && winner == null && !isSpectator} />

      {/* Plateau en serpentin */}
      <div className="rounded-3xl p-3 mb-4" style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.06)' }}>
        {rows.map((rowCells, ri) => (
          <div key={ri} className="grid mb-1" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 4 }}>
            {rowCells.map((idx) => {
              const type = COURSE_BOARD[idx];
              const info = COURSE_CASE_INFO[type];
              const here = [0, 1].filter((p) => animPos[p] === idx);
              // Échelle / serpent partant de cette case ?
              const ladderTo = COURSE_LADDERS[idx];
              const snakeTo = COURSE_SNAKES[idx];
              const special = ladderTo != null ? { emoji: '🪜', bg: '#D7F5E3', to: ladderTo }
                : snakeTo != null ? { emoji: '🐍', bg: '#FFE0E0', to: snakeTo }
                : null;
              const cellBg = special ? special.bg : info.bg;
              const cellEmoji = special ? special.emoji : info.emoji;
              return (
                <div key={idx} className="relative rounded-xl flex items-center justify-center"
                  style={{
                    aspectRatio: '1 / 1',
                    background: cellBg,
                    border: here.length ? `2px solid ${C.accentPink}` : '1px solid rgba(0,0,0,0.06)',
                    fontSize: '1rem',
                  }}>
                  {/* Numéro de case discret en haut à gauche */}
                  <span style={{ position: 'absolute', top: 1, left: 3, fontSize: '0.5rem',
                                 color: C.inkSoft, fontWeight: 700 }}>
                    {idx}
                  </span>
                  {/* Emoji de la case (effet / échelle / serpent) */}
                  {cellEmoji && (
                    <span style={{ opacity: here.length ? 0.3 : 0.9 }}>{cellEmoji}</span>
                  )}
                  {/* Destination d'une échelle/serpent (petit numéro) */}
                  {special && !here.length && (
                    <span style={{ position: 'absolute', bottom: 1, right: 3, fontSize: '0.5rem',
                                   color: ladderTo != null ? '#3A9B6B' : '#C44', fontWeight: 700 }}>
                      →{special.to}
                    </span>
                  )}
                  {/* Pions présents sur la case */}
                  {here.length > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center"
                         style={{ fontSize: here.length > 1 ? '0.85rem' : '1.3rem' }}>
                      {here.map((p) => COURSE_PAWNS[p]).join('')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Dé + bouton lancer */}
      {winner == null && !isSpectator && (
        <button onClick={rollDie}
          disabled={!isMyTurn || rolling}
          className="w-full py-4 rounded-2xl clic-press flex items-center justify-center gap-3"
          style={{
            background: isMyTurn && !rolling ? C.accentPink : '#E0DAD2',
            color: isMyTurn && !rolling ? C.white : C.inkSoft,
            fontFamily: '"Fredoka", sans-serif', fontWeight: 700, fontSize: '1.1rem',
            boxShadow: '0 4px 0 rgba(0,0,0,0.10)',
          }}>
          <span style={{ fontSize: '1.6rem' }}>🎲</span>
          {rolling ? 'Lancement...' : 'Lancer le dé'}
        </button>
      )}

      {/* Fin de partie */}
      {winner != null && (
        myIndex === 0 ? (
          <EndGameActions
            onRematch={newGame}
            onChangeGame={onChangeGame}
            opponentName={players[1]?.pseudo}
          />
        ) : (
          <div className="rounded-2xl p-3 text-center text-sm"
               style={{ background: 'rgba(255,255,255,0.6)', color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer une partie...
          </div>
        )
      )}
    </div>
  );
}

// Dimensions standard du Puissance 4 : 6 lignes × 7 colonnes.
// BUG FIX : ces constantes étaient utilisées dans makeC4Board(),
// checkConnect4Winner() et la logique de chute des pions, mais n'avaient
// jamais été définies → ReferenceError: C4_ROWS is not defined → le
// Puissance 4 plantait dès la création/acceptation d'une partie.
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
function Connect4Online({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
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

  // Enregistrement du résultat (hôte uniquement)
  const c4WinnerIndex = !result ? null
    : (result.winner === 'draw' ? 'draw' : symbols.indexOf(result.winner));
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'connect4', winnerIndex: c4WinnerIndex });

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

// Position de départ standard des échecs. On la dérive directement de
// chess.js (new Chess().fen()) plutôt que de la coder en dur, ce qui
// garantit zéro risque de typo et une compatibilité parfaite avec la
// version de chess.js utilisée.
// BUG FIX : cette constante était référencée dans makeEchecsState() mais
// n'avait jamais été définie → Reference: STARTING_FEN is not defined →
// le composant Échecs plantait dès qu'une room sans state était ouverte
// (c.-à-d. à chaque acceptation de partie, car la room est créée avec
// initialState: {}).
const STARTING_FEN = new Chess().fen();

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
function EchecsOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
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
  const isMyTurn = !isSpectator && turnColor === myColor && verifiedWinner == null;

  // Effets de fin (sons + confettis) — utilise verifiedWinner, et bonne comparaison index/index
  useGameEndEffects(verifiedWinner, verifiedWinner === myIndex);
  useMyTurnEffect(isMyTurn, verifiedWinner != null);

  // Enregistrement du résultat (hôte uniquement). verifiedWinner est déjà
  // 0 | 1 | 'draw' | null → format direct attendu par le hook.
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'echecs', winnerIndex: verifiedWinner });

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
// phase: 'theme-select' (le "setter" du tour choisit un thème) | 'guessing' | 'win' | 'lose'
// round : compteur de manches (incrémenté à chaque "Revanche")
// On ne stocke PAS le mot en clair dans state : seulement le thème + l'index.
// Chaque client résout le mot localement via WORDS_JSON. Ça évite que quelqu'un
// qui sniffe le réseau (ou un parent qui ouvre Supabase) voie le mot.
function makePenduState(round = 1) {
  return {
    phase: 'theme-select',
    theme: null,       // 'animaux' | 'ecole' | ...
    wordIdx: null,     // index dans WORDS_JSON.themes[theme].words
    guessed: [],
    round,             // 1, 2, 3... incrémenté à chaque manche
  };
}

// Qui choisit le thème (= le "setter") pour ce round ?
//   round 1 → hôte (player1_id, index 0)
//   round 2 → invité (player2_id, index 1)
//   et ainsi de suite, par alternance.
// Le devineur est forcément l'autre.
function penduSetterIndex(round) {
  return ((round || 1) - 1) % 2;  // 1→0, 2→1, 3→0, 4→1...
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
function PenduOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
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

  // Rôles du tour : qui choisit le thème, qui devine. Alterne chaque round.
  const setterIndex  = penduSetterIndex(state.round);
  const guesserIndex = 1 - setterIndex;
  const iAmSetter    = myIndex === setterIndex;
  const iAmGuesser   = myIndex === guesserIndex;

  // Effets de fin — le devineur gagne si 'win', le setter gagne si 'lose'
  const penduWinner  = phase === 'win' ? 'guesser' : phase === 'lose' ? 'setter' : null;
  const didIWinPendu = (phase === 'win' && iAmGuesser) || (phase === 'lose' && iAmSetter);
  useGameEndEffects(penduWinner, didIWinPendu);

  // Enregistrement du résultat (hôte uniquement). Le pendu n'a pas de match
  // nul : soit le devineur trouve (il gagne), soit il échoue (le setter gagne).
  const penduWinnerIndex = phase === 'win' ? guesserIndex
    : phase === 'lose' ? setterIndex : null;
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'pendu', winnerIndex: penduWinnerIndex });

  // Le SETTER du tour choisit un thème → on tire un index au hasard et on passe en phase guessing
  const pickTheme = async (themeId) => {
    if (!iAmSetter) return;
    const theme = WORDS_JSON.themes[themeId];
    if (!theme) return;
    const wordIdx = Math.floor(Math.random() * theme.words.length);
    const newState = { ...state, phase: 'guessing', theme: themeId, wordIdx, guessed: [] };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Le GUESSER du tour propose une lettre
  const guessLetter = async (L) => {
    if (phase !== 'guessing' || guessed.includes(L)) return;
    if (!iAmGuesser) return;  // seul le devineur du tour peut jouer

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

  // Rejouer : seul l'hôte peut relancer (convention : il gère le cycle de vie
  // du salon). Le round s'incrémente → les rôles s'inversent automatiquement.
  const newGame = async () => {
    if (!isHost) return;
    const newState = makePenduState((state.round || 1) + 1);
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : Le setter du tour choisit un thème ===
  if (phase === 'theme-select' && iAmSetter) {
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
            Un mot sera tiré au hasard — {players[guesserIndex]?.pseudo || 'ton ami'} devra deviner
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

  // === ÉCRAN 1 bis : le guesser attend que le setter choisisse ===
  if (phase === 'theme-select' && !iAmSetter) {
    return (
      <div className="rounded-3xl p-8 text-center" style={{ background: C.peach, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[setterIndex]?.pseudo || 'Ton ami'} choisit un thème.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : victoire ou défaite ===
  if (phase === 'win' || phase === 'lose') {
    const isWin = phase === 'win';
    // Si 'win' → c'est le devineur (guesser) qui a gagné
    // Si 'lose' → c'est le setter qui a gagné (le devineur n'a pas trouvé)
    const winnerPseudo = isWin
      ? (players[guesserIndex]?.pseudo || 'Le devineur')
      : (players[setterIndex]?.pseudo || 'Ton ami');
    const themeMeta = state.theme ? WORDS_JSON.themes[state.theme] : null;
    // L'opposant à montrer dans "Autre jeu avec ..." = l'autre joueur que moi
    const opponentForChange = isHost ? players[1] : players[0];
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
              opponentName={opponentForChange?.pseudo}
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
  const isMyTurn = iAmGuesser;  // seul le devineur du tour joue

  return (
    <div>
      <Banner text={
        iAmSetter
          ? `🔍 ${players[guesserIndex]?.pseudo || 'Le devineur'} cherche`
          : `❤️ ${PENDU_MAX_WRONG - wrongCount} vies restantes`
      } color={wrongCount >= 4 ? '#FF8FB1' : C.accentPink}
        thinking={iAmSetter} />

      <div className="rounded-3xl p-4 mb-4 flex items-center justify-center"
           style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <Hangman wrongCount={wrongCount} />
      </div>

      <div className="rounded-2xl p-5 mb-4 text-center"
           style={{ background: C.peach, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-3xl tracking-widest"
             style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {/* Pour J1 : on affiche le mot complet (il le connait déjà) */}
          {/* Le setter du tour voit le mot en clair, le guesser voit le masque */}
          {iAmSetter ? word.toUpperCase() : display}
        </div>
        {iAmSetter && (
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

// ============================================================
// JEU 5 — MATH DUEL (online uniquement)
// ============================================================
// Mécanique :
//   1. L'hôte choisit un niveau (facile/moyen/difficile)
//   2. 10 questions QCM générées d'un coup au moment du level-select
//   3. Les 2 joueurs voient la même question en même temps
//   4. Premier à taper la BONNE réponse marque 1 point + on passe à la suivante
//   5. Mauvaise réponse = rien, on peut re-tenter (mais l'autre a déjà
//      probablement gagné le point)
//   6. À la fin : score affiché, host peut "Revanche" (= nouvelles questions
//      même niveau) ou "Autre jeu"
//
// Approche réseau simple : last-write-wins. Quand un joueur tape la bonne
// réponse, son client incrémente son score localement + push immédiatement
// state.scores[i] = newScore, state.currentIdx = idx + 1. L'autre client
// reçoit la mise à jour via Realtime et voit "trop tard" (la question a
// avancé). Si les 2 tapent dans la même milliseconde, Supabase tranche par
// l'ordre d'arrivée des UPDATE — un des deux gagne, c'est OK.
// ============================================================

// Génère N opérations selon le niveau
function makeMathQuestions(level, count = 10) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    questions.push(generateOneQuestion(level));
  }
  return questions;
}

// Génère 1 question avec 4 choix (1 bon + 3 leurres)
function generateOneQuestion(level) {
  let a, b, op, answer;
  if (level === 'facile') {
    // + et − jusqu'à 20 (résultat positif garanti)
    op = Math.random() < 0.5 ? '+' : '-';
    if (op === '+') {
      a = 1 + Math.floor(Math.random() * 15);
      b = 1 + Math.floor(Math.random() * (20 - a));
      answer = a + b;
    } else {
      a = 5 + Math.floor(Math.random() * 16);  // 5..20
      b = 1 + Math.floor(Math.random() * (a - 1));  // < a
      answer = a - b;
    }
  } else if (level === 'moyen') {
    // +, -, × jusqu'à 100 (résultat positif)
    const ops = ['+', '-', '×'];
    op = ops[Math.floor(Math.random() * ops.length)];
    if (op === '+') {
      a = 10 + Math.floor(Math.random() * 50);
      b = 10 + Math.floor(Math.random() * 40);
      answer = a + b;
    } else if (op === '-') {
      a = 30 + Math.floor(Math.random() * 60);
      b = 5 + Math.floor(Math.random() * (a - 5));
      answer = a - b;
    } else {
      a = 2 + Math.floor(Math.random() * 9);  // 2..10
      b = 2 + Math.floor(Math.random() * 9);
      answer = a * b;
    }
  } else {
    // difficile : ×, ÷ jusqu'à 100
    const ops = ['×', '÷', '+'];
    op = ops[Math.floor(Math.random() * ops.length)];
    if (op === '×') {
      a = 3 + Math.floor(Math.random() * 10);  // 3..12
      b = 3 + Math.floor(Math.random() * 10);
      answer = a * b;
    } else if (op === '÷') {
      // On garantit un résultat entier : on construit answer * b = a
      b = 2 + Math.floor(Math.random() * 10);
      answer = 2 + Math.floor(Math.random() * 12);
      a = b * answer;
    } else {
      a = 25 + Math.floor(Math.random() * 70);
      b = 25 + Math.floor(Math.random() * 70);
      answer = a + b;
    }
  }
  // Génère 3 leurres autour de la bonne réponse, jamais identiques
  const decoys = new Set();
  while (decoys.size < 3) {
    const delta = (1 + Math.floor(Math.random() * 8)) * (Math.random() < 0.5 ? -1 : 1);
    const cand = answer + delta;
    if (cand > 0 && cand !== answer) decoys.add(cand);
  }
  const choices = [...decoys, answer].sort(() => Math.random() - 0.5);
  return { a, b, op, answer, choices };
}

function makeMathState() {
  return {
    phase: 'level-select',
    level: null,
    questions: [],
    currentIdx: 0,
    scores: [0, 0],
    lastTapBy: null,   // qui vient de bien répondre (pour micro-feedback visuel)
    round: 1,
    questionStartedAt: null,  // ms : début de la question courante
    reveal: false,            // true = on montre la bonne réponse 2s
    revealUntil: null,        // ms : fin de la phase reveal
  };
}

function MathDuelOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makeMathState();
  const { phase, level, questions, currentIdx, scores, questionStartedAt, reveal, revealUntil } = state;

  // Feedback visuel local : quand je tape une mauvaise réponse, je veux que MON
  // bouton flashe rouge, sans affecter l'état partagé (l'autre joueur n'a pas
  // besoin de voir mes erreurs)
  const [wrongTap, setWrongTap] = useState(null);
  useEffect(() => {
    if (wrongTap == null) return;
    const t = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(t);
  }, [wrongTap]);

  // Chrono partagé (10s par question)
  const timerActive = phase === 'playing' && !reveal;
  const { msLeft, expired } = useQuizTimer(questionStartedAt, timerActive);

  // Effets de fin de partie
  const finalWinner = phase === 'done'
    ? (scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : 'draw')
    : null;
  useGameEndEffects(finalWinner, finalWinner === myIndex);

  // Enregistrement du résultat (hôte uniquement)
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'math', winnerIndex: finalWinner });

  // Timeout → reveal (hôte)
  useEffect(() => {
    if (!isHost || !timerActive || !expired) return;
    const newState = { ...state, reveal: true, revealUntil: Date.now() + QUIZ_REVEAL_MS };
    onUpdate({ ...room, state: newState });
    updateRoomState(room.id, { state: newState }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, timerActive, expired]);

  // Fin de reveal → question suivante (hôte)
  useEffect(() => {
    if (!isHost || !reveal || revealUntil == null) return;
    const remaining = revealUntil - Date.now();
    if (remaining <= 0) { advanceAfterReveal(); return; }
    const t = setTimeout(advanceAfterReveal, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, reveal, revealUntil]);

  const advanceAfterReveal = async () => {
    const nextIdx = currentIdx + 1;
    const done = nextIdx >= questions.length;
    const newState = {
      ...state,
      currentIdx: nextIdx,
      phase: done ? 'done' : 'playing',
      reveal: false,
      revealUntil: null,
      questionStartedAt: done ? null : Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  const pickLevel = async (lvl) => {
    if (!isHost) return;
    const newState = {
      ...state,
      phase: 'playing',
      level: lvl,
      questions: makeMathQuestions(lvl),
      currentIdx: 0,
      scores: [0, 0],
      questionStartedAt: Date.now(),
      reveal: false,
      revealUntil: null,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Un joueur tape une réponse ===
  const tapAnswer = async (choice) => {
    if (isSpectator) return;        // un spectateur ne répond pas
    if (phase !== 'playing' || reveal) return;
    const q = questions[currentIdx];
    if (!q) return;
    if (choice !== q.answer) {
      // Mauvaise réponse → flash rouge local, pas de changement d'état partagé
      setWrongTap(choice);
      playSound('pop');
      vibrate(30);
      return;
    }
    // Bonne réponse → marque + on entre en reveal (2s) avant question suivante
    playSound('pop');
    vibrate(50);
    const newScores = [...scores];
    newScores[myIndex] += 1;
    const newState = {
      ...state,
      scores: newScores,
      lastTapBy: myIndex,
      reveal: true,
      revealUntil: Date.now() + QUIZ_REVEAL_MS,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Revanche (host uniquement) — nouvelles questions, même niveau ===
  const newGame = async () => {
    if (!isHost) return;
    const newState = {
      ...makeMathState(),
      phase: 'playing',
      level,
      questions: makeMathQuestions(level || 'facile'),
      round: (state.round || 1) + 1,
      questionStartedAt: Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : choix du niveau (hôte) ===
  if (phase === 'level-select' && isHost) {
    const levels = [
      { id: 'facile', label: 'Facile', emoji: '🌱', desc: '+ et − jusqu\'à 20' },
      { id: 'moyen', label: 'Moyen', emoji: '⚡', desc: '+, −, × jusqu\'à 100' },
      { id: 'difficile', label: 'Difficile', emoji: '🔥', desc: '×, ÷ jusqu\'à 100' },
    ];
    return (
      <div className="rounded-3xl p-5" style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-center mb-4">
          <div className="text-5xl mb-2">🎚️</div>
          <h3 className="text-2xl"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Choisis un niveau
          </h3>
          <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
            10 questions, le plus rapide à toucher la bonne réponse marque
          </p>
        </div>
        <div className="space-y-3">
          {levels.map((lvl) => (
            <button key={lvl.id} onClick={() => pickLevel(lvl.id)}
              className="w-full p-4 rounded-2xl clic-press flex items-center gap-3 text-left"
              style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
              <div className="text-3xl">{lvl.emoji}</div>
              <div className="flex-1">
                <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                              color: C.ink, fontSize: '1.05rem' }}>
                  {lvl.label}
                </div>
                <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
                  {lvl.desc}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // === ÉCRAN 1 bis : invité attend que l'hôte choisisse ===
  if (phase === 'level-select' && !isHost) {
    return (
      <div className="rounded-3xl p-8 text-center" style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[0]?.pseudo || 'L\'hôte'} choisit un niveau.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : résultat final ===
  if (phase === 'done') {
    const isDraw = finalWinner === 'draw';
    const isMyWin = finalWinner === myIndex;
    const opponentForChange = isHost ? players[1] : players[0];
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: isDraw ? C.lavender : (isMyWin ? C.mint : C.pink),
        boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">
          <span className="clic-celebrate">{isDraw ? '🤝' : (isMyWin ? '🎉' : '😢')}</span>
        </div>
        <h3 className="text-3xl mb-3" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {isDraw ? 'Égalité !' : `${players[finalWinner]?.pseudo || 'Joueur'} gagne !`}
        </h3>
        <div className="flex items-center justify-around mb-4">
          <div className="text-center">
            <div className="text-2xl mb-1">{players[0]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[0]?.pseudo || 'Hôte'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[0]}
            </div>
          </div>
          <div className="text-2xl" style={{ color: C.inkSoft }}>vs</div>
          <div className="text-center">
            <div className="text-2xl mb-1">{players[1]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[1]?.pseudo || 'Invité'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[1]}
            </div>
          </div>
        </div>
        {isHost ? (
          <EndGameActions
            onRematch={newGame}
            onChangeGame={onChangeGame}
            opponentName={opponentForChange?.pseudo}
          />
        ) : (
          <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer...
          </div>
        )}
      </div>
    );
  }

  // === ÉCRAN 3 : jeu en cours — la question + les 4 choix ===
  const q = questions[currentIdx];
  if (!q) return null;  // garde-fou

  return (
    <div>
      {/* Banner avec le score live */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-around"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[0]?.pseudo || 'Hôte'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 0 ? C.accentPink : C.ink }}>
            {scores[0]}
          </div>
        </div>
        <div className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
          {currentIdx + 1} / {questions.length}
        </div>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[1]?.pseudo || 'Invité'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 1 ? C.accentPink : C.ink }}>
            {scores[1]}
          </div>
        </div>
      </div>

      {/* Chrono : barre 10s */}
      <div className="rounded-full mb-3 overflow-hidden"
           style={{ height: 8, background: 'rgba(0,0,0,0.06)' }}>
        <div style={{
          height: '100%',
          width: `${reveal ? 0 : Math.round((msLeft / QUIZ_QUESTION_MS) * 100)}%`,
          background: reveal ? '#6BCB77'
            : msLeft < 3000 ? C.accentPink
            : C.mint,
          transition: 'width 0.2s linear, background 0.3s',
        }} />
      </div>

      {/* La question, gros et centré */}
      <div className="rounded-3xl p-8 mb-4 text-center"
           style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                      color: C.ink, fontSize: '3rem', lineHeight: 1.1 }}>
          {q.a} {q.op} {q.b} = ?
        </div>
        {reveal && (
          <div className="text-sm mt-3" style={{ color: '#3A9B6B', fontWeight: 700 }}>
            ✓ Bonne réponse : {q.answer}
          </div>
        )}
      </div>

      {/* 4 boutons QCM */}
      <div className="grid grid-cols-2 gap-3">
        {q.choices.map((c, i) => {
          const isWrong = wrongTap === c;
          const isCorrectReveal = reveal && c === q.answer;
          return (
            <button key={i} onClick={() => tapAnswer(c)}
              disabled={reveal}
              className="rounded-2xl p-5 clic-press"
              style={{
                background: isCorrectReveal ? '#D4F5E0' : isWrong ? '#FFD0D0' : C.white,
                color: C.ink,
                fontFamily: '"Fredoka", sans-serif',
                fontWeight: 700, fontSize: '1.6rem',
                boxShadow: isCorrectReveal ? '0 3px 0 rgba(60,160,90,0.3)'
                  : isWrong ? '0 3px 0 rgba(200,0,0,0.2)'
                  : '0 4px 0 rgba(0,0,0,0.08)',
                outline: isCorrectReveal ? '2px solid #6BCB77' : 'none',
                transition: 'background 0.2s',
                opacity: reveal && !isCorrectReveal ? 0.5 : 1,
              }}>
              {isCorrectReveal && '✓ '}{c}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// JEU 6 — GÉO QUIZ ONLINE (multi)
// ============================================================
// Même mécanique que MathDuelOnline : 10 questions, simultané, 1er à
// toucher la bonne réponse marque. Pas de niveau (un seul "niveau" en V1,
// avec les ~60 pays curés via GEO_CURATED_CODES).
//
// Différence avec MathDuelOnline : pas d'écran "level-select". Au montage,
// l'hôte appuie sur "Commencer la partie" pour générer les 10 questions
// (qui sont ensuite poussées dans state, donc identiques pour les 2
// joueurs).
// ============================================================

function makeGeoState() {
  return {
    phase: 'ready',      // 'ready' | 'playing' | 'done'
    questions: [],
    currentIdx: 0,
    scores: [0, 0],
    lastTapBy: null,
    round: 1,
    questionStartedAt: null,
    reveal: false,
    revealUntil: null,
  };
}

function GeoQuizOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makeGeoState();
  const { phase, questions, currentIdx, scores, questionStartedAt, reveal, revealUntil } = state;

  // Feedback visuel local (mauvaise réponse)
  const [wrongTap, setWrongTap] = useState(null);
  useEffect(() => {
    if (wrongTap == null) return;
    const t = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(t);
  }, [wrongTap]);

  // Chrono partagé (10s par question)
  const timerActive = phase === 'playing' && !reveal;
  const { msLeft, expired } = useQuizTimer(questionStartedAt, timerActive);

  // Effets de fin de partie
  const finalWinner = phase === 'done'
    ? (scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : 'draw')
    : null;
  useGameEndEffects(finalWinner, finalWinner === myIndex);

  // Enregistrement du résultat (hôte uniquement)
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'geo', winnerIndex: finalWinner });

  // Timeout → reveal (hôte)
  useEffect(() => {
    if (!isHost || !timerActive || !expired) return;
    const newState = { ...state, reveal: true, revealUntil: Date.now() + QUIZ_REVEAL_MS };
    onUpdate({ ...room, state: newState });
    updateRoomState(room.id, { state: newState }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, timerActive, expired]);

  // Fin de reveal → question suivante (hôte)
  useEffect(() => {
    if (!isHost || !reveal || revealUntil == null) return;
    const remaining = revealUntil - Date.now();
    if (remaining <= 0) { advanceAfterReveal(); return; }
    const t = setTimeout(advanceAfterReveal, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, reveal, revealUntil]);

  const advanceAfterReveal = async () => {
    const nextIdx = currentIdx + 1;
    const done = nextIdx >= questions.length;
    const newState = {
      ...state,
      currentIdx: nextIdx,
      phase: done ? 'done' : 'playing',
      reveal: false,
      revealUntil: null,
      questionStartedAt: done ? null : Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Démarrer la partie (hôte) ===
  const startGame = async () => {
    if (!isHost) return;
    const newState = {
      ...state,
      phase: 'playing',
      questions: makeGeoQuestions(10),
      currentIdx: 0,
      scores: [0, 0],
      questionStartedAt: Date.now(),
      reveal: false,
      revealUntil: null,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Un joueur tape une réponse ===
  const tapAnswer = async (choice) => {
    if (isSpectator) return;
    if (phase !== 'playing' || reveal) return;
    const q = questions[currentIdx];
    if (!q) return;
    if (choice !== q.answer) {
      setWrongTap(choice);
      playSound('pop');
      vibrate(30);
      return;
    }
    playSound('pop');
    vibrate(50);
    const newScores = [...scores];
    newScores[myIndex] += 1;
    const newState = {
      ...state,
      scores: newScores,
      lastTapBy: myIndex,
      reveal: true,
      revealUntil: Date.now() + QUIZ_REVEAL_MS,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Revanche (host) ===
  const newGame = async () => {
    if (!isHost) return;
    const newState = {
      ...makeGeoState(),
      phase: 'playing',
      questions: makeGeoQuestions(10),
      round: (state.round || 1) + 1,
      questionStartedAt: Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : "Commencer" pour l'hôte, "En attente" pour l'invité ===
  if (phase === 'ready') {
    if (isHost) {
      return (
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">🌍</div>
          <h3 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Géo Quiz
          </h3>
          <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            10 questions sur les drapeaux et capitales du monde.
            <br />Le 1er à toucher la bonne réponse marque !
          </p>
          <button onClick={startGame} className="px-6 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     fontSize: '1.05rem',
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🚀 Commencer la partie
          </button>
        </div>
      );
    } else {
      return (
        <div className="rounded-3xl p-8 text-center"
             style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">⏳</div>
          <h3 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            En attente...
          </h3>
          <p style={{ color: C.inkLight, fontWeight: 600 }}>
            {players[0]?.pseudo || 'L\'hôte'} lance la partie.
          </p>
        </div>
      );
    }
  }

  // === ÉCRAN 2 : résultat final ===
  if (phase === 'done') {
    const isDraw = finalWinner === 'draw';
    const isMyWin = finalWinner === myIndex;
    const opponentForChange = isHost ? players[1] : players[0];
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: isDraw ? C.lavender : (isMyWin ? C.mint : C.pink),
        boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">
          <span className="clic-celebrate">{isDraw ? '🤝' : (isMyWin ? '🎉' : '😢')}</span>
        </div>
        <h3 className="text-3xl mb-3"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {isDraw ? 'Égalité !' : `${players[finalWinner]?.pseudo || 'Joueur'} gagne !`}
        </h3>
        <div className="flex items-center justify-around mb-4">
          <div className="text-center">
            <div className="text-2xl mb-1">{players[0]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[0]?.pseudo || 'Hôte'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[0]}
            </div>
          </div>
          <div className="text-2xl" style={{ color: C.inkSoft }}>vs</div>
          <div className="text-center">
            <div className="text-2xl mb-1">{players[1]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[1]?.pseudo || 'Invité'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[1]}
            </div>
          </div>
        </div>
        {isHost ? (
          <EndGameActions
            onRematch={newGame}
            onChangeGame={onChangeGame}
            opponentName={opponentForChange?.pseudo}
          />
        ) : (
          <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer...
          </div>
        )}
      </div>
    );
  }

  // === ÉCRAN 3 : jeu en cours ===
  const q = questions[currentIdx];
  if (!q) return null;

  return (
    <div>
      {/* Score live */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-around"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[0]?.pseudo || 'Hôte'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 0 ? C.accentPink : C.ink }}>
            {scores[0]}
          </div>
        </div>
        <div className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
          {currentIdx + 1} / {questions.length}
        </div>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[1]?.pseudo || 'Invité'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 1 ? C.accentPink : C.ink }}>
            {scores[1]}
          </div>
        </div>
      </div>

      {/* Chrono : barre 10s */}
      <div className="rounded-full mb-3 overflow-hidden"
           style={{ height: 8, background: 'rgba(0,0,0,0.06)' }}>
        <div style={{
          height: '100%',
          width: `${reveal ? 0 : Math.round((msLeft / QUIZ_QUESTION_MS) * 100)}%`,
          background: reveal ? '#6BCB77'
            : msLeft < 3000 ? C.accentPink
            : C.lavender,
          transition: 'width 0.2s linear, background 0.3s',
        }} />
      </div>

      {/* Prompt (drapeau géant ou nom de pays) */}
      <div className="rounded-3xl p-6 mb-4 text-center"
           style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-sm mb-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
          {q.promptLabel}
        </div>
        <div style={{
          fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
          color: C.ink,
          fontSize: q.type === 'flag' ? '5rem' : '1.8rem',
          lineHeight: 1.1,
        }}>
          {q.prompt}
        </div>
        {reveal && (
          <div className="text-sm mt-3" style={{ color: '#3A9B6B', fontWeight: 700 }}>
            ✓ Bonne réponse : {q.answer}
          </div>
        )}
      </div>

      {/* 4 réponses en colonne */}
      <div className="flex flex-col gap-3">
        {q.choices.map((c, i) => {
          const isWrong = wrongTap === c;
          const isCorrectReveal = reveal && c === q.answer;
          return (
            <button key={i} onClick={() => tapAnswer(c)}
              disabled={reveal}
              className="rounded-2xl px-4 py-4 clic-press text-left"
              style={{
                background: isCorrectReveal ? '#D4F5E0' : isWrong ? '#FFD0D0' : C.white,
                color: C.ink,
                fontFamily: '"Fredoka", sans-serif',
                fontWeight: 700, fontSize: '1.05rem',
                boxShadow: isCorrectReveal ? '0 3px 0 rgba(60,160,90,0.3)'
                  : isWrong ? '0 3px 0 rgba(200,0,0,0.2)'
                  : '0 4px 0 rgba(0,0,0,0.08)',
                outline: isCorrectReveal ? '2px solid #6BCB77' : 'none',
                transition: 'background 0.2s',
                opacity: reveal && !isCorrectReveal ? 0.5 : 1,
              }}>
              {isCorrectReveal && '✓ '}{c}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ============================================================
// JEU — CULTURE G — VERSION ONLINE (10-12 ans)
// ------------------------------------------------------------
// Quiz QCM calqué sur Géo Quiz : 10 questions tirées au hasard dans la
// banque culture.json (~100 questions, plusieurs catégories). Le 1er à
// toucher la bonne réponse marque. Meilleur score sur 10 gagne.
// ============================================================

// Mélange un tableau (Fisher-Yates) sans modifier l'original
function cultureShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Tire `count` questions au hasard, avec leurs choix mélangés.
function makeCultureQuestions(count = 10) {
  const picked = cultureShuffle(CULTURE_JSON).slice(0, count);
  return picked.map((item) => ({
    promptLabel: item.cat,
    prompt: item.q,
    choices: cultureShuffle(item.choices),
    answer: item.answer,
  }));
}

function makeCultureState() {
  return {
    phase: 'ready',          // 'ready' | 'playing' | 'done'
    questions: [],
    currentIdx: 0,
    scores: [0, 0],
    lastTapBy: null,
    round: 1,
    questionStartedAt: null, // ms timestamp partagé pour le chrono
    reveal: false,           // true = on montre la bonne réponse (entre 2 questions)
    revealUntil: null,       // ms timestamp : fin de la phase reveal
  };
}

function CultureGOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makeCultureState();
  const { phase, questions, currentIdx, scores, questionStartedAt, reveal, revealUntil } = state;

  const [wrongTap, setWrongTap] = useState(null);
  useEffect(() => {
    if (wrongTap == null) return;
    const t = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(t);
  }, [wrongTap]);

  // Chrono partagé (10s par question), actif pendant 'playing' hors reveal
  const timerActive = phase === 'playing' && !reveal;
  const { msLeft, expired } = useQuizTimer(questionStartedAt, timerActive);

  const finalWinner = phase === 'done'
    ? (scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : 'draw')
    : null;
  useGameEndEffects(finalWinner, finalWinner === myIndex);
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'culture', winnerIndex: finalWinner });

  // === Timeout : si le temps est écoulé, on entre en reveal (hôte uniquement) ===
  useEffect(() => {
    if (!isHost || !timerActive || !expired) return;
    const newState = {
      ...state,
      reveal: true,
      revealUntil: Date.now() + QUIZ_REVEAL_MS,
    };
    onUpdate({ ...room, state: newState });
    updateRoomState(room.id, { state: newState }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, timerActive, expired]);

  // === Fin de reveal : on avance à la question suivante (hôte uniquement) ===
  useEffect(() => {
    if (!isHost || !reveal || revealUntil == null) return;
    const remaining = revealUntil - Date.now();
    if (remaining <= 0) {
      // Cas où on est déjà en retard (revenu d'un autre onglet) : avance direct
      advanceAfterReveal();
      return;
    }
    const t = setTimeout(advanceAfterReveal, remaining);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, reveal, revealUntil]);

  const advanceAfterReveal = async () => {
    const nextIdx = currentIdx + 1;
    const done = nextIdx >= questions.length;
    const newState = {
      ...state,
      currentIdx: nextIdx,
      phase: done ? 'done' : 'playing',
      reveal: false,
      revealUntil: null,
      questionStartedAt: done ? null : Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Démarrer (hôte) ===
  const startGame = async () => {
    if (!isHost) return;
    const newState = {
      ...state,
      phase: 'playing',
      questions: makeCultureQuestions(10),
      currentIdx: 0,
      scores: [0, 0],
      questionStartedAt: Date.now(),
      reveal: false,
      revealUntil: null,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Un joueur tape une réponse ===
  const tapAnswer = async (choice) => {
    if (isSpectator) return;
    if (phase !== 'playing' || reveal) return;        // bloqué pendant reveal
    const q = questions[currentIdx];
    if (!q) return;
    if (choice !== q.answer) {
      setWrongTap(choice);
      playSound('pop');
      vibrate(30);
      return;
    }
    playSound('pop');
    vibrate(50);
    const newScores = [...scores];
    newScores[myIndex] += 1;
    // Bonne réponse → on entre en reveal (les 2 voient la bonne réponse 2s)
    const newState = {
      ...state,
      scores: newScores,
      lastTapBy: myIndex,
      reveal: true,
      revealUntil: Date.now() + QUIZ_REVEAL_MS,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Revanche (hôte) ===
  const newGame = async () => {
    if (!isHost) return;
    const newState = {
      ...makeCultureState(),
      phase: 'playing',
      questions: makeCultureQuestions(10),
      round: (state.round || 1) + 1,
      questionStartedAt: Date.now(),
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : prêt ===
  if (phase === 'ready') {
    if (isHost) {
      return (
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.blue, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">🧠</div>
          <h3 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Culture G
          </h3>
          <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            10 questions de culture générale.
            <br />Le 1er à toucher la bonne réponse marque !
          </p>
          <button onClick={startGame} className="px-6 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     fontSize: '1.05rem', boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🚀 Commencer la partie
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-3xl p-8 text-center"
           style={{ background: C.blue, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[0]?.pseudo || 'L\'hôte'} lance la partie.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : résultat final ===
  if (phase === 'done') {
    const isDraw = finalWinner === 'draw';
    const isMyWin = finalWinner === myIndex;
    const opponentForChange = isHost ? players[1] : players[0];
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: isDraw ? C.lavender : (isMyWin ? C.mint : C.pink),
        boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">
          <span className="clic-celebrate">{isDraw ? '🤝' : (isMyWin ? '🎉' : '😢')}</span>
        </div>
        <h3 className="text-3xl mb-3"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {isDraw ? 'Égalité !' : `${players[finalWinner]?.pseudo || 'Joueur'} gagne !`}
        </h3>
        <div className="flex items-center justify-around mb-4">
          <div className="text-center">
            <div className="text-2xl mb-1">{players[0]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[0]?.pseudo || 'Hôte'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[0]}
            </div>
          </div>
          <div className="text-2xl" style={{ color: C.inkSoft }}>vs</div>
          <div className="text-center">
            <div className="text-2xl mb-1">{players[1]?.avatar || '👤'}</div>
            <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              {players[1]?.pseudo || 'Invité'}
            </div>
            <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                 fontWeight: 700, color: C.ink }}>
              {scores[1]}
            </div>
          </div>
        </div>
        {isHost ? (
          <EndGameActions
            onRematch={newGame}
            onChangeGame={onChangeGame}
            opponentName={opponentForChange?.pseudo}
          />
        ) : (
          <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer...
          </div>
        )}
      </div>
    );
  }

  // === ÉCRAN 3 : jeu en cours ===
  const q = questions[currentIdx];
  if (!q) return null;

  return (
    <div>
      {/* Score live */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-around"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[0]?.pseudo || 'Hôte'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 0 ? C.accentPink : C.ink }}>
            {scores[0]}
          </div>
        </div>
        <div className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
          {currentIdx + 1} / {questions.length}
        </div>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[1]?.pseudo || 'Invité'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                               fontWeight: 700,
                                               color: myIndex === 1 ? C.accentPink : C.ink }}>
            {scores[1]}
          </div>
        </div>
      </div>

      {/* Chrono : barre qui se vide en 10s */}
      <div className="rounded-full mb-3 overflow-hidden"
           style={{ height: 8, background: 'rgba(0,0,0,0.06)' }}>
        <div style={{
          height: '100%',
          width: `${reveal ? 0 : Math.round((msLeft / QUIZ_QUESTION_MS) * 100)}%`,
          background: reveal ? '#6BCB77'
            : msLeft < 3000 ? C.accentPink
            : C.blue,
          transition: 'width 0.2s linear, background 0.3s',
        }} />
      </div>

      {/* Question */}
      <div className="rounded-3xl p-5 mb-4 text-center"
           style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-xs mb-2 inline-block px-3 py-1 rounded-full"
             style={{ background: C.blue, color: C.ink, fontWeight: 700 }}>
          {q.promptLabel}
        </div>
        <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                      color: C.ink, fontSize: '1.25rem', lineHeight: 1.25 }}>
          {q.prompt}
        </div>
        {reveal && (
          <div className="text-sm mt-2" style={{ color: '#3A9B6B', fontWeight: 700 }}>
            ✓ Bonne réponse : {q.answer}
          </div>
        )}
      </div>

      {/* 4 réponses */}
      <div className="flex flex-col gap-3">
        {q.choices.map((c, i) => {
          const isWrong = wrongTap === c;
          const isCorrectReveal = reveal && c === q.answer;
          return (
            <button key={i} onClick={() => tapAnswer(c)}
              disabled={reveal}
              className="rounded-2xl px-4 py-4 clic-press text-left"
              style={{
                background: isCorrectReveal ? '#D4F5E0' : isWrong ? '#FFD0D0' : C.white,
                color: C.ink,
                fontFamily: '"Fredoka", sans-serif',
                fontWeight: 700, fontSize: '1.05rem',
                boxShadow: isCorrectReveal ? '0 3px 0 rgba(60,160,90,0.3)'
                  : isWrong ? '0 3px 0 rgba(200,0,0,0.2)'
                  : '0 4px 0 rgba(0,0,0,0.08)',
                outline: isCorrectReveal ? '2px solid #6BCB77' : 'none',
                transition: 'background 0.2s',
                opacity: reveal && !isCorrectReveal ? 0.5 : 1,
              }}>
              {isCorrectReveal && '✓ '}{c}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ============================================================
// JEU — MOTS MÊLÉS — VERSION ONLINE (10-12 ans)
// ------------------------------------------------------------
// Grille 8×8 de lettres où 6 mots sont cachés (horizontal, vertical,
// diagonal). Les 2 joueurs voient la MÊME grille. Pour prendre un mot :
// toucher sa 1re lettre puis sa dernière lettre. Si les 2 cases forment
// une ligne droite correspondant à un mot caché non encore trouvé, le mot
// est crédité au joueur. Le plus de mots trouvés gagne.
//
// L'hôte génère la grille (placements stockés dans room.state) pour que
// les 2 joueurs aient exactement la même.
// ============================================================
const MM_GRID = 8;          // grille 8×8
const MM_WORD_COUNT = 6;    // 6 mots cachés
const MM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Retire les accents et met en majuscules (grille sans accents)
function mmNormalize(w) {
  return w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/gi, 'c').replace(/[^a-zA-Z]/g, '').toUpperCase();
}

// 8 directions possibles (on en utilise un sous-ensemble lisible)
const MM_DIRS = [
  { dr: 0, dc: 1 },   // horizontal →
  { dr: 1, dc: 0 },   // vertical ↓
  { dr: 1, dc: 1 },   // diagonale ↘
  { dr: -1, dc: 1 },  // diagonale ↗
];

// Génère une grille + les placements des mots. Renvoie { grid, words }.
// words = [{ word, normalized, r0,c0, r1,c1, cells:[{r,c}] }]
function makeMotsMelesGrid() {
  const themes = WORDS_JSON.themes;
  const themeKeys = Object.keys(themes);
  const theme = themes[themeKeys[Math.floor(Math.random() * themeKeys.length)]];

  // Mots candidats : 3 à 7 lettres une fois normalisés
  const candidates = theme.words
    .map((w) => ({ raw: w, norm: mmNormalize(w) }))
    .filter((w) => w.norm.length >= 3 && w.norm.length <= 7);

  // On mélange et on essaie d'en placer MM_WORD_COUNT
  const shuffled = cultureShuffle(candidates);

  const grid = Array.from({ length: MM_GRID }, () => Array(MM_GRID).fill(null));
  const placed = [];

  const tryPlace = (entry) => {
    const { norm } = entry;
    // 40 tentatives aléatoires
    for (let attempt = 0; attempt < 40; attempt++) {
      const dir = MM_DIRS[Math.floor(Math.random() * MM_DIRS.length)];
      const r0 = Math.floor(Math.random() * MM_GRID);
      const c0 = Math.floor(Math.random() * MM_GRID);
      const r1 = r0 + dir.dr * (norm.length - 1);
      const c1 = c0 + dir.dc * (norm.length - 1);
      if (r1 < 0 || r1 >= MM_GRID || c1 < 0 || c1 >= MM_GRID) continue;
      // Vérifie que ça ne rentre pas en conflit (cases vides ou même lettre)
      let ok = true;
      const cells = [];
      for (let k = 0; k < norm.length; k++) {
        const r = r0 + dir.dr * k;
        const c = c0 + dir.dc * k;
        const existing = grid[r][c];
        if (existing != null && existing !== norm[k]) { ok = false; break; }
        cells.push({ r, c });
      }
      if (!ok) continue;
      // Place
      cells.forEach((cell, k) => { grid[cell.r][cell.c] = norm[k]; });
      placed.push({
        word: entry.raw, normalized: norm,
        r0, c0, r1, c1, cells,
      });
      return true;
    }
    return false;
  };

  for (const entry of shuffled) {
    if (placed.length >= MM_WORD_COUNT) break;
    tryPlace(entry);
  }

  // Remplit les cases vides avec des lettres aléatoires
  for (let r = 0; r < MM_GRID; r++) {
    for (let c = 0; c < MM_GRID; c++) {
      if (grid[r][c] == null) {
        grid[r][c] = MM_ALPHABET[Math.floor(Math.random() * 26)];
      }
    }
  }

  return {
    grid,
    words: placed.map((p) => ({
      word: p.word, normalized: p.normalized,
      r0: p.r0, c0: p.c0, r1: p.r1, c1: p.c1,
      theme: theme.label,
    })),
    themeLabel: theme.label,
    themeEmoji: theme.emoji,
  };
}

function makeMotsMelesState() {
  return {
    phase: 'ready',           // 'ready' | 'playing' | 'done'
    grid: null,               // 8×8 lettres
    words: [],                // placements des mots cachés
    found: [],                // [{ wordIndex, by }] mots trouvés
    themeLabel: '',
    themeEmoji: '',
    round: 1,
  };
}

// Deux cases forment-elles une ligne droite ? Renvoie la liste des cases
// traversées (ou null si pas une ligne droite valide).
function mmLineCells(a, b) {
  const dr = b.r - a.r;
  const dc = b.c - a.c;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  // horizontal, vertical, ou diagonale parfaite
  const isLine = (dr === 0 && dc !== 0) || (dc === 0 && dr !== 0) || (adr === adc && adr !== 0);
  if (!isLine) return null;
  const steps = Math.max(adr, adc);
  const sr = Math.sign(dr), sc = Math.sign(dc);
  const cells = [];
  for (let k = 0; k <= steps; k++) cells.push({ r: a.r + sr * k, c: a.c + sc * k });
  return cells;
}

function MotsMelesOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const isHost = myIndex === 0;
  const players = [player1, player2];

  const state = (room.state && room.state.phase) ? room.state : makeMotsMelesState();
  const { phase, grid, words, found, themeLabel, themeEmoji } = state;

  // Sélection en cours : première case touchée
  const [firstCell, setFirstCell] = useState(null);
  const [flashWrong, setFlashWrong] = useState(false);

  // Score = nombre de mots trouvés par chacun
  const scores = [0, 1].map((p) => (found || []).filter((f) => f.by === p).length);

  const allFound = phase === 'playing' && words && found && found.length >= words.length;
  const phaseDone = phase === 'done' || allFound;

  const finalWinner = phaseDone
    ? (scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : 'draw')
    : null;
  useGameEndEffects(finalWinner, finalWinner === myIndex);
  useRecordResult({ room, isHost: myIndex === 0, isSpectator, game: 'motsmeles', winnerIndex: finalWinner });

  // Quand tous les mots sont trouvés, l'hôte bascule la phase à 'done'
  useEffect(() => {
    if (isHost && allFound && phase === 'playing') {
      const newState = { ...state, phase: 'done' };
      onUpdate({ ...room, state: newState });
      updateRoomState(room.id, { state: newState }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFound, isHost, phase]);

  // === Démarrer (hôte) ===
  const startGame = async () => {
    if (!isHost) return;
    const gen = makeMotsMelesGrid();
    const newState = {
      ...makeMotsMelesState(),
      phase: 'playing',
      grid: gen.grid,
      words: gen.words,
      found: [],
      themeLabel: gen.themeLabel,
      themeEmoji: gen.themeEmoji,
      round: state.round || 1,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  const newGame = async () => {
    if (!isHost) return;
    const gen = makeMotsMelesGrid();
    const newState = {
      ...makeMotsMelesState(),
      phase: 'playing',
      grid: gen.grid, words: gen.words, found: [],
      themeLabel: gen.themeLabel, themeEmoji: gen.themeEmoji,
      round: (state.round || 1) + 1,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // Index des mots déjà trouvés + map cellule→propriétaire (pour colorer)
  const foundWordIdx = new Set((found || []).map((f) => f.wordIndex));
  const cellOwner = {};  // "r-c" → playerIndex
  (found || []).forEach((f) => {
    const w = words[f.wordIndex];
    if (!w) return;
    const cells = mmLineCells({ r: w.r0, c: w.c0 }, { r: w.r1, c: w.c1 }) || [];
    cells.forEach((cell) => { cellOwner[`${cell.r}-${cell.c}`] = f.by; });
  });

  // === Toucher une case ===
  const tapCell = async (r, c) => {
    if (isSpectator || phase !== 'playing') return;
    if (!firstCell) {
      setFirstCell({ r, c });
      playSound('pop');
      return;
    }
    // Re-toucher la même case = annuler la sélection
    if (firstCell.r === r && firstCell.c === c) {
      setFirstCell(null);
      return;
    }
    // 2e case → on valide la ligne
    const line = mmLineCells(firstCell, { r, c });
    setFirstCell(null);
    if (!line) { setFlashWrong(true); setTimeout(() => setFlashWrong(false), 300); return; }

    // Lettres de la ligne (dans les 2 sens)
    const letters = line.map((cell) => grid[cell.r][cell.c]).join('');
    const reversed = letters.split('').reverse().join('');

    // Cherche un mot non trouvé qui correspond
    const idx = words.findIndex((w, i) =>
      !foundWordIdx.has(i) && (w.normalized === letters || w.normalized === reversed)
    );
    if (idx === -1) {
      setFlashWrong(true); setTimeout(() => setFlashWrong(false), 300);
      playSound('pop'); vibrate(30);
      return;
    }

    // Trouvé !
    playSound('pop'); vibrate(50); launchConfetti && launchConfetti();
    const newFound = [...(found || []), { wordIndex: idx, by: myIndex }];
    const newState = { ...state, found: newFound };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === ÉCRAN 1 : prêt ===
  if (phase === 'ready') {
    if (isHost) {
      return (
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">🔤</div>
          <h3 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Mots Mêlés
          </h3>
          <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            6 mots sont cachés dans la grille.
            <br />Touche la 1re puis la dernière lettre d'un mot pour le prendre !
          </p>
          <button onClick={startGame} className="px-6 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     fontSize: '1.05rem', boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🚀 Commencer la partie
          </button>
        </div>
      );
    }
    return (
      <div className="rounded-3xl p-8 text-center"
           style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-6xl mb-3">⏳</div>
        <h3 className="text-2xl mb-2"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          En attente...
        </h3>
        <p style={{ color: C.inkLight, fontWeight: 600 }}>
          {players[0]?.pseudo || 'L\'hôte'} lance la partie.
        </p>
      </div>
    );
  }

  // === ÉCRAN 2 : résultat ===
  if (phaseDone) {
    const isDraw = finalWinner === 'draw';
    const isMyWin = finalWinner === myIndex;
    const opponentForChange = isHost ? players[1] : players[0];
    return (
      <div className="rounded-3xl p-6 text-center" style={{
        background: isDraw ? C.lavender : (isMyWin ? C.mint : C.pink),
        boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
      }}>
        <div className="text-6xl mb-3">
          <span className="clic-celebrate">{isDraw ? '🤝' : (isMyWin ? '🎉' : '😢')}</span>
        </div>
        <h3 className="text-3xl mb-3"
            style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
          {isDraw ? 'Égalité !' : `${players[finalWinner]?.pseudo || 'Joueur'} gagne !`}
        </h3>
        <div className="flex items-center justify-around mb-4">
          {[0, 1].map((i) => (
            <div key={i} className="text-center">
              <div className="text-2xl mb-1">{players[i]?.avatar || '👤'}</div>
              <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
                {players[i]?.pseudo || (i === 0 ? 'Hôte' : 'Invité')}
              </div>
              <div className="text-3xl" style={{ fontFamily: '"Fredoka", sans-serif',
                                                   fontWeight: 700, color: C.ink }}>
                {scores[i]}
              </div>
            </div>
          ))}
        </div>
        {isHost ? (
          <EndGameActions onRematch={newGame} onChangeGame={onChangeGame}
            opponentName={opponentForChange?.pseudo} />
        ) : (
          <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
            ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer...
          </div>
        )}
      </div>
    );
  }

  // === ÉCRAN 3 : jeu en cours ===
  if (!grid) return null;
  const colorFor = (owner) => owner === 0 ? C.peach : C.lavender;

  return (
    <div>
      {/* Score + thème */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-around"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[0]?.pseudo || 'Hôte'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                  fontWeight: 700, color: myIndex === 0 ? C.accentPink : C.ink }}>
            {scores[0]}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>Thème</div>
          <div className="text-sm" style={{ color: C.ink, fontWeight: 700 }}>
            {themeEmoji} {themeLabel}
          </div>
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
            {found.length} / {words.length} trouvés
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 700 }}>
            {players[1]?.pseudo || 'Invité'}
          </div>
          <div className="text-2xl" style={{ fontFamily: '"Fredoka", sans-serif',
                  fontWeight: 700, color: myIndex === 1 ? C.accentPink : C.ink }}>
            {scores[1]}
          </div>
        </div>
      </div>

      {/* Grille de lettres */}
      <div className="rounded-2xl p-2 mb-3"
           style={{ background: flashWrong ? '#FFE0E0' : C.cream,
                    boxShadow: '0 4px 0 rgba(0,0,0,0.06)', transition: 'background 0.2s' }}>
        {grid.map((rowArr, r) => (
          <div key={r} className="grid" style={{ gridTemplateColumns: `repeat(${MM_GRID}, 1fr)`, gap: 3, marginBottom: 3 }}>
            {rowArr.map((letter, c) => {
              const owner = cellOwner[`${r}-${c}`];
              const isFound = owner != null;
              const isFirst = firstCell && firstCell.r === r && firstCell.c === c;
              return (
                <button key={c} onClick={() => tapCell(r, c)}
                  disabled={isSpectator}
                  className="rounded-lg flex items-center justify-center clic-press"
                  style={{
                    aspectRatio: '1 / 1',
                    background: isFound ? colorFor(owner) : (isFirst ? C.accentPink : C.white),
                    color: isFirst ? C.white : C.ink,
                    fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                    fontSize: '1rem',
                    border: '1px solid rgba(0,0,0,0.05)',
                  }}>
                  {letter}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Liste des mots à trouver */}
      <div className="rounded-2xl p-3" style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-xs mb-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
          Mots à trouver :
        </div>
        <div className="flex flex-wrap gap-2">
          {words.map((w, i) => {
            const fEntry = (found || []).find((f) => f.wordIndex === i);
            const isFound = !!fEntry;
            return (
              <span key={i} className="text-sm px-3 py-1 rounded-full"
                style={{
                  background: isFound ? colorFor(fEntry.by) : C.cream,
                  color: C.ink, fontWeight: 700,
                  textDecoration: isFound ? 'line-through' : 'none',
                  opacity: isFound ? 0.7 : 1,
                }}>
                {w.word.toUpperCase()}
              </span>
            );
          })}
        </div>
        {firstCell && (
          <div className="text-xs mt-2 text-center" style={{ color: C.accentPink, fontWeight: 700 }}>
            Touche maintenant la dernière lettre du mot (ou re-touche pour annuler)
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================
// JEU — DOMINOS — VERSION ONLINE (variante classique block/draw)
// ------------------------------------------------------------
// Jeu classique des dominos 1v1 :
//   - 28 tuiles (de [0,0] à [6,6]), 7 à chacun, 14 dans la pioche
//   - Le plus haut double commence (ou la plus haute tuile si pas de double)
//   - Chacun son tour : pose une tuile qui correspond à un bout de la chaîne,
//     OU pioche si pas possible, OU passe si pioche vide
//   - 1er à vider sa main gagne. Si blocage (2 passes consécutives) :
//     plus petit total de points dans la main gagne
//
// Note réseau : les mains sont stockées dans room.state (donc techniquement
// visibles dans la console, comme pour PFC). Pour des enfants qui jouent en
// confiance, c'est acceptable. L'UI n'affiche que ta propre main.
//
// Représentation d'une tuile dans la chaîne : [leftValue, rightValue] déjà
// orientée. Du coup : ends[0] = chain[0][0], ends[1] = chain[last][1].
// Une tuile dans la main : [a, b] avec a ≤ b (forme canonique).
// ============================================================

// Construit les 28 tuiles canoniques [a,b] avec a ≤ b
function makeDominoSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++)
    for (let b = a; b <= 6; b++) tiles.push([a, b]);
  return tiles;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Choisit le joueur qui ouvre + la tuile d'ouverture.
// Renvoie { starter, openingTileIdx } où openingTileIdx est l'index dans
// la main du starter. Règle : plus haut double, sinon plus haute somme.
function pickDominosOpener(hands) {
  // Cherche le plus haut double dans chaque main
  const bestDouble = hands.map((hand) => {
    let best = -1, idx = -1;
    hand.forEach((t, i) => { if (t[0] === t[1] && t[0] > best) { best = t[0]; idx = i; } });
    return { best, idx };
  });
  if (bestDouble[0].best >= 0 || bestDouble[1].best >= 0) {
    const starter = bestDouble[0].best >= bestDouble[1].best ? 0 : 1;
    return { starter, openingTileIdx: bestDouble[starter].idx };
  }
  // Pas de double : on prend la plus haute somme
  const bestSum = hands.map((hand) => {
    let best = -1, idx = -1;
    hand.forEach((t, i) => { const s = t[0] + t[1]; if (s > best) { best = s; idx = i; } });
    return { best, idx };
  });
  const starter = bestSum[0].best >= bestSum[1].best ? 0 : 1;
  return { starter, openingTileIdx: bestSum[starter].idx };
}

function makeDominosState() {
  const all = shuffleArray(makeDominoSet());
  const hands = [all.slice(0, 7), all.slice(7, 14)];
  const drawPile = all.slice(14);
  const { starter, openingTileIdx } = pickDominosOpener(hands);
  // Pose la tuile d'ouverture sur la chaîne
  const openingTile = hands[starter][openingTileIdx];
  const newHands = hands.map((h, i) => i === starter
    ? h.filter((_, idx) => idx !== openingTileIdx)
    : h);
  return {
    phase: 'playing',          // 'playing' | 'done'
    hands: newHands,
    chain: [openingTile.slice()],
    drawPile,
    turn: (starter + 1) % 2,   // le suivant joue
    starter,
    winner: null,
    winReason: null,           // 'empty' (main vide) | 'blocked' (blocage) | 'draw'
    passCount: 0,              // 2 passes consécutives = blocage
    lastAction: null,          // texte du dernier coup (pour l'historique)
  };
}

// Une tuile [a,b] peut-elle être posée à gauche (matching chain.left) ?
// Renvoie la tuile orientée à poser ou null.
function canPlaceLeft(tile, leftEnd) {
  if (tile[0] === leftEnd) return [tile[1], tile[0]];
  if (tile[1] === leftEnd) return [tile[0], tile[1]];
  return null;
}
function canPlaceRight(tile, rightEnd) {
  if (tile[0] === rightEnd) return [tile[0], tile[1]];
  if (tile[1] === rightEnd) return [tile[1], tile[0]];
  return null;
}
function tilePoints(tile) { return tile[0] + tile[1]; }
function handPoints(hand) { return hand.reduce((s, t) => s + tilePoints(t), 0); }

// Une main a-t-elle au moins une tuile jouable ?
function hasPlayable(hand, chain) {
  if (chain.length === 0) return true;
  const L = chain[0][0], R = chain[chain.length - 1][1];
  return hand.some((t) => t.includes(L) || t.includes(R));
}

function DominosOnline({ room, profile, player1, player2, onUpdate, onChangeGame, isSpectator = false }) {
  const myIndex = isSpectator ? -1 : (room.player1_id === profile.id ? 0 : 1);
  const isHost = myIndex === 0;
  const players = [player1, player2];

  // Initialisation : si pas encore d'état, l'hôte génère
  const state = (room.state && room.state.phase) ? room.state : null;

  // Si pas d'état et je suis l'hôte → je crée
  useEffect(() => {
    if (!state && isHost && !isSpectator) {
      const fresh = makeDominosState();
      onUpdate({ ...room, state: fresh });
      updateRoomState(room.id, { state: fresh }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, isHost]);

  // Écran de règles au démarrage (local à chaque joueur)
  const [showRules, setShowRules] = useState(true);

  // Popup pour choisir le côté quand une tuile peut aller des 2 côtés
  const [pendingSide, setPendingSide] = useState(null);  // { tileIdx }

  // Si pas encore d'état partagé → on attend
  if (!state) {
    return (
      <div className="rounded-3xl p-8 text-center"
           style={{ background: C.cream, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-5xl mb-3">🎴</div>
        <div style={{ color: C.inkLight, fontWeight: 600 }}>
          {isHost ? 'Distribution des tuiles...' : `${players[0]?.pseudo || 'L\'hôte'} distribue les tuiles...`}
        </div>
      </div>
    );
  }

  const { phase, hands, chain, drawPile, turn, winner, winReason, passCount, lastAction } = state;
  const myHand = myIndex >= 0 ? hands[myIndex] : [];
  const oppHand = myIndex >= 0 ? hands[1 - myIndex] : [];
  const isMyTurn = !isSpectator && turn === myIndex && phase === 'playing';

  const leftEnd = chain.length ? chain[0][0] : null;
  const rightEnd = chain.length ? chain[chain.length - 1][1] : null;

  // Effets de fin de partie + enregistrement
  useGameEndEffects(winner, winner === myIndex);
  useRecordResult({ room, isHost, isSpectator, game: 'dominos', winnerIndex: winner });

  // === Poser une tuile ===
  const placeTile = async (tileIdx, side) => {
    if (!isMyTurn) return;
    const tile = myHand[tileIdx];
    const orientedL = canPlaceLeft(tile, leftEnd);
    const orientedR = canPlaceRight(tile, rightEnd);
    let oriented = null;
    if (side === 'left' && orientedL) oriented = orientedL;
    else if (side === 'right' && orientedR) oriented = orientedR;
    else if (!side) {
      // Auto : si possible des 2 côtés on demande, sinon on choisit l'unique
      if (orientedL && orientedR) { setPendingSide({ tileIdx }); return; }
      if (orientedL) oriented = orientedL;
      else if (orientedR) oriented = orientedR;
    }
    if (!oriented) return;  // pas jouable

    const newChain = side === 'left'
      ? [oriented, ...chain]
      : [...chain, oriented];
    const newHand = myHand.filter((_, i) => i !== tileIdx);
    const newHands = hands.map((h, i) => i === myIndex ? newHand : h);

    playSound('pop'); vibrate(40);

    // Victoire si main vide
    if (newHand.length === 0) {
      const newState = {
        ...state,
        hands: newHands,
        chain: newChain,
        winner: myIndex,
        winReason: 'empty',
        phase: 'done',
        passCount: 0,
        lastAction: `🏆 ${players[myIndex]?.pseudo || 'Joueur'} vide sa main !`,
      };
      onUpdate({ ...room, state: newState });
      await updateRoomState(room.id, { state: newState });
      return;
    }

    const newState = {
      ...state,
      hands: newHands,
      chain: newChain,
      turn: 1 - myIndex,
      passCount: 0,
      lastAction: `${players[myIndex]?.pseudo || 'Joueur'} pose ${tile[0]}|${tile[1]}`,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Piocher une tuile ===
  const draw = async () => {
    if (!isMyTurn) return;
    if (drawPile.length === 0) return;
    const drawn = drawPile[0];
    const newDraw = drawPile.slice(1);
    const newHand = [...myHand, drawn];
    const newHands = hands.map((h, i) => i === myIndex ? newHand : h);
    playSound('pop'); vibrate(20);
    const newState = {
      ...state,
      hands: newHands,
      drawPile: newDraw,
      passCount: 0,   // piocher casse la séquence de passes
      lastAction: `${players[myIndex]?.pseudo || 'Joueur'} pioche`,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Passer son tour (quand pioche vide ET pas jouable) ===
  const passTurn = async () => {
    if (!isMyTurn) return;
    const newPassCount = passCount + 1;
    if (newPassCount >= 2) {
      // Blocage : on compare les points
      const pts = [handPoints(hands[0]), handPoints(hands[1])];
      let win;
      if (pts[0] < pts[1]) win = 0;
      else if (pts[1] < pts[0]) win = 1;
      else win = 'draw';
      const newState = {
        ...state,
        turn: 1 - myIndex,
        passCount: newPassCount,
        phase: 'done',
        winner: win,
        winReason: 'blocked',
        lastAction: '🚫 Plus personne ne peut jouer !',
      };
      onUpdate({ ...room, state: newState });
      await updateRoomState(room.id, { state: newState });
      return;
    }
    const newState = {
      ...state,
      turn: 1 - myIndex,
      passCount: newPassCount,
      lastAction: `${players[myIndex]?.pseudo || 'Joueur'} passe son tour`,
    };
    onUpdate({ ...room, state: newState });
    await updateRoomState(room.id, { state: newState });
  };

  // === Revanche (hôte) ===
  const newGame = async () => {
    if (!isHost) return;
    const fresh = makeDominosState();
    onUpdate({ ...room, state: fresh });
    await updateRoomState(room.id, { state: fresh });
  };

  const canIPlay = hasPlayable(myHand, chain);
  const showDraw = isMyTurn && !canIPlay && drawPile.length > 0;
  const showPass = isMyTurn && !canIPlay && drawPile.length === 0;

  // Rendu d'une tuile : pip dots à l'ancienne, simple et lisible
  const Pips = ({ n, color = C.ink }) => {
    // Positions des points pour 0-6
    const layouts = {
      0: [], 1: [[1,1]], 2: [[0,0],[2,2]], 3: [[0,0],[1,1],[2,2]],
      4: [[0,0],[0,2],[2,0],[2,2]], 5: [[0,0],[0,2],[1,1],[2,0],[2,2]],
      6: [[0,0],[0,2],[1,0],[1,2],[2,0],[2,2]],
    };
    const dots = layouts[n] || [];
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)',
                    gridTemplateRows: 'repeat(3,1fr)', width: 28, height: 28, gap: 1 }}>
        {[0,1,2].map(r => [0,1,2].map(c => {
          const filled = dots.some(d => d[0] === r && d[1] === c);
          return <div key={`${r}-${c}`} style={{
            background: filled ? color : 'transparent',
            borderRadius: '50%', width: 6, height: 6, margin: 'auto',
          }} />;
        }))}
      </div>
    );
  };

  const TileView = ({ tile, small = false, dim = false, highlight = false, onClick }) => (
    <div onClick={onClick}
      className={onClick ? 'clic-press' : ''}
      style={{
        display: 'inline-flex', flexDirection: 'row', alignItems: 'center',
        background: C.white, borderRadius: 8,
        border: highlight ? `2px solid ${C.accentPink}` : '1px solid rgba(0,0,0,0.15)',
        boxShadow: '0 2px 0 rgba(0,0,0,0.08)',
        padding: small ? 2 : 4, gap: 2,
        opacity: dim ? 0.4 : 1,
        cursor: onClick ? 'pointer' : 'default',
        transform: small ? 'scale(0.85)' : 'none',
        flexShrink: 0,
      }}>
      <div style={{ padding: 2 }}><Pips n={tile[0]} /></div>
      <div style={{ width: 1, height: 26, background: 'rgba(0,0,0,0.2)' }} />
      <div style={{ padding: 2 }}><Pips n={tile[1]} /></div>
    </div>
  );

  return (
    <div>
      {/* === Écran de règles au début === */}
      {showRules && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-3xl p-6 clic-pop"
               style={{ background: C.white, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                        maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="text-center mb-3">
              <div className="text-5xl mb-1">🁫🁌</div>
              <h3 className="text-xl" style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
                Dominos
              </h3>
              <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
                Vide ta main avant l'adversaire !
              </p>
            </div>
            <div className="flex flex-col gap-2 mb-4">
              {[
                { e: '🎴', t: 'Tu reçois 7 tuiles, 14 sont dans la pioche.' },
                { e: '🔢', t: 'À ton tour, pose une tuile qui correspond à un bout de la chaîne.' },
                { e: '↔️', t: 'Si elle peut aller des 2 côtés, choisis gauche ou droite.' },
                { e: '🃏', t: 'Si tu ne peux pas jouer, tu dois piocher.' },
                { e: '⏭️', t: 'Si la pioche est vide et que tu ne peux pas, tu passes ton tour.' },
                { e: '🏆', t: 'Le 1er à vider sa main gagne ! En cas de blocage, le plus petit total gagne.' },
              ].map((r, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded-xl" style={{ background: C.cream }}>
                  <span className="text-xl" style={{ flexShrink: 0 }}>{r.e}</span>
                  <span className="text-xs" style={{ color: C.ink, fontWeight: 600 }}>{r.t}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { tap(); setShowRules(false); }}
              className="w-full py-3 rounded-2xl clic-press"
              style={{ background: C.accentPink, color: C.white,
                       fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                       boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
              C'est parti ! 🚀
            </button>
          </div>
        </div>
      )}

      {/* === Popup choix gauche/droite === */}
      {pendingSide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-xs rounded-3xl p-5 text-center"
               style={{ background: C.white, boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
            <div className="text-sm mb-3" style={{ color: C.ink, fontWeight: 700 }}>
              Où poser cette tuile ?
            </div>
            <div className="flex justify-center mb-4">
              <TileView tile={myHand[pendingSide.tileIdx]} highlight />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => { const idx = pendingSide.tileIdx; setPendingSide(null); placeTile(idx, 'left'); }}
                className="py-3 rounded-2xl clic-press"
                style={{ background: C.blue, color: C.ink, fontWeight: 700,
                         fontFamily: '"Fredoka", sans-serif', boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
                ⬅️ Gauche
              </button>
              <button onClick={() => { const idx = pendingSide.tileIdx; setPendingSide(null); placeTile(idx, 'right'); }}
                className="py-3 rounded-2xl clic-press"
                style={{ background: C.peach, color: C.ink, fontWeight: 700,
                         fontFamily: '"Fredoka", sans-serif', boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
                Droite ➡️
              </button>
            </div>
            <button onClick={() => setPendingSide(null)}
              className="mt-3 text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Petit bouton règles */}
      <div className="flex justify-end mb-2">
        <button onClick={() => { tap(); setShowRules(true); }}
          className="text-xs px-3 py-1 rounded-full clic-press"
          style={{ background: C.white, color: C.inkLight, fontWeight: 700,
                   boxShadow: '0 2px 0 rgba(0,0,0,0.06)' }}>
          ❓ Règles
        </button>
      </div>

      {/* Scoreboard : main + pioche + tour */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="p-2 rounded-2xl text-center" style={{
          background: turn === 0 && phase === 'playing' ? C.peach : C.cream,
          outline: turn === 0 && phase === 'playing' ? `2px solid ${C.accentPink}` : 'none',
          outlineOffset: '2px',
        }}>
          <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
            {players[0]?.pseudo || 'Hôte'} {myIndex === 0 && !isSpectator && '(toi)'}
          </div>
          <div className="text-lg" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {hands[0].length} 🎴
          </div>
        </div>
        <div className="p-2 rounded-2xl text-center" style={{ background: C.white }}>
          <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>Pioche</div>
          <div className="text-lg" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {drawPile.length} 🃏
          </div>
        </div>
        <div className="p-2 rounded-2xl text-center" style={{
          background: turn === 1 && phase === 'playing' ? C.lavender : C.cream,
          outline: turn === 1 && phase === 'playing' ? `2px solid ${C.accentPink}` : 'none',
          outlineOffset: '2px',
        }}>
          <div className="text-xs" style={{ color: C.inkLight, fontWeight: 700 }}>
            {players[1]?.pseudo || 'Invité'} {myIndex === 1 && !isSpectator && '(toi)'}
          </div>
          <div className="text-lg" style={{ color: C.ink, fontWeight: 700, fontFamily: '"Fredoka", sans-serif' }}>
            {hands[1].length} 🎴
          </div>
        </div>
      </div>

      {/* Bannière d'état */}
      {phase === 'playing' && (
        <div className="rounded-2xl p-2 mb-3 text-center text-sm"
             style={{ background: C.white, color: C.ink, fontWeight: 700,
                      boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
          {isSpectator ? `👀 Au tour de ${players[turn]?.pseudo || 'Joueur'}`
            : isMyTurn
              ? (canIPlay ? '👆 À toi de jouer ! Tape une tuile.' : (drawPile.length > 0 ? '🃏 Tu dois piocher.' : '⏭️ Tu dois passer.'))
              : `⏳ ${players[1 - myIndex]?.pseudo || 'L\'autre'} joue...`}
        </div>
      )}

      {/* Chaîne de dominos (scroll horizontal) */}
      <div className="rounded-2xl p-3 mb-3"
           style={{ background: C.cream, boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
                    overflowX: 'auto', whiteSpace: 'nowrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 44 }}>
          {chain.map((t, i) => (
            <TileView key={i} tile={t} small />
          ))}
        </div>
      </div>

      {/* Dernier coup */}
      {lastAction && (
        <div className="text-xs text-center mb-3"
             style={{ color: C.inkLight, fontWeight: 600 }}>
          {lastAction}
        </div>
      )}

      {/* === Fin de partie === */}
      {phase === 'done' && (
        <div className="rounded-3xl p-5 text-center mb-3" style={{
          background: winner === 'draw' ? C.lavender
            : winner === myIndex ? C.mint : C.pink,
          boxShadow: '0 6px 0 rgba(0,0,0,0.08)',
        }}>
          <div className="text-5xl mb-2">
            <span className="clic-celebrate">{winner === 'draw' ? '🤝' : winner === myIndex ? '🎉' : '😢'}</span>
          </div>
          <h3 className="text-xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {winner === 'draw' ? 'Égalité !'
              : `${players[winner]?.pseudo || 'Joueur'} gagne !`}
          </h3>
          <div className="text-xs mb-3" style={{ color: C.inkLight, fontWeight: 600 }}>
            {winReason === 'empty' && 'Main vidée !'}
            {winReason === 'blocked' && `Blocage : ${handPoints(hands[0])} vs ${handPoints(hands[1])} points`}
          </div>
          {isHost ? (
            <EndGameActions onRematch={newGame} onChangeGame={onChangeGame}
              opponentName={players[1]?.pseudo} />
          ) : (
            <div className="text-sm" style={{ color: C.inkLight, fontWeight: 600 }}>
              ⏳ {players[0]?.pseudo || 'L\'hôte'} va relancer...
            </div>
          )}
        </div>
      )}

      {/* === Ma main (pas spectateur) === */}
      {phase === 'playing' && !isSpectator && (
        <>
          <div className="text-xs mb-1 px-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
            Ta main ({myHand.length} tuiles)
          </div>
          <div className="rounded-2xl p-3 mb-3"
               style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)',
                        overflowX: 'auto', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'inline-flex', gap: 6, minHeight: 50 }}>
              {myHand.map((t, i) => {
                const canL = canPlaceLeft(t, leftEnd);
                const canR = canPlaceRight(t, rightEnd);
                const playable = !!(canL || canR);
                const dim = !isMyTurn || !playable;
                return (
                  <TileView key={i} tile={t} dim={dim}
                    onClick={isMyTurn && playable ? () => placeTile(i) : undefined} />
                );
              })}
            </div>
          </div>

          {/* Actions : piocher ou passer */}
          {showDraw && (
            <button onClick={draw}
              className="w-full py-3 rounded-2xl clic-press mb-2"
              style={{ background: C.accentPink, color: C.white,
                       fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                       boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
              🃏 Piocher
            </button>
          )}
          {showPass && (
            <button onClick={passTurn}
              className="w-full py-3 rounded-2xl clic-press mb-2"
              style={{ background: C.inkSoft, color: C.white,
                       fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                       boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
              ⏭️ Passer mon tour
            </button>
          )}
        </>
      )}

      {/* Vue spectateur : on n'affiche pas les mains, juste la chaîne et le statut */}
      {phase === 'playing' && isSpectator && (
        <div className="text-xs text-center" style={{ color: C.inkSoft, fontWeight: 600 }}>
          👀 Mode spectateur — les mains sont cachées
        </div>
      )}
    </div>
  );
}


// ============================================================
// JEU 5 SOLO — MATH DUEL en mode entraînement
// ============================================================
// Identique à MathDuelOnline mais 100% local :
//   - pas de Supabase, pas de room, pas de Realtime
//   - juste un score affiché à la fin, pas de localStorage best score
//   - pas de bouton "Revanche" → juste "Recommencer" (relance avec mêmes settings)
// On réutilise generateOneQuestion + makeMathQuestions définis plus haut.
// ============================================================
function MathDuelSolo({ onBack }) {
  const [phase, setPhase] = useState('level-select');  // 'level-select' | 'playing' | 'done'
  const [level, setLevel] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongTap, setWrongTap] = useState(null);

  // Flash rouge sur mauvaise réponse
  useEffect(() => {
    if (wrongTap == null) return;
    const t = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(t);
  }, [wrongTap]);

  const startGame = (lvl) => {
    setLevel(lvl);
    setQuestions(makeMathQuestions(lvl));
    setCurrentIdx(0);
    setScore(0);
    setPhase('playing');
  };

  const tapAnswer = (choice) => {
    const q = questions[currentIdx];
    if (!q) return;
    if (choice !== q.answer) {
      setWrongTap(choice);
      playSound('pop');
      vibrate(30);
      return;
    }
    playSound('pop');
    vibrate(50);
    const nextIdx = currentIdx + 1;
    setScore(s => s + 1);
    if (nextIdx >= questions.length) {
      setPhase('done');
      launchConfetti();
    } else {
      setCurrentIdx(nextIdx);
    }
  };

  const restart = () => {
    setPhase('level-select');
    setQuestions([]);
    setCurrentIdx(0);
    setScore(0);
  };

  // ÉCRAN choix niveau
  if (phase === 'level-select') {
    const levels = [
      { id: 'facile', label: 'Facile', emoji: '🌱', desc: '+ et − jusqu\'à 20' },
      { id: 'moyen', label: 'Moyen', emoji: '⚡', desc: '+, −, × jusqu\'à 100' },
      { id: 'difficile', label: 'Difficile', emoji: '🔥', desc: '×, ÷ jusqu\'à 100' },
    ];
    return (
      <div className="max-w-md mx-auto px-5 py-6">
        <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour
        </button>
        <div className="rounded-3xl p-5" style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-center mb-4">
            <div className="text-5xl mb-2">🔢⚡</div>
            <h3 className="text-2xl"
                style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
              Entraînement Math
            </h3>
            <p className="text-sm mt-1" style={{ color: C.inkLight, fontWeight: 600 }}>
              10 questions, à ton rythme. Bonne chance !
            </p>
          </div>
          <div className="space-y-3">
            {levels.map((lvl) => (
              <button key={lvl.id} onClick={() => startGame(lvl.id)}
                className="w-full p-4 rounded-2xl clic-press flex items-center gap-3 text-left"
                style={{ background: C.white, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
                <div className="text-3xl">{lvl.emoji}</div>
                <div className="flex-1">
                  <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                                color: C.ink, fontSize: '1.05rem' }}>
                    {lvl.label}
                  </div>
                  <div className="text-xs" style={{ color: C.inkSoft, fontWeight: 600 }}>
                    {lvl.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ÉCRAN fin de partie
  if (phase === 'done') {
    const total = questions.length;
    const great = score >= 8;
    const ok = score >= 5;
    const emoji = great ? '🎉' : ok ? '👍' : '💪';
    const msg = great ? 'Excellent !' : ok ? 'Pas mal !' : 'Encore un effort !';
    return (
      <div className="max-w-md mx-auto px-5 py-6">
        <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour aux jeux
        </button>
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.mint, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">
            <span className="clic-celebrate">{emoji}</span>
          </div>
          <h3 className="text-2xl mb-3"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {msg}
          </h3>
          <div className="text-5xl mb-2"
               style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {score} / {total}
          </div>
          <div className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            Niveau {level}
          </div>
          <button onClick={restart} className="px-5 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🔄 Recommencer
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN en cours
  const q = questions[currentIdx];
  if (!q) return null;
  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Abandonner
      </button>

      {/* Barre de progression + score */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-between"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-sm" style={{ color: C.inkSoft, fontWeight: 700 }}>
          Question {currentIdx + 1} / {questions.length}
        </div>
        <div className="text-lg" style={{ fontFamily: '"Fredoka", sans-serif',
                                            fontWeight: 700, color: C.ink }}>
          ⭐ {score}
        </div>
      </div>

      {/* La question */}
      <div className="rounded-3xl p-8 mb-4 text-center"
           style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                      color: C.ink, fontSize: '3rem', lineHeight: 1.1 }}>
          {q.a} {q.op} {q.b} = ?
        </div>
      </div>

      {/* 4 boutons QCM */}
      <div className="grid grid-cols-2 gap-3">
        {q.choices.map((c, i) => {
          const isWrong = wrongTap === c;
          return (
            <button key={i} onClick={() => tapAnswer(c)}
              className="rounded-2xl p-5 clic-press"
              style={{
                background: isWrong ? '#FFD0D0' : C.white,
                color: C.ink,
                fontFamily: '"Fredoka", sans-serif',
                fontWeight: 700, fontSize: '1.6rem',
                boxShadow: isWrong ? '0 3px 0 rgba(200,0,0,0.2)' : '0 4px 0 rgba(0,0,0,0.08)',
                transition: 'background 0.2s',
              }}>
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}


// ============================================================
// JEU 6 — GÉO QUIZ (drapeaux & capitales)
// ============================================================
// Données : countries.json (195 pays), filtrées via GEO_CURATED_CODES
// pour ne garder que ~60 pays bien connus pour des enfants 6-10 ans.
//
// Helper : flagEmoji('fr') → 🇫🇷. Marche pour tous les ISO 2 lettres.
// Le drapeau emoji est dérivé du code à la volée (pas stocké).
// ============================================================

// Codes ISO des pays "raisonnablement connus" pour francophones 6-10 ans.
// Source : sous-ensemble curé de countries.json. Si tu veux étendre, ajoute
// des codes ici. Pas besoin de toucher countries.json (qui reste la source
// complète des 195 pays).
const GEO_CURATED_CODES = new Set([
  // Europe
  'fr','es','it','de','gb','pt','be','ch','nl','gr',
  'pl','ie','se','no','dk','fi','at','ro','cz','hu',
  // Afrique
  'ma','dz','tn','eg','sn','ci','cm','za','ng','ke','gh','ml',
  // Amériques
  'us','ca','mx','br','ar','cl','co','pe','ve','cu','ht','jm',
  // Asie
  'jp','cn','in','kr','th','vn','id','sa','ae','tr','ir','iq',
  // Océanie
  'au','nz','fj',
]);

// Renvoie l'emoji drapeau d'un code ISO 2 lettres
function flagEmoji(code) {
  if (!code || code.length !== 2) return '🏳️';
  const A = 0x1F1E6;  // 🇦 regional indicator A
  return String.fromCodePoint(A + code.charCodeAt(0) - 97)
       + String.fromCodePoint(A + code.charCodeAt(1) - 97);
}

// Liste curée, prête à l'emploi
const GEO_COUNTRIES = COUNTRIES_JSON.filter(c => GEO_CURATED_CODES.has(c.code));

// Génère 10 questions, mélangeant drapeau→pays et capitale→pays
function makeGeoQuestions(count = 10) {
  const pool = [...GEO_COUNTRIES];
  // Mélange + pioche unique
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, count);
  return picked.map((country, i) => {
    // Alterne entre 2 types de questions
    const type = i % 2 === 0 ? 'flag' : 'capital';
    return makeOneGeoQuestion(country, type, pool);
  });
}

function makeOneGeoQuestion(country, type, allCountries) {
  // 3 leurres tirés de allCountries, jamais le pays cible
  const decoyPool = allCountries.filter(c => c.code !== country.code);
  // Shuffle léger et prend 3
  const decoys = [];
  const seenCodes = new Set([country.code]);
  while (decoys.length < 3 && decoys.length < decoyPool.length) {
    const cand = decoyPool[Math.floor(Math.random() * decoyPool.length)];
    if (!seenCodes.has(cand.code)) {
      decoys.push(cand);
      seenCodes.add(cand.code);
    }
  }

  if (type === 'flag') {
    // Question : "Quel pays a ce drapeau ?" + drapeau emoji
    // Réponse : nom du pays. Leurres = noms des autres pays.
    const choices = [...decoys.map(d => d.name), country.name]
                    .sort(() => Math.random() - 0.5);
    return {
      type: 'flag',
      prompt: flagEmoji(country.code),  // gros emoji drapeau
      promptLabel: 'Quel pays a ce drapeau ?',
      answer: country.name,
      choices,
    };
  } else {
    // Question : "Quelle est la capitale de X ?"
    // Réponse : capitale. Leurres = capitales des autres pays.
    const choices = [...decoys.map(d => d.capital), country.capital]
                    .sort(() => Math.random() - 0.5);
    return {
      type: 'capital',
      prompt: country.name,
      promptLabel: 'Quelle est la capitale de…',
      answer: country.capital,
      choices,
    };
  }
}

// ============================================================
// GÉO QUIZ SOLO
// ============================================================
function GeoQuizSolo({ onBack }) {
  const [phase, setPhase] = useState('ready');  // 'ready' | 'playing' | 'done'
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongTap, setWrongTap] = useState(null);

  useEffect(() => {
    if (wrongTap == null) return;
    const t = setTimeout(() => setWrongTap(null), 400);
    return () => clearTimeout(t);
  }, [wrongTap]);

  const startGame = () => {
    setQuestions(makeGeoQuestions(10));
    setCurrentIdx(0);
    setScore(0);
    setPhase('playing');
  };

  const tapAnswer = (choice) => {
    const q = questions[currentIdx];
    if (!q) return;
    if (choice !== q.answer) {
      setWrongTap(choice);
      playSound('pop');
      vibrate(30);
      return;
    }
    playSound('pop');
    vibrate(50);
    const nextIdx = currentIdx + 1;
    setScore(s => s + 1);
    if (nextIdx >= questions.length) {
      setPhase('done');
      launchConfetti();
    } else {
      setCurrentIdx(nextIdx);
    }
  };

  const restart = () => {
    setPhase('ready');
    setQuestions([]);
    setCurrentIdx(0);
    setScore(0);
  };

  // ÉCRAN intro (avant la 1ère question)
  if (phase === 'ready') {
    return (
      <div className="max-w-md mx-auto px-5 py-6">
        <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour
        </button>
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">🌍</div>
          <h3 className="text-2xl mb-2"
              style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            Géo Quiz — Solo
          </h3>
          <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            10 questions sur les drapeaux et capitales du monde.
          </p>
          <button onClick={startGame} className="px-6 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     fontSize: '1.05rem',
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🚀 C'est parti !
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN fin de partie
  if (phase === 'done') {
    const total = questions.length;
    const great = score >= 8;
    const ok = score >= 5;
    const emoji = great ? '🎉' : ok ? '👍' : '💪';
    const msg = great ? 'Bravo, tu connais bien le monde !'
              : ok    ? 'Pas mal, tu peux mieux faire !'
              : 'Continue à explorer le monde !';
    return (
      <div className="max-w-md mx-auto px-5 py-6">
        <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
          style={{ background: C.white, color: C.ink, fontWeight: 700,
                   boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
          ← Retour aux jeux
        </button>
        <div className="rounded-3xl p-6 text-center"
             style={{ background: C.lavender, boxShadow: '0 6px 0 rgba(0,0,0,0.08)' }}>
          <div className="text-6xl mb-3">
            <span className="clic-celebrate">{emoji}</span>
          </div>
          <div className="text-5xl mb-2"
               style={{ fontFamily: '"Fredoka", sans-serif', fontWeight: 700, color: C.ink }}>
            {score} / {total}
          </div>
          <p className="text-sm mb-5" style={{ color: C.inkLight, fontWeight: 600 }}>
            {msg}
          </p>
          <button onClick={restart} className="px-5 py-3 rounded-2xl clic-press"
            style={{ background: C.accentPink, color: C.white,
                     fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
                     boxShadow: '0 4px 0 rgba(0,0,0,0.10)' }}>
            🔄 Recommencer
          </button>
        </div>
      </div>
    );
  }

  // ÉCRAN en cours
  const q = questions[currentIdx];
  if (!q) return null;
  return (
    <div className="max-w-md mx-auto px-5 py-6">
      <button onClick={onBack} className="mb-4 px-3 py-2 rounded-full text-sm clic-press"
        style={{ background: C.white, color: C.ink, fontWeight: 700,
                 boxShadow: '0 3px 0 rgba(0,0,0,0.08)' }}>
        ← Abandonner
      </button>

      {/* Progression + score */}
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-between"
           style={{ background: C.white, boxShadow: '0 3px 0 rgba(0,0,0,0.06)' }}>
        <div className="text-sm" style={{ color: C.inkSoft, fontWeight: 700 }}>
          Question {currentIdx + 1} / {questions.length}
        </div>
        <div className="text-lg" style={{ fontFamily: '"Fredoka", sans-serif',
                                            fontWeight: 700, color: C.ink }}>
          ⭐ {score}
        </div>
      </div>

      {/* Le prompt (drapeau géant ou nom du pays) + label */}
      <div className="rounded-3xl p-6 mb-4 text-center"
           style={{ background: C.cream, boxShadow: '0 4px 0 rgba(0,0,0,0.08)' }}>
        <div className="text-sm mb-2" style={{ color: C.inkSoft, fontWeight: 700 }}>
          {q.promptLabel}
        </div>
        <div style={{
          fontFamily: '"Fredoka", sans-serif', fontWeight: 700,
          color: C.ink,
          fontSize: q.type === 'flag' ? '5rem' : '1.8rem',
          lineHeight: 1.1,
        }}>
          {q.prompt}
        </div>
      </div>

      {/* 4 boutons réponses (en 1 colonne car les noms sont longs) */}
      <div className="flex flex-col gap-3">
        {q.choices.map((c, i) => {
          const isWrong = wrongTap === c;
          return (
            <button key={i} onClick={() => tapAnswer(c)}
              className="rounded-2xl px-4 py-4 clic-press text-left"
              style={{
                background: isWrong ? '#FFD0D0' : C.white,
                color: C.ink,
                fontFamily: '"Fredoka", sans-serif',
                fontWeight: 700, fontSize: '1.05rem',
                boxShadow: isWrong ? '0 3px 0 rgba(200,0,0,0.2)' : '0 4px 0 rgba(0,0,0,0.08)',
                transition: 'background 0.2s',
              }}>
              {c}
            </button>
          );
        })}
      </div>
    </div>
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
