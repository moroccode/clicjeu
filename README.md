# 🎮 ClicJeu

5 mini-jeux pour 2 joueurs : Morpion, Puissance 4, Memory, Bataille Navale, Pendu.

Stack : React 18 + Vite + Tailwind CSS + Supabase (auth pseudo + PIN).

## Lancer en local

```bash
npm install
npm run dev
```

## Déployer sur Vercel

Push sur GitHub → connecter le repo à Vercel → deploy auto.

## Structure

- `src/App.jsx` — toute l'app (auth, onboarding, hub, 5 jeux)
- `src/supabase.js` — client Supabase + helpers d'auth
- `src/main.jsx` — entrée React
- `src/index.css` — Tailwind + reset léger
