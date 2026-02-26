# ⚖️ ContratClair

**Analysez et réécrivez vos contrats français en 30 secondes grâce à l'IA.**

Outil destiné aux freelances, auto-entrepreneurs et PME françaises qui veulent comprendre et améliorer leurs contrats sans avoir recours à un avocat pour chaque document.

## Fonctionnalités

- 🆓 **Analyse gratuite** — Risques, clauses manquantes, résumé clair
- 🔄 **Réécriture** — Claude corrige et améliore votre contrat complet
- ✨ **Génération** — Créez un contrat from scratch en 2 phrases
- 👔 / 💻 **Double perspective** — Analyse côté Client ou Prestataire
- 📥 **Export PDF** — Téléchargez votre contrat corrigé

## Stack

- Frontend: HTML + Tailwind CSS (CDN)
- Backend: Express.js + Claude API (Anthropic)
- PDF: pdf.js (lecture) + window.print (export)

## Installation

```bash
git clone https://github.com/[YOUR-USERNAME]/contratclair
cd contratclair
npm install
cp .env.example .env
# Ajoutez votre clé ANTHROPIC_API_KEY dans .env
npm start
```

## Déploiement Railway

1. Push sur GitHub
2. Créer un projet Railway → "Deploy from GitHub repo"
3. Ajouter variable d'env `ANTHROPIC_API_KEY`
4. Railway détecte Node.js auto → déploiement en ~2 min

## Modèle de revenus

- Gratuit : analyse illimitée
- Pro (9€/mois) : réécriture + génération de contrats

## Licence

MIT
