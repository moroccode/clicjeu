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

  // On récupère d'abord la liste des invitations "écartées par l'utilisateur"
  // (= il a tapé "Plus tard"). Elles existent toujours côté hôte mais on les
  // cache. Cf table dismissed_invitations.
  const { data: dismissedRows } = await supabase
    .from('dismissed_invitations')
    .select('room_id')
    .eq('user_id', user.id);
  const dismissedIds = new Set((dismissedRows || []).map((r) => r.room_id));

  const { data, error } = await supabase
    .from('rooms')
    .select('id, code, game, player1_id, created_at')
    .eq('invited_id', user.id)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (error) return [];
  return (data || []).filter((r) => !dismissedIds.has(r.id));
}

// ============================================================
// dismissInvitation — Cacher une invitation pour MOI uniquement
// (l'invitation reste vivante pour le créateur, mais je ne la vois plus
// nulle part, même après une nouvelle session ou un changement d'appareil)
// ============================================================
export async function dismissInvitation(roomId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  // upsert pour ignorer un doublon (clé composite user_id + room_id)
  const { error } = await supabase
    .from('dismissed_invitations')
    .upsert({ user_id: user.id, room_id: roomId }, { onConflict: 'user_id,room_id' });
  return { ok: !error };
}

// ============================================================
// cleanupStaleWaitingRooms — Supprime mes vieilles rooms abandonnées
// (>5 min, en waiting, où je suis l'hôte). Ça évite que la table grossisse
// et que d'anciennes invitations restent visibles côté ami.
// Côté client : appelé au boot de l'app.
// ============================================================
export async function cleanupStaleWaitingRooms() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase
    .from('rooms')
    .delete()
    .eq('player1_id', user.id)
    .eq('status', 'waiting')
    .lt('created_at', fiveMinAgo);
}

// ============================================================
// restoreActiveRoom — Restaure la room où j'étais avant de fermer l'onglet
//  - Cherche la room par son id
//  - Vérifie qu'elle est encore vivante et que je suis bien dedans
//  - Si c'est ma room en attente, je redémarre le timer 60s (UPDATE created_at)
// Retourne la room (avec created_at mis à jour si reset) ou null.
// ============================================================
export async function restoreActiveRoom(roomId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !roomId) return null;

  const { data: room, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();
  if (error || !room) return null;
  // Je dois être player1 ou player2 ; sinon je n'ai rien à faire ici
  if (room.player1_id !== user.id && room.player2_id !== user.id) return null;
  // Si déjà finie ou abandonnée → on n'essaye pas de revenir
  if (room.status !== 'waiting' && room.status !== 'playing') return null;

  // Reset du timer 60s pour les rooms en attente où je suis l'hôte
  if (room.status === 'waiting' && room.player1_id === user.id) {
    const { data: updated } = await supabase
      .from('rooms')
      .update({ created_at: new Date().toISOString() })
      .eq('id', roomId)
      .select()
      .single();
    return updated || room;
  }
  return room;
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
// RÉACTIONS — communication légère entre joueurs (emojis + phrases)
// ------------------------------------------------------------
// On utilise un channel Realtime de type "broadcast" plutôt que de stocker
// la réaction dans room.state. Raison : les réactions sont ÉPHÉMÈRES (elles
// s'affichent 2s puis disparaissent) et ne doivent PAS écraser l'état du jeu
// (sinon une réaction envoyée en même temps qu'un coup pourrait annuler le
// coup à cause du last-write-wins sur room.state).
//
// Le broadcast ne touche jamais la base de données : c'est juste un message
// temps réel transmis aux autres clients abonnés au même room.
// ============================================================

// S'abonne aux réactions d'une room. callback reçoit { kind, content, by }.
export function subscribeToReactions(roomId, callback) {
  const channelName = `reactions-${roomId}`;
  const channel = supabase
    .channel(channelName)
    .on('broadcast', { event: 'reaction' }, (payload) => {
      callback(payload.payload);
    })
    .subscribe();

  return {
    channel,
    unsubscribe: () => supabase.removeChannel(channel),
  };
}

// Envoie une réaction sur le channel d'une room.
// reaction = { kind: 'emoji'|'phrase'|'hello', content: '👏', by: 0|1 }
export async function sendReaction(channel, reaction) {
  if (!channel) return;
  try {
    await channel.send({
      type: 'broadcast',
      event: 'reaction',
      payload: reaction,
    });
  } catch (e) {
    // silencieux : une réaction perdue n'est pas grave
  }
}

// ============================================================
// SIGNAUX DE PARTIE — channel distinct des réactions
// ------------------------------------------------------------
// Sert aux signaux "système" entre joueurs (ex: "j'ai quitté la partie").
// On le sépare des réactions (emojis/phrases) pour éviter toute collision
// d'abonnement et garder une sémantique claire.
// ============================================================
export function subscribeToGameSignals(roomId, callback) {
  const channelName = `signals-${roomId}`;
  const channel = supabase
    .channel(channelName)
    .on('broadcast', { event: 'signal' }, (payload) => {
      callback(payload.payload);
    })
    .subscribe();

  return {
    channel,
    unsubscribe: () => supabase.removeChannel(channel),
  };
}

export async function sendGameSignal(channel, signal) {
  if (!channel) return;
  try {
    await channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: signal,
    });
  } catch (e) {
    // silencieux
  }
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
