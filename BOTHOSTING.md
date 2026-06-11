# Déploiement Bothosting — Boxing Center Bot

## 1. Créer le projet Node.js sur Bothosting

1. Nouveau projet **Node.js**
2. Copier le contenu de `bothosting-index.js` → renommer en **`index.js`** à la racine du projet Bothosting
3. Configurer **toutes** les variables ci-dessous dans le panneau Bothosting
4. Démarrer / redémarrer le projet

Le script va :
- cloner https://github.com/angoularaphael/boxing-center-bot.git
- générer le `.env` du bot
- `npm install`
- lancer le bot (PM2 si disponible)

---

## 2. Variables d'environnement Bothosting (copier-coller)

| Variable | Valeur | Obligatoire |
|----------|--------|-------------|
| `BOT_GITHUB_REPO` | `https://github.com/angoularaphael/boxing-center-bot.git` | Non (défaut OK) |
| `PORT` | `3002` | Oui |
| `NODE_ENV` | `production` | Recommandé |

### Supabase

| Variable | Valeur |
|----------|--------|
| `SUPABASE_URL` | `https://ulxtbvxdueolvnjhpzvw.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT **service_role** (Supabase → Settings → API) |
| `SUPABASE_ANON_KEY` | Clé **anon** / publishable (optionnel côté bot) |

> Avant le 1er usage : exécuter `supabase/migrations/001_boxing_center.sql` dans le SQL Editor Supabase.

### Sécurité & connexion site Vercel

| Variable | Valeur |
|----------|--------|
| `SITE_API_SECRET` | Mot de passe long aléatoire (ex. `3Giffareno237`) |
| `JWT_SECRET` | Autre chaîne longue aléatoire (sessions) |
| `SUPER_ADMIN_EMAIL` | `angoularaphael05@gmail.com` |
| `SUPER_ADMIN_PASSWORD` | `#Fareno12` |
| `CORS_ORIGIN` | URL Vercel du site gestion-manager (ex. `https://gestion-manager.vercel.app`) |

### WhatsApp

| Variable | Valeur |
|----------|--------|
| `MANDATORY_ADMIN_PHONE` | `237693646080` (indicatif sans +) |

### Site Boxing Center

| Variable | Valeur |
|----------|--------|
| `BOXING_CENTER_SITE_URL` | `https://boxingcenter.fr/` |

### Brevo (emails)

| Variable | Valeur |
|----------|--------|
| `BREVO_API_KEY` | Clé API Brevo (SMTP & API → Clés API) |
| `BREVO_SENDER_EMAIL` | `boxingcenter31@gmail.com` |
| `BREVO_SENDER_NAME` | `Boxing Center` |

**Obtenir la clé Brevo :**
1. Compte sur [brevo.com](https://www.brevo.com)
2. **SMTP & API** → **Clés API** → **Générer**
3. Vérifier l'expéditeur `boxingcenter31@gmail.com` dans **Expéditeurs**

---

## 3. Exemple bloc variables Bothosting

```
PORT=3002
NODE_ENV=production
BOT_GITHUB_REPO=https://github.com/angoularaphael/boxing-center-bot.git

SUPABASE_URL=https://ulxtbvxdueolvnjhpzvw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....
SUPABASE_ANON_KEY=sb_publishable_...

SITE_API_SECRET=3Giffareno237
JWT_SECRET=changez_moi_jwt_secret_long_2026
SUPER_ADMIN_EMAIL=angoularaphael05@gmail.com
SUPER_ADMIN_PASSWORD=#Fareno12

CORS_ORIGIN=https://votre-gestion-manager.vercel.app
MANDATORY_ADMIN_PHONE=237693646080
BOXING_CENTER_SITE_URL=https://boxingcenter.fr/

BREVO_API_KEY=xkeysib-votre_cle_brevo_ici
BREVO_SENDER_EMAIL=boxingcenter31@gmail.com
BREVO_SENDER_NAME=Boxing Center
```

> Remplacez les clés Supabase et Brevo par les vôtres. Ne partagez jamais `service_role` publiquement.

---

## 4. Lier Vercel (gestion-manager)

Après démarrage Bothosting, le script affiche :

```
URL API BOT : http://IP_DU_SERVEUR:3002
```

Sur **Vercel** (repo gestion-manager) :

| Variable | Valeur |
|----------|--------|
| `BC_API_BASE` | `http://IP:3002` ou `https://bot.votredomaine.com` |

Sur **Bothosting** (bot) :

| Variable | Valeur |
|----------|--------|
| `CORS_ORIGIN` | URL exacte Vercel (ex. `https://gestion-manager.vercel.app`) |

---

## 5. Après le déploiement

1. Ouvrir le site Vercel → `/login`
2. Email : `angoularaphael05@gmail.com` / Mot de passe : `#Fareno12`
3. **WhatsApp** → scanner le QR (`/dashboard/whatsapp`)
4. Test envoi → manager **atangana** (+237693646080 / linuxcam05@gmail.com)

### API utiles

- Santé : `GET http://IP:3002/api/status`
- Managers : `GET http://IP:3002/api/managers` (authentifié)

---

## 6. Mise à jour du bot

Redémarrer le projet Bothosting → le script fait `git pull` + `npm install` automatiquement.

---

## 7. Dépannage

| Problème | Solution |
|----------|----------|
| Emails ne partent pas | Vérifier `BREVO_API_KEY` + expéditeur validé Brevo |
| Login Vercel échoue | `CORS_ORIGIN` + `BC_API_BASE` + redémarrer bot |
| Table managers vide | Migration SQL Supabase + sync managers |
| WhatsApp déconnecté | Rescanner QR, ne pas supprimer `auth_info_baileys/` |
