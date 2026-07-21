# Desktop-Ticket — Teams → BBB Desktop

A Microsoft Teams bot that creates a **BBB Desktop** ticket from a chat command
and replies to the channel with the new ticket number. Targets the **staging**
environment.

Because the Desktop database is on a private network, the bot does **not** touch
it directly. Instead a small endpoint (`CreateTicket.ashx`, see
[`desktop-endpoint/`](desktop-endpoint/)) is deployed **inside** the Desktop app
where the DB is reachable, and the bot calls it over HTTPS with an API key.

**Phase 1 flow**

```
Teams channel                 Bot (Azure Web App)        CreateTicket.ashx (in Desktop app)   DB
─────────────                 ───────────────────        ─────────────────────────────────   ──
add_ticket: client=Acme;  ─▶  parse command         ─▶   verify X-Api-Key
  type=Helpdesk;              POST JSON + X-Api-Key       resolve client + type            ─▶  insert
  summary=...; description=…                               create ticket (CscDefectsEntity) ◀─  #12345
◀── "✅ Ticket #12345 created"  reply in channel     ◀─   { TicketId: 12345 }
```

The server-side endpoint is a separate, self-contained draft — see
[`desktop-endpoint/README.md`](desktop-endpoint/README.md) for install steps.

## Command format

Type this in the **Desktop-Ticket** channel (mention the bot if required by your channel):

```
add_ticket: client=<company name>; type=<ticket type>; summary=<short title>; description=<details>
```

- `client`, `summary`, `description` are **required**; `type` is optional.
- Keys accept `=` or `:`; pairs are separated by `;` or new lines.
- Indonesian aliases work too: `klien`, `tipe`, `ringkasan`, `deskripsi`.

Field mapping (sent to `CreateTicket.ashx`):

| Command field | Endpoint field | Notes |
|---------------|----------------|-------|
| `summary`     | `Summary`      | ticket summary |
| `description` | `Description`  | ticket body |
| `client`      | `Client`       | resolved to a `ClientId` **server-side**; ambiguous names come back as a `409` with candidate suggestions |
| `type`        | `TicketType`   | resolved to a `TicketTypeId` server-side; falls back to a default |

## Tech stack

- **Bot (this repo):** Node.js 18+ / TypeScript, [Bot Framework SDK](https://learn.microsoft.com/azure/bot-service/) (`botbuilder`, `CloudAdapter`), Express (`POST /api/messages`). Deployed to Azure App Service.
- **Endpoint (`desktop-endpoint/`):** C# ASP.NET generic handler (`.ashx`) dropped into the existing Desktop app; reuses its LLBLGen ORM. Deployed to staging `desktop.bbbappdev.com`.

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
| `DESKTOP_TICKET_API_URL` | yes | full URL of `CreateTicket.ashx` (e.g. `https://desktop.bbbappdev.com/api/CreateTicket.ashx`) |
| `DESKTOP_TICKET_API_KEY` | yes | shared secret; must match `TeamsBot.ApiKey` in the Desktop app's Web.config |
| `DESKTOP_TICKET_WEB_BASE_URL` | no | link base for the reply; defaults to staging `Detail2.aspx?Id=` |
| `PORT` | no | defaults to `3978` |

> The server boots even when settings are missing (so deploys succeed); `/` and
> `/health` report what's still unset. Ticket creation needs
> `DESKTOP_TICKET_API_URL` + `DESKTOP_TICKET_API_KEY`; Teams connectivity needs
> the `MICROSOFT_APP_*` values.

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
  DESKTOP_TICKET_API_URL="https://desktop.bbbappdev.com/api/CreateTicket.ashx" \
  DESKTOP_TICKET_API_KEY="<same-secret-as-Web.config-TeamsBot.ApiKey>"
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

- `client` must resolve to a single Desktop client (server-side). An ambiguous
  name is rejected and the bot replies with candidate names to retry with.
- The ticket is created with `Summary`, `Description`, client, and ticket type.
  Contact, assignee, status, and priority use the endpoint's configured defaults
  (`TeamsBot.*` in Web.config) — wiring those into the command is a planned
  enhancement.
- The reply is posted to the same conversation where the command was issued, so
  run `add_ticket` inside the **Desktop-Ticket** channel. Proactive posting to a
  fixed channel from elsewhere can be added later via a stored conversation
  reference.
- Targets the **staging** Desktop app. Point `DESKTOP_TICKET_API_URL` /
  `DESKTOP_TICKET_WEB_BASE_URL` at production when ready.
