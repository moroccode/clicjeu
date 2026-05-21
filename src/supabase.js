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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    // Persiste la session en localStorage → l'utilisateur reste connecté même
    // si l'onglet est tué par Android pour libérer de la RAM.
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    // Reconnecte plus vite quand on revient sur l'onglet après être resté
    // longtemps sur WhatsApp / écran verrouillé.
    params: { eventsPerSecond: 10 },
  },
});

// --- Pseudo + PIN : on triche en mappant vers email + password ---
// L'utilisateur tape "Mehdi" / "1234"
// Supabase reçoit "mehdi@clicjeu.local" / "pin_1234"
// L'utilisateur ne voit jamais ces fake emails. C'est juste pour
// satisfaire l'API Supabase Auth qui exige email + password.
const toEmail    = (pseudo) => `${pseudo.toLowerCase()}@clicjeu.local`;
const toPassword = (pin)    => `pin_${pin}`;

// ============================================================
// translateError — Convertit les messages Supabase (anglais) en français
// ============================================================
function translateError(msg) {
  if (!msg) return 'Une erreur est survenue 😢';
  const m = msg.toLowerCase();
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already'))
    return 'Ce pseudo est déjà pris 😢';
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return 'Pseudo ou PIN incorrect 🤔';
  if (m.includes('password') && m.includes('characters'))
    return 'Problème avec le PIN. Réessaie.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Trop d\'essais. Patiente un peu ⏰';
  if (m.includes('network') || m.includes('failed to fetch'))
    return 'Pas de connexion internet 📡';
  if (m.includes('email') && m.includes('disabled'))
    return 'Inscription désactivée. Contacte l\'admin.';
  if (m.includes('email') && m.includes('confirm'))
    return 'Compte non confirmé. Contacte l\'admin.';
  // Fallback : message court en français
  return 'Erreur : réessaie dans un instant 🔄';
}

// ============================================================
// signup — Crée un nouveau compte
// Retourne : { ok: true } ou { ok: false, error: '...' }
// ============================================================
export async function signup({ pseudo, pin }) {
  // Cleanup d'une éventuelle session existante
  try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) {}

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

  // 2. Création du compte (avec timeout)
  //    Le trigger SQL handle_new_user() créera automatiquement
  //    la ligne dans la table profiles avec le pseudo et l'avatar.
  const signupPromise = supabase.auth.signUp({
    email: toEmail(pseudo),
    password: toPassword(pin),
    options: { data: { pseudo, avatar: null } },
  });
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ error: { message: 'timeout' } }), 8000)
  );

  const { error } = await Promise.race([signupPromise, timeoutPromise]);

  if (error) {
    if (error.message === 'timeout') {
      return { ok: false, error: 'Inscription trop lente. Vérifie ton internet ⏱️' };
    }
    return { ok: false, error: translateError(error.message) };
  }
  return { ok: true };
}

// ============================================================
// login — Se connecter
// On force d'abord une déconnexion (cleanup d'une éventuelle session zombi)
// puis on tente le login avec un timeout dur de 8 secondes.
// ============================================================
export async function login({ pseudo, pin }) {
  // 1. Cleanup : si une session traîne, on la kill
  //    (silencieux : si pas de session, signOut() ne plante pas)
  try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) {}

  // 2. Timeout race : si Supabase tarde plus de 8s, on rend la main
  //    (sinon le bouton "Connexion..." reste bloqué pour toujours)
  const loginPromise = supabase.auth.signInWithPassword({
    email: toEmail(pseudo),
    password: toPassword(pin),
  });
  const timeoutPromise = new Promise((resolve) =>
    setTimeout(() => resolve({ error: { message: 'timeout' } }), 8000)
  );

  const { error } = await Promise.race([loginPromise, timeoutPromise]);

  if (error) {
    if (error.message === 'timeout') {
      return { ok: false, error: 'Connexion trop lente. Vérifie ton internet et réessaie ⏱️' };
    }
    return { ok: false, error: translateError(error.message) };
  }
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
// Avec timeout 5s pour éviter de bloquer l'app indéfiniment.
// ============================================================
export async function getProfile() {
  const fetchProfile = async () => {
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
  };

  // Race avec un timeout de 5s pour ne pas bloquer
  return Promise.race([
    fetchProfile(),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
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
