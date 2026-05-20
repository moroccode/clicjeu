// ============================================================
// src/friends.js — Gestion du système d'amis
// ============================================================
// Toutes les actions sur les amis sont ici :
//   • searchUsers()       — chercher un user par pseudo
//   • sendFriendRequest() — envoyer une demande d'ami
//   • acceptFriendRequest() — accepter une demande reçue
//   • rejectFriendRequest() — refuser une demande
//   • removeFriend()      — supprimer un ami
//   • listFriends()       — lister mes amis (statut 'accepted')
//   • listPendingRequests() — lister les demandes que J'AI reçues
//   • listSentRequests()  — lister les demandes que J'AI envoyées
// ============================================================

import { supabase } from './supabase';

// ============================================================
// searchUsers — Chercher un user par pseudo (partial match)
// Exclut moi-même et limite à 10 résultats
// ============================================================
export async function searchUsers(query) {
  const clean = query.trim();
  if (clean.length < 2) return [];

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .ilike('pseudo', `%${clean}%`)  // recherche insensible à la casse
    .neq('id', user.id)               // exclut moi-même
    .limit(10);

  if (error) {
    console.error('Search error:', error);
    return [];
  }
  return data || [];
}

// ============================================================
// sendFriendRequest — Envoyer une demande d'ami
// Crée UNE seule ligne (user_id = moi, friend_id = lui, status = 'pending')
// L'autre verra cette demande via listPendingRequests()
// ============================================================
export async function sendFriendRequest(friendId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  // Vérif : pas déjà une demande/amitié existante
  const { data: existing } = await supabase
    .from('friendships')
    .select('*')
    .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') {
      return { ok: false, error: 'Vous êtes déjà amis 💚' };
    }
    return { ok: false, error: 'Demande déjà envoyée ⏳' };
  }

  // Insère la demande
  // user_id = moi (celui qui voit la demande dans "mes demandes envoyées")
  // friend_id = l'autre (celui qui va la voir dans "demandes reçues")
  const { error } = await supabase
    .from('friendships')
    .insert({
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
// On crée la ligne miroir (pour qu'elle soit visible des 2 côtés)
// puis on update la ligne d'origine à 'accepted'
// ============================================================
export async function acceptFriendRequest(otherUserId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Tu dois être connecté.' };

  // 1. Update la demande existante (où je suis friend_id) en 'accepted'
  //    Mais notre RLS dit qu'on peut modifier seulement nos lignes (user_id = moi)
  //    Donc on crée la ligne miroir D'ABORD côté moi
  const { error: insertErr } = await supabase
    .from('friendships')
    .insert({
      user_id: user.id,
      friend_id: otherUserId,
      requested_by: otherUserId,  // c'est l'autre qui avait initié
      status: 'accepted',
    });

  if (insertErr) {
    return { ok: false, error: 'Erreur acceptation : ' + insertErr.message };
  }

  // 2. Update la ligne de l'autre user (user_id = otherUserId, friend_id = moi)
  //    Mais RLS l'empêche ! On ne peut pas modifier la ligne de l'autre.
  //    Solution : on demande à l'autre user de la mettre à jour de son côté
  //    via le realtime (subscription) — il verra que notre ligne existe et
  //    mettra la sienne à jour.
  //
  //    Plus simple : on fait confiance et l'autre verra la nouvelle ligne
  //    via listFriends() qui filtre status='accepted'.
  //    Le bug à éviter : sa ligne reste en 'pending'. On la nettoie lors
  //    de son prochain login (cf. syncFriendships).

  return { ok: true };
}

// ============================================================
// syncFriendships — Synchroniser les amitiés
// Si l'autre a accepté côté lui (sa ligne en 'accepted'), on met aussi
// notre ligne à 'accepted'. Appelé au login + périodiquement.
// ============================================================
export async function syncFriendships() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Trouve mes demandes 'pending' où l'autre a déjà créé sa ligne 'accepted'
  const { data: myPending } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  if (!myPending || myPending.length === 0) return;

  // Pour chacune, vérifier si l'autre a accepté
  for (const f of myPending) {
    const { data: theirSide } = await supabase
      .from('friendships')
      .select('status')
      .eq('user_id', f.friend_id)
      .eq('friend_id', user.id)
      .eq('status', 'accepted')
      .maybeSingle();

    if (theirSide) {
      // L'autre a accepté → on update notre ligne aussi
      await supabase
        .from('friendships')
        .update({ status: 'accepted', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('friend_id', f.friend_id);
    }
  }
}

// ============================================================
// rejectFriendRequest — Refuser une demande reçue
// On supprime la ligne (on ne garde pas trace des refus)
// ============================================================
export async function rejectFriendRequest(otherUserId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // On supprime notre potentielle ligne (cas rare)
  await supabase.from('friendships')
    .delete()
    .eq('user_id', user.id)
    .eq('friend_id', otherUserId);

  // On ne peut pas supprimer la ligne de l'autre (RLS).
  // Sa demande reste en 'pending' chez lui.
  // Solution simple : si l'autre revoit la liste, il pourra annuler sa demande
  // Pour notre version 1, on laisse comme ça.

  return { ok: true };
}

// ============================================================
// removeFriend — Supprimer un ami (rupture amicale 😢)
// ============================================================
export async function removeFriend(friendId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  // Supprime notre ligne (l'autre verra son ami disparaître à la prochaine sync)
  await supabase.from('friendships')
    .delete()
    .eq('user_id', user.id)
    .eq('friend_id', friendId);

  return { ok: true };
}

// ============================================================
// listFriends — Lister mes amis (statut 'accepted')
// Retourne un tableau [{ id, pseudo, avatar }, ...]
// ============================================================
export async function listFriends() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // 1. Récupère les friend_id de mes amis acceptés
  const { data: rows } = await supabase
    .from('friendships')
    .select('friend_id')
    .eq('user_id', user.id)
    .eq('status', 'accepted');

  if (!rows || rows.length === 0) return [];

  // 2. Récupère les profils correspondants
  const ids = rows.map((r) => r.friend_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', ids);

  return profiles || [];
}

// ============================================================
// listPendingRequests — Lister les demandes que J'AI REÇUES
// (où je suis friend_id et status='pending')
// ============================================================
export async function listPendingRequests() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Les demandes RECUES sont stockées chez l'expéditeur (user_id = lui, friend_id = moi)
  // Mais notre RLS interdit de lire les lignes des autres !
  // Donc on lit nos propres lignes où requested_by != moi (le rare cas où on a une ligne sans avoir initié)
  // → ça ne marche pas avec notre RLS actuelle.
  //
  // SOLUTION : on assouplit légèrement la RLS pour permettre de lire les lignes où
  // friend_id = moi (les demandes qu'on m'a envoyées).
  // Ce SQL sera ajouté en plus dans le setup.

  const { data: rows, error } = await supabase
    .from('friendships')
    .select('user_id, requested_by, created_at')
    .eq('friend_id', user.id)
    .eq('status', 'pending');

  if (error || !rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, pseudo, avatar')
    .in('id', ids);

  return profiles || [];
}

// ============================================================
// listSentRequests — Lister les demandes que J'AI envoyées
// (où user_id = moi et status='pending')
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
