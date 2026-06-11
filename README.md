# Boxing Center Bot

Bot WhatsApp + API de messagerie pour contacter les managers boxe (WhatsApp et email via Brevo).

> **Sécurité** : ne partagez jamais les clés Supabase, Brevo ou `SITE_API_SECRET`. Le fichier `.env` est gitignoré.

## Prérequis

- Node.js 18+
- Python 3.10+ (sync managers)
- Compte Supabase configuré
- Clé API Brevo (pour l'email)

## Installation

```bash
cd boxing-center-bot
npm install
cp .env.example .env
# Éditer .env avec vos clés
```

## Migration Supabase

1. Ouvrir le [SQL Editor Supabase](https://supabase.com/dashboard/project/ulxtbvxdueolvnjhpzvw/sql)
2. Exécuter le contenu de `../supabase/migrations/001_boxing_center.sql`

Ou, si `SUPABASE_DB_URL` est configuré :

```bash
python ../scripts/apply_migration_supabase.py
```

## Synchroniser les managers

Depuis la racine du projet infobox :

```bash
pip install requests python-dotenv
python scripts/sync_managers_supabase.py
```

Sources :
- `futurebd/managers_contacts_sans_doublons.csv`
- `futurebd/managers_enrichis.csv` (lignes `enrichi=oui`)
- Manager test **atangana** (`is_test=true`)

## Démarrer le bot + console web

```bash
cd boxing-center-bot
npm start
```

- API santé : `http://localhost:3002/api/status`
- **Connexion** : `http://localhost:3002/login`
- **Tableau de bord** : `http://localhost:3002/dashboard` (après authentification)

### Connexion à la console

1. Ouvrir `http://localhost:3002/login`
2. Saisir le mot de passe défini dans `.env` :
   - `ADMIN_PASSWORD` (recommandé), ou
   - `SITE_API_SECRET` si `ADMIN_PASSWORD` est vide
3. Une session JWT sécurisée (cookie httpOnly, 7 jours) est créée

### Sections de la console

| URL | Section |
|-----|---------|
| `/login` | Page de connexion |
| `/dashboard` | Vue d'ensemble (stats, WhatsApp, messages récents) |
| `/dashboard/managers` | Liste managers, filtres, sélection |
| `/dashboard/envoyer` | Composer messages (WhatsApp / Email) |
| `/dashboard/historique` | Journal des envois |
| `/dashboard/whatsapp` | QR code, statut, messages non lus |
| `/dashboard/parametres` | Infos système et sécurité |

## Lier WhatsApp

1. Section **WhatsApp** (`/dashboard/whatsapp`)
2. Cliquer **Générer QR** et scanner avec WhatsApp
3. Le numéro admin (`MANDATORY_ADMIN_PHONE`) peut utiliser les commandes bot

### Commandes admin (WhatsApp)

| Commande | Description |
|----------|-------------|
| `.menu` | Accueil + logo Boxing Center |
| `.guide` | Liste des commandes |
| `.numeros` / `.phones` | Managers avec téléphone |
| `.emails` | Managers avec email |
| `.nonlus` / `.unread` | Messages entrants non lus |
| `.stats` | Statistiques contacts |

## Test manager atangana

- WhatsApp : `+237693646080`
- Email : `linuxcam05@gmail.com`
- Bouton **Test atangana** dans la console (onglet Composer)

## API principale

**Authentification console** : cookie de session (`bc_auth`) après `POST /api/auth/login`, ou header legacy `x-api-secret: <SITE_API_SECRET>`.

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Connexion (`{ password }`) |
| GET | `/api/auth/me` | Vérifier session |
| POST | `/api/auth/logout` | Déconnexion |
| GET | `/api/status` | État WhatsApp + QR (public) |
| POST | `/api/start` | Démarrer liaison QR |
| POST | `/api/logout` | Déconnexion WhatsApp |
| GET | `/api/managers` | Liste managers |
| POST | `/api/send-message` | WhatsApp unitaire |
| POST | `/api/send-bulk` | WhatsApp en masse |
| POST | `/api/send-email` | Email Brevo |
| POST | `/api/send-to-managers` | Envoi multi-canal |

## Variables d'environnement

Voir `.env.example` pour la liste complète.
