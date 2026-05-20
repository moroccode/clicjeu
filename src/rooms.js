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

// --- Charset sans ambiguïté (pas de 0/O, pas de I/1) ---
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Génère un code court (6 caractères) type "K7M2X9"
function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

// ============================================================
// createRoom — Crée une nouvelle partie
// gameId : 'morpion' | 'connect4' | 'memory' | 'bataille' | 'pendu'
// ============================================================
// createRoom — Crée une nouvelle partie
// gameId : 'morpion' | 'connect4' | 'memory' | 'bataille' | 'pendu' | 'echecs'
// initialState : état de départ du jeu (ex: { board: [...] })
// invitedId : (optionnel) id de l'ami qu'on invite spécifiquement
// ============================================================
export async function createRoom({ gameId, initialState, invitedId = null }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();

    const insertData = {
      code,
      game: gameId,
      player1_id: user.id,
      state: initialState,
      status: 'waiting',
    };
    // Si on invite un ami précis, on l'ajoute dans la room
    if (invitedId) insertData.invited_id = invitedId;

    const { data, error } = await supabase
      .from('rooms')
      .insert(insertData)
      .select()
      .single();

    if (!error) return { ok: true, room: data };
    if (error.code !== '23505') {
      return { ok: false, error: 'Erreur création : ' + error.message };
    }
  }

  return { ok: false, error: 'Trop de tentatives. Réessaie.' };
}

// ============================================================
// listIncomingInvitations — Lister les invitations qu'on a reçues
// (rooms où je suis invited_id et status='waiting')
// ============================================================
export async function listIncomingInvitations() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, game, player1_id, created_at')
    .eq('invited_id', user.id)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

// ============================================================
// subscribeToInvitations — Écouter en temps réel les nouvelles invitations
// callback est appelé quand une nouvelle invitation arrive
// ============================================================
export function subscribeToInvitations(userId, callback) {
  const channelName = `invites-${userId}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rooms', filter: `invited_id=eq.${userId}` },
      (payload) => callback(payload.new)
    )
    .subscribe();

  return {
    unsubscribe: () => supabase.removeChannel(channel),
  };
}

// ============================================================
// cancelInvitation — Annuler une invitation envoyée (= supprimer le salon)
// ============================================================
export async function cancelInvitation(roomId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .eq('player1_id', user.id)  // seul le créateur peut annuler
    .eq('status', 'waiting');   // et seulement si encore en attente

  return { ok: !error };
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
  // Channel unique à chaque appel pour éviter "cannot add callbacks after subscribe"
  // (qui arrive si on s'abonne deux fois à la même room en parallèle)
  const channelName = `room-${roomId}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
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

// ============================================================
// updateRoomInvite — Invite un ami spécifique sur une room existante
// ============================================================
export async function updateRoomInvite(roomId, invitedId) {
  const { error } = await supabase
    .from('rooms')
    .update({ invited_id: invitedId, updated_at: new Date().toISOString() })
    .eq('id', roomId);
  return { ok: !error, error: error?.message };
}

// ============================================================
// listMyRooms — Toutes mes rooms ouvertes (waiting ou playing)
// ============================================================
export async function listMyRooms() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('rooms')
    .select('*')
    .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
    .in('status', ['waiting', 'playing'])
    .order('created_at', { ascending: false });

  return data || [];
}
