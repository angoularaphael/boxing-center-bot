# Boxing Center Bot

Bot WhatsApp + API (modèle **NYC Cookies**) avec **Brevo** pour les emails.

Le site admin est sur [gestion-manager](https://github.com/angoularaphael/gestion-manager) (Vercel).  
Ce dépôt = **bot uniquement** (Bothosting / VPS).

## Variables `.env`

```env
PORT=3002
SITE_API_SECRET=meme_secret_que_vercel
NEXT_PUBLIC_SITE_URL=https://votre-app.vercel.app

SUPABASE_URL=https://ulxtbvxdueolvnjhpzvw.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

MANDATORY_ADMIN_PHONE=237693646080

BREVO_API_KEY=
BREVO_SENDER_EMAIL=boxingcenter31@gmail.com
BREVO_SENDER_NAME=Boxing Center
```

## Lancer en local

```bash
npm install
cp .env.example .env
npm start
```

## Bothosting

1. Créer projet Node.js
2. Copier `bootstrap.js` → renommer en `index.js`
3. Variables Bothosting = mêmes que `.env` ci-dessus
4. Démarrer — le script clone ce repo et lance le bot

## API

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/status` | Non | QR, connexion WhatsApp |
| `POST /api/start` | Non | Lier WhatsApp |
| `POST /api/logout` | Non | Déconnecter |
| `GET /api/managers` | `x-api-secret` | Liste managers |
| `POST /api/send-email` | `x-api-secret` | Email Brevo |
| `POST /api/send-message` | `x-api-secret` | WhatsApp |

## Commandes WhatsApp (admins)

`.menu` `.guide` `.numeros` `.emails` `.nonlus` `.stats` `.authorise NUMERO`
