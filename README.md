# Desktop-Ticket — Teams → Teamwork Desk

A Microsoft Teams bot that creates a **Teamwork Desk** ticket from a chat
command and replies to the channel with the new ticket number.

**Phase 1 flow**

```
Teams channel                     This bot (Azure Web App)          Teamwork Desk
─────────────                     ────────────────────────          ─────────────
add_ticket: client=Acme;   ──▶   parse command                ──▶   POST /desk/api/v2/tickets.json
  type=Bug; summary=...;          create ticket via REST
  description=...                 ◀── ticket #12345 ────────────────
◀── "✅ Ticket #12345 created"    reply in same channel
```

## Command format

Type this in the **Desktop-Ticket** channel (mention the bot if required by your channel):

```
add_ticket: client=<name or email>; type=<ticket type>; summary=<short title>; description=<details>
```

- `client`, `summary`, `description` are **required**; `type` is optional.
- Keys accept `=` or `:`; pairs are separated by `;` or new lines.
- Indonesian aliases work too: `klien`, `tipe`, `ringkasan`, `deskripsi`.

Field mapping to Teamwork Desk:

| Command field | Teamwork Desk |
|---------------|---------------|
| `summary`     | ticket subject |
| `description` | first message / body |
| `type`        | ticket type (matched by name → `typeId`) |
| `client`      | if an email → the ticket customer; otherwise the configured `DEFAULT_CUSTOMER_EMAIL` is used and the client name is preserved in the body |

## Tech stack

- Node.js 18+ / TypeScript
- [Bot Framework SDK](https://learn.microsoft.com/azure/bot-service/) (`botbuilder`, `CloudAdapter`)
- Express HTTP server, messaging endpoint `POST /api/messages`
- Teamwork Desk REST API v2 (Bearer API key)

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
| `TEAMWORK_DESK_BASE_URL` | yes | e.g. `https://yourcompany.teamwork.com` |
| `TEAMWORK_DESK_API_KEY` | yes | Desk → avatar → View Profile → API Keys |
| `TEAMWORK_DESK_INBOX_ID` | yes | target inbox id |
| `DEFAULT_CUSTOMER_EMAIL` | recommended | used when `client` is not an email |
| `DEFAULT_STATUS_ID` | no | leave blank for Desk default |
| `DEFAULT_PRIORITY_ID` | no | leave blank for Desk default |
| `PORT` | no | defaults to `3978` |

> The Bot Framework variables are only needed when connected to Teams/Azure.
> `TEAMWORK_DESK_*` are always required because config is validated at startup.

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
  TEAMWORK_DESK_BASE_URL="https://yourcompany.teamwork.com" \
  TEAMWORK_DESK_API_KEY="<desk-api-key>" \
  TEAMWORK_DESK_INBOX_ID="<inbox-id>" \
  DEFAULT_CUSTOMER_EMAIL="helpdesk@yourcompany.com"
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

- A non-email `client` is stored as text in the ticket body and mapped to the
  default customer. Mapping a client name to a specific Desk company/customer is
  a planned enhancement.
- The reply is posted to the same conversation where the command was issued, so
  run `add_ticket` inside the **Desktop-Ticket** channel. Proactive posting to a
  fixed channel from elsewhere can be added later via a stored conversation
  reference.
