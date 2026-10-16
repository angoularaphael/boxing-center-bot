# BC-Manager-Hub — prem-eu4.bot-hosting.net:21357

Nom Bothosting recommande : **BC-Manager-Hub** (projet historique `gestion-manager-1`).

Ce serveur centralise :

- WhatsApp managers / promoteurs / boxeurs (Baileys)
- API appelee par gestion-manager (Vercel)
- SMS sortants via la gateway (URL separee, meme secrets)
- Commandes admin `.savecontacts`, `.purge`, campagnes bot

## 1. Bothosting (container)

1. Projet Node sur **prem-eu4**, port **21357**.
2. `index.js` = copie de `bootstrap.js` (clone GitHub `boxing-center-bot`).
3. Fichier `/home/container/.env` (a cote de `index.js`) :

```env
SERVER_PORT=21357
PORT=21357
BOT_PUBLIC_HOST=prem-eu4.bot-hosting.net
BOT_DISPLAY_NAME=BC-Manager-Hub
BOT_INSTANCE_ID=bc_manager_hub
BOT_PUBLIC_URL=http://prem-eu4.bot-hosting.net:21357

SITE_API_SECRET=<meme que Vercel>
NEXT_PUBLIC_SITE_URL=https://manager.boxingcenter.fr

SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

BREVO_API_KEY=...
BREVO_SENDER_EMAIL=suzinabot@11426075.brevosend.com
BREVO_SENDER_NAME=Boxing Center

SMS_GATEWAY_URL=http://prem-eu2.bot-hosting.net:21724
SMS_GATEWAY_SECRET=...

MANDATORY_ADMIN_PHONE=...
```

4. Redemarrer le serveur, puis `POST /api/git-sync` avec `restart: true` apres chaque push Git, ou redemarrage manuel.
5. Lier WhatsApp : gestion-manager (statut bot) ou `GET /api/status?qr=1`.

## 2. Vercel (gestion-manager)

Variables a aligner sur le hub :

```env
NEXT_PUBLIC_WHATSAPP_BOT_URL=http://prem-eu4.bot-hosting.net:21357
SITE_API_SECRET=<meme que le bot>
BREVO_API_KEY=...
```

Pour tout router sur le meme bot (option centralisation totale campagnes clients) :

```env
WHATSAPP_BOT_URL_MINIMES=http://prem-eu4.bot-hosting.net:21357
WHATSAPP_BOT_URL_ST_CYPRIEN=http://prem-eu4.bot-hosting.net:21357
WHATSAPP_BOT_URL_RAMONVILLE=http://prem-eu4.bot-hosting.net:21357
WHATSAPP_CAMPAIGN_BOT_URL_1=http://prem-eu4.bot-hosting.net:21357
```

Redeployer Vercel apres modification.

## 3. Supabase

Executer une fois `supabase/migrations/020_outbound_sms_channel.sql` si pas encore fait.

## 4. Verification

1. `curl http://prem-eu4.bot-hosting.net:21357/api/status` (etat WA).
2. Admin gestion-manager : resume bot OK.
3. WhatsApp admin : `.ping` puis `.test`.
4. Admin : Envoyer managers -> test giffareno237 (email + WA + SMS).

## 5. Anciens serveurs

Arreter ou ne plus pointer Vercel vers les anciens ports (us2:21334, 20125, etc.) pour eviter deux sessions WhatsApp sur le meme numero.
