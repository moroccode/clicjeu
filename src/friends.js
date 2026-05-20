// ============================================================
// src/friends.js — Système d'amis (modèle 1 ligne par relation)
// ============================================================
// Structure :
//   1 ligne = 1 demande ou 1 amitié
//   user_id    = celui qui a envoyé la demande
//   friend_id  = destinataire
//   status     = 'pending' | 'accepted'
//
// Les 2 peuvent lire, modifier, supprimer leur relation (RLS symétrique)
// ============================================================

import { supabase } from './supabase';

// ============================================================
// searchUsers — Cherche par pseudo (partial, insensible casse)
// ============================================================
export async function searchUsers(query) {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .ilike('pseudo', `%${clean}%`)
    .neq('id', user.id)
    .limit(10);

  return data || [];
}

// ============================================================
// sendFriendRequest — Envoyer une demande d'ami
// ============================================================
export async function sendFriendRequest(friendId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  // Vérif si relation déjà existante (dans un sens ou l'autre)
  const { data: existing } = await supabase
    .from('friendships')
    .select('status')
    .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') return { ok: false, error: 'Vous êtes déjà amis 💚' };
    return { ok: false, error: 'Demande déjà envoyée ⏳' };
  }

  const { error } = await supabase.from('friendships').insert({
    user_id: user.id,
    friend_id: friendId,
    requested_by: user.id,
    status: 'pending',
  });

  if (error) return { ok: false, error: 'Erreur : ' + error.message };
  return { ok: true };
}

// ============================================================
// acceptFriendRequest — Accepter une demande reçue
// Met à jour la ligne existante (user_id=eux, friend_id=moi) en 'accepted'
// ============================================================
export async function acceptFriendRequest(senderId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // La ligne existe avec user_id=senderId, friend_id=moi
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted', updated_at: new Date().toISOString() })
    .eq('user_id', senderId)
    .eq('friend_id', user.id)
    .eq('status', 'pending');

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// rejectFriendRequest — Refuser / annuler une demande
// ============================================================
export async function rejectFriendRequest(senderId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  await supabase.from('friendships')
    .delete()
    .or(`and(user_id.eq.${senderId},friend_id.eq.${user.id}),and(user_id.eq.${user.id},friend_id.eq.${senderId})`);

  return { ok: true };
}

// ============================================================
// removeFriend — Supprimer un ami
// ============================================================
export async function removeFriend(friendId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  await supabase.from('friendships')
    .delete()
    .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

  return { ok: true };
}

// ============================================================
// listFriends — Mes amis acceptés (dans les 2 sens)
// ============================================================
export async function listFriends() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Lignes acceptées où je suis user_id OU friend_id
  const { data: rows } = await supabase
    .from('friendships')
    .select('user_id, friend_id')
    .eq('status', 'accepted')
    .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);

  if (!rows || rows.length === 0) return [];

  // L'ami c'est "l'autre" (pas moi)
  const friendIds = rows.map((r) => r.user_id === user.id ? r.friend_id : r.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', friendIds);

  return profiles || [];
}

// ============================================================
// listPendingRequests — Demandes reçues (friend_id = moi, pending)
// ============================================================
export async function listPendingRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows } = await supabase
    .from('friendships')
    .select('user_id')
    .eq('friend_id', user.id)
    .eq('status', 'pending');

  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', ids);

  return profiles || [];
}

// ============================================================
// listSentRequests — Demandes envoyées (user_id = moi, pending)
// ============================================================
export async function listSentRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: rows } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.friend_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', ids);

  return profiles || [];
}

// ============================================================
// syncFriendships — Plus nécessaire avec le modèle 1 ligne
// Conservé pour compatibilité (appel dans App.jsx au login)
// ============================================================
export async function syncFriendships() {
  // no-op dans le nouveau modèle
}
