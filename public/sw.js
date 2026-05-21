// ============================================================
// ClicJeu — Service Worker minimal
// ============================================================
// Pourquoi un SW vide ? Parce que Chrome refuse de proposer
// "Installer l'app" si la page n'a PAS de Service Worker
// enregistré. C'est un critère d'installabilité PWA.
//
// On ne fait PAS de cache offline pour l'instant — juste un SW
// "présent" qui passe le check. Si tu veux du vrai offline plus
// tard (jouer sans réseau), on étoffera ce fichier.
// ============================================================

// Skip waiting → la nouvelle version s'active tout de suite
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Claim → contrôle les pages déjà ouvertes dès activation
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handler vide mais OBLIGATOIRE pour que Chrome considère le SW
// comme "valide" et propose l'install prompt
self.addEventListener('fetch', () => {
  // No-op : on laisse le navigateur faire sa requête normalement
});
