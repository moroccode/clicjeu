// ============================================================
// src/supabase.js — Client Supabase + helpers d'auth
// ============================================================
// Astuce pédagogique : tout ce qui touche à Supabase est regroupé
// ici. Si demain on change de backend (Firebase, ton propre serveur),
// on ne touche QUE ce fichier. C'est ce qu'on appelle "isoler les
// dépendances externes" — un super pattern à retenir.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://hvcdbsobkmftojijwlqa.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2Y2Ric29ia21mdG9qaWp3bHFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzUwNDQsImV4cCI6MjA5NDgxMTA0NH0.cDkxyEQra6t2ig6SBfd2GwyEIanUZ_t0hrwOwi96iMg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// --- Pseudo + PIN : on triche en mappant vers email + password ---
// L'utilisateur tape "Mehdi" / "1234"
// Supabase reçoit "mehdi@clicjeu.local" / "pin_1234"
// L'utilisateur ne voit jamais ces fake emails. C'est juste pour
// satisfaire l'API Supabase Auth qui exige email + password.
const toEmail    = (pseudo) => `${pseudo.toLowerCase()}@clicjeu.local`;
const toPassword = (pin)    => `pin_${pin}`;

// ============================================================
// signup — Crée un nouveau compte
// Retourne : { ok: true } ou { ok: false, error: '...' }
// ============================================================
export async function signup({ pseudo, pin }) {
  // 1. Vérif unicité du pseudo dans la table profiles
  //    (la contrainte UNIQUE en SQL nous protège déjà, mais on
  //    vérifie avant pour donner un meilleur message d'erreur)
  const { data: existing } = await supabase
    .from('profiles')
    .select('pseudo')
    .eq('pseudo', pseudo)
    .maybeSingle();

  if (existing) {
    return { ok: false, error: 'Ce pseudo est déjà pris 😢' };
  }

  // 2. Création du compte
  //    Le trigger SQL handle_new_user() créera automatiquement
  //    la ligne dans la table profiles avec le pseudo et l'avatar.
  const { error } = await supabase.auth.signUp({
    email: toEmail(pseudo),
    password: toPassword(pin),
    options: {
      data: { pseudo, avatar: null },
    },
  });

  if (error) return { ok: false, error: 'Erreur : ' + error.message };
  return { ok: true };
}

// ============================================================
// login — Se connecter
// ============================================================
export async function login({ pseudo, pin }) {
  const { error } = await supabase.auth.signInWithPassword({
    email: toEmail(pseudo),
    password: toPassword(pin),
  });

  if (error) return { ok: false, error: 'Pseudo ou PIN incorrect 🤔' };
  return { ok: true };
}

// ============================================================
// logout — Se déconnecter
// ============================================================
export async function logout() {
  await supabase.auth.signOut();
}

// ============================================================
// getProfile — Charge le profil de l'utilisateur connecté
// Retourne le profil { id, pseudo, avatar, created_at } ou null
// ============================================================
export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('Erreur getProfile:', error);
    return null;
  }
  return data;
}

// ============================================================
// saveAvatar — Met à jour l'avatar dans la table profiles
// ============================================================
export async function saveAvatar(avatar) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from('profiles')
    .update({ avatar })
    .eq('id', user.id);

  return { ok: !error };
}
