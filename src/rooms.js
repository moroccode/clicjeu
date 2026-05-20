// ============================================================
// src/rooms.js — Gestion des salons (parties online)
// ============================================================
// Tout ce qui touche aux parties online est ici :
//   • createRoom() — créer une partie et obtenir un code
//   • joinRoom()   — rejoindre une partie avec un code
//   • subscribeToRoom() — écouter les changements en temps réel
//   • updateRoomState() — jouer un coup (modifier l'état)
//   • leaveRoom() — quitter / quitter
// ============================================================

import { supabase } from './supabase';

// --- Vocabulaire pour générer des codes rigolos ---
const COLORS  = ['ROUGE','BLEU','VERT','JAUNE','ROSE','VIOLET','ORANGE','BLANC','NOIR'];
const ANIMALS = ['CHAT','CHIEN','LION','OURS','RENARD','PANDA','TIGRE','LAPIN','SINGE','LOUP','HIBOU','POULPE'];

// Génère un code aléatoire type "BLEU-CHAT"
function generateCode() {
  const c = COLORS[Math.floor(Math.random() * COLORS.length)];
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${c}-${a}`;
}

// ============================================================
// createRoom — Crée une nouvelle partie
// gameId : 'morpion' | 'connect4' | 'memory' | 'bataille' | 'pendu'
// initialState : état de départ du jeu (ex: { board: [...] })
// ============================================================
export async function createRoom({ gameId, initialState }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  // On essaie jusqu'à 5 fois de générer un code unique
  // (si on tombe par hasard sur un code déjà pris)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();

    const { data, error } = await supabase
      .from('rooms')
      .insert({
        code,
        game: gameId,
        player1_id: user.id,
        state: initialState,
        status: 'waiting',
      })
      .select()
      .single();

    if (!error) return { ok: true, room: data };
    // Si l'erreur est "code déjà pris", on réessaie
    if (error.code !== '23505') {
      return { ok: false, error: 'Erreur création : ' + error.message };
    }
  }

  return { ok: false, error: 'Trop de tentatives. Réessaie.' };
}

// ============================================================
// joinRoom — Rejoindre une partie avec un code
// ============================================================
export async function joinRoom({ code }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  const cleanCode = code.trim().toUpperCase();

  // Cherche le salon par son code
  const { data: room, error: findErr } = await supabase
    .from('rooms')
    .select('*')
    .eq('code', cleanCode)
    .maybeSingle();

  if (findErr || !room) return { ok: false, error: 'Code introuvable 🤔' };
  if (room.status === 'finished') return { ok: false, error: 'Cette partie est terminée.' };
  if (room.player1_id === user.id) return { ok: false, error: 'C\'est ta propre partie !' };
  if (room.player2_id && room.player2_id !== user.id) {
    return { ok: false, error: 'Cette partie est déjà pleine 😢' };
  }

  // Rejoindre = devenir player2 + passer en "playing"
  const { data: updated, error: updateErr } = await supabase
    .from('rooms')
    .update({
      player2_id: user.id,
      status: 'playing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', room.id)
    .select()
    .single();

  if (updateErr) return { ok: false, error: 'Erreur : ' + updateErr.message };
  return { ok: true, room: updated };
}

// ============================================================
// getRoom — Charger un salon par son ID (pour rafraîchir)
// ============================================================
export async function getRoom(roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .single();

  if (error) return null;
  return data;
}

// ============================================================
// updateRoomState — Mettre à jour l'état du jeu (jouer un coup)
// patch : objet partiel à merger, ex: { state: {...}, winner: 1 }
// ============================================================
export async function updateRoomState(roomId, patch) {
  const { error } = await supabase
    .from('rooms')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', roomId);

  return { ok: !error, error: error?.message };
}

// ============================================================
// subscribeToRoom — S'abonner aux changements en temps réel
// callback : appelée à chaque changement avec le nouveau room
// Retourne un objet avec .unsubscribe() pour arrêter d'écouter
// ============================================================
export function subscribeToRoom(roomId, callback) {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (payload) => callback(payload.new)
    )
    .subscribe();

  return {
    unsubscribe: () => supabase.removeChannel(channel),
  };
}

// ============================================================
// getProfilesByIds — Récupérer plusieurs profils en une fois
// Utile pour afficher les pseudos des 2 joueurs
// ============================================================
export async function getProfilesByIds(ids) {
  const validIds = ids.filter(Boolean);
  if (validIds.length === 0) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', validIds);

  if (error) return {};
  // Transforme en { id1: profile1, id2: profile2 }
  const map = {};
  data.forEach((p) => { map[p.id] = p; });
  return map;
}
