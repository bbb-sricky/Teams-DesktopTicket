# Desktop-Ticket — Teams → BBB Desktop

A Microsoft Teams bot that creates a **BBB Desktop** ticket (via the
`Desktop.Api` REST API) from a chat command and replies to the channel with the
new ticket number. Defaults to the **staging** environment.

**Phase 1 flow**

```
Teams channel                     This bot (Azure Web App)          Desktop.Api (staging)
─────────────                     ────────────────────────          ─────────────────────
add_ticket: client=Acme;   ──▶   parse command                ──▶   POST /authenticate (JWT)
  type=Helpdesk;                  resolve client + type         ──▶   GET  /GetClients, /GetTicketTypes
  summary=...; description=...     create ticket                ──▶   POST /CreateTicket
◀── "✅ Ticket #12345 created"    reply in same channel         ◀── { Id: 12345 }
```

## Command format

Type this in the **Desktop-Ticket** channel (mention the bot if required by your channel):

```
add_ticket: client=<company name>; type=<ticket type>; summary=<short title>; description=<details>
```

- `client`, `summary`, `description` are **required**; `type` is optional.
- Keys accept `=` or `:`; pairs are separated by `;` or new lines.
- Indonesian aliases work too: `klien`, `tipe`, `ringkasan`, `deskripsi`.

Field mapping to Desktop.Api (`TicketCreateModel`):

| Command field | Desktop.Api |
|---------------|-------------|
| `summary`     | `Summary` |
| `description` | `Description` |
| `client`      | resolved to `ClientId` via `GET /GetClients?search=` (exact name/code match, else the sole result; ambiguous names are rejected with suggestions) |
| `type`        | resolved to `TicketTypeId` via `GET /GetTicketTypes?name=` |

## Tech stack

- Node.js 18+ / TypeScript
- [Bot Framework SDK](https://learn.microsoft.com/azure/bot-service/) (`botbuilder`, `CloudAdapter`)
- Express HTTP server, messaging endpoint `POST /api/messages`
- BBB Desktop.Api (JWT bearer; staging `https://desktop-api.bbbappdev.com`)

## Local development

```bash
npm install
cp .env.example .env      # fill in the values (see below)
npm run dev               # hot-reload with tsx
# or
npm run build && npm start
```

Run the parser tests:

```bash
npm test
```

To exercise the bot locally without Teams, use the
[Bot Framework Emulator](https://github.com/microsoft/BotFramework-Emulator)
pointed at `http://localhost:3978/api/messages`.

## Configuration (`.env`)

| Variable | Required | Notes |
|----------|----------|-------|
| `MICROSOFT_APP_ID` | yes (in Teams) | Azure Bot / app registration client id |
| `MICROSOFT_APP_PASSWORD` | yes (in Teams) | client secret |
| `MICROSOFT_APP_TYPE` | no | `MultiTenant` (default), `SingleTenant`, or `UserAssignedMSI` |
| `MICROSOFT_APP_TENANT_ID` | if SingleTenant | Entra tenant id |
| `EXTERNAL_API_USERNAME` | yes | Desktop.Api service-account username (e.g. `desktop-www`) |
| `EXTERNAL_API_PASSWORD` | yes | Desktop.Api service-account password |
| `DESKTOP_API_BASE_URL` | no | defaults to staging `https://desktop-api.bbbappdev.com`; set to `https://desktop-api.bitxbit.com` for production |
| `DESKTOP_TICKET_WEB_BASE_URL` | no | link base for the reply; defaults to staging `Detail2.aspx?Id=` |
| `PORT` | no | defaults to `3978` |

> The server boots even when settings are missing (so deploys succeed); `/` and
> `/health` report what's still unset. Ticket creation needs the
> `EXTERNAL_API_*` credentials; Teams connectivity needs the `MICROSOFT_APP_*`
> values.

## Deploy to Azure (recommended for phase 1)

You need **three** Azure pieces: an App Service (hosts this code), an Azure Bot
registration (connects Teams to the App Service), and the Teams app package
(sideloaded or published).

### 1. Create the Azure Web App (App Service)

```bash
az group create -n rg-desktopticket -l southeastasia
az appservice plan create -n plan-desktopticket -g rg-desktopticket --sku B1 --is-linux
az webapp create -n app-desktopticket -g rg-desktopticket \
  --plan plan-desktopticket --runtime "NODE:20-lts"

# Build TypeScript during deployment
az webapp config appsettings set -n app-desktopticket -g rg-desktopticket \
  --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true

# Startup command (Linux)
az webapp config set -n app-desktopticket -g rg-desktopticket \
  --startup-file "npm run build && npm start"
```

### 2. Create the Azure Bot registration

- In the Azure Portal create an **Azure Bot** resource (Multi-tenant is simplest).
- Note its **Microsoft App ID** and create a **client secret**.
- Set the **Messaging endpoint** to:
  `https://app-desktopticket.azurewebsites.net/api/messages`
- Under **Channels**, add the **Microsoft Teams** channel.

### 3. Set app settings on the Web App

```bash
az webapp config appsettings set -n app-desktopticket -g rg-desktopticket --settings \
  MICROSOFT_APP_ID="<app-id>" \
  MICROSOFT_APP_PASSWORD="<secret>" \
  MICROSOFT_APP_TYPE="MultiTenant" \
  EXTERNAL_API_USERNAME="<desktop-api-service-account>" \
  EXTERNAL_API_PASSWORD="<desktop-api-password>" \
  DESKTOP_API_BASE_URL="https://desktop-api.bbbappdev.com"
```

### 4. Deploy the code

```bash
npm ci && npm run build
zip -r deploy.zip . -x "node_modules/*" ".git/*"
az webapp deploy -n app-desktopticket -g rg-desktopticket --src-path deploy.zip --type zip
```

(or connect the GitHub repo via App Service → Deployment Center for CI/CD.)

### 5. Package and install the Teams app

1. Edit `appPackage/manifest.json`: replace both `<<BOT_APP_ID>>` tokens with
   your Microsoft App ID, and add your Web App host to `validDomains`
   (e.g. `app-desktopticket.azurewebsites.net`).
   > The icons `color.png` / `outline.png` are committed; regenerate them any
   > time with `python3 scripts/gen-icons.py`.
2. Zip the three files **at the root** of the archive:
   ```bash
   cd appPackage && zip ../DesktopTicket.zip manifest.json color.png outline.png
   ```
3. In Teams: **Apps → Manage your apps → Upload an app → Upload a custom app**,
   choose `DesktopTicket.zip`, and add it to the **Desktop-Ticket** channel/team.

## Known limitations (phase 1)

- `client` must resolve to a single Desktop client. An exact name/code match (or
  a single search result) is used; an ambiguous name is rejected and the bot
  replies with candidate names so the user can retry more specifically.
- The ticket is created with only `Summary`, `Description`, `ClientId`, and
  optional `TicketTypeId`. Contact, assignee, status, priority, and timesheet
  entries are left to Desktop.Api defaults — wiring those into the command is a
  planned enhancement.
- The reply is posted to the same conversation where the command was issued, so
  run `add_ticket` inside the **Desktop-Ticket** channel. Proactive posting to a
  fixed channel from elsewhere can be added later via a stored conversation
  reference.
- Defaults target the **staging** environment. Switch `DESKTOP_API_BASE_URL` and
  `DESKTOP_TICKET_WEB_BASE_URL` to the production hosts when ready.
