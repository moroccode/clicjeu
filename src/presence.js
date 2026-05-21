// ============================================================
// src/presence.js — Système de présence "en ligne" via Supabase Realtime
// ============================================================
// Comment ça marche :
//   - Au login, on rejoint un channel Realtime global 'cj-presence'.
//   - On y publie son userId via channel.track({ user_id }).
//   - Tous les autres clients connectés voient un événement 'sync' avec
//     la liste de tous les user_ids présents.
//   - Quand l'utilisateur ferme l'onglet/perd le réseau, Supabase l'enlève
//     automatiquement après ~30s (timeout WebSocket).
//   - Aucune table SQL, aucun heartbeat manuel, aucun "last_seen" à gérer.
//
// Limitations à savoir :
//   - Si l'onglet est en background, le WebSocket peut être ralenti par
//     l'OS. La présence reste vraie ~quelques minutes même tab inactif.
//     C'est OK pour un usage "qui peut jouer là maintenant".
//   - Les utilisateurs voient TOUT le monde en ligne, pas seulement leurs
//     amis. Le filtrage côté UI est trivial.
// ============================================================

import { supabase } from './supabase';

let presenceChannel = null;
const listeners = new Set();
let onlineIds = new Set();

// Démarre le tracking : à appeler au login (avec le userId).
// Idempotent : appeler plusieurs fois ne crée pas plusieurs channels.
export function startPresence(userId) {
  if (!userId) return;
  if (presenceChannel) return;  // déjà démarré

  // Le channel partagé entre tous les users connectés
  presenceChannel = supabase.channel('cj-presence', {
    config: { presence: { key: userId } },
  });

  // À chaque sync (= nouvel utilisateur rejoint ou quitte), on met à jour
  // notre Set local et on prévient les listeners (composants React)
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = presenceChannel.presenceState();
      // state est un objet { userId1: [{...}], userId2: [{...}], ... }
      onlineIds = new Set(Object.keys(state));
      listeners.forEach((fn) => fn(onlineIds));
    })
    .subscribe(async (status) => {
      // Quand on est vraiment SUBSCRIBED, on track sa présence
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ user_id: userId, online_at: new Date().toISOString() });
      }
    });
}

// Arrête le tracking : à appeler au logout
export function stopPresence() {
  if (!presenceChannel) return;
  try {
    presenceChannel.untrack();
    supabase.removeChannel(presenceChannel);
  } catch { /* ignore */ }
  presenceChannel = null;
  onlineIds = new Set();
  listeners.forEach((fn) => fn(onlineIds));
}

// Snapshot synchrone (utile pour afficher au mount sans attendre un événement)
export function getOnlineIds() {
  return onlineIds;
}

// S'abonne aux changements de présence. Renvoie une fonction unsubscribe.
// Usage React :
//   useEffect(() => subscribePresence(setOnlineSet), [])
export function subscribePresence(callback) {
  listeners.add(callback);
  // Push immédiat de l'état actuel
  callback(onlineIds);
  return () => listeners.delete(callback);
}
