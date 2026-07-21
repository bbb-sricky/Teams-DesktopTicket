# Desktop app endpoint — `CreateTicket.ashx`

This is the **server-side** half of the Teams integration, meant to live **inside
your existing BBB Desktop web app** (staging: `desktop.bbbappdev.com`). It exposes
a tiny, API-key-protected JSON endpoint that creates a ticket using the same
`CscDefectsEntity` logic as `Ticket/Add2.aspx.cs`.

The Teams bot (hosted on Azure) cannot reach the database directly — the DB is on
a private IP (`10.34.0.9`). This endpoint runs where the DB *is* reachable and the
bot calls it over HTTPS.

```
Teams → Bot (Azure) → HTTPS + X-Api-Key → CreateTicket.ashx (inside network) → DB → ticket #
```

## Install

1. Copy `CreateTicket.ashx` into the Desktop web app, e.g. under an `/api/` folder:
   `.../DesktopWeb/api/CreateTicket.ashx`
   → URL becomes `https://desktop.bbbappdev.com/api/CreateTicket.ashx`

2. Add these to `<appSettings>` in the app's `Web.config`:

   ```xml
   <add key="TeamsBot.ApiKey"              value="PUT-A-LONG-RANDOM-SECRET-HERE" />
   <add key="TeamsBot.UserId"              value="0" />   <!-- Desktop user id recorded as EnteredBy / AssignedTo -->
   <add key="TeamsBot.DispositionId"       value="99" />  <!-- default disposition ("BBB New") -->
   <add key="TeamsBot.DefaultTicketTypeId" value="3" />   <!-- default ticket type ("Helpdesk") -->
   ```

   Generate a strong `TeamsBot.ApiKey` (e.g. a 32+ char random string). The Teams
   bot must send the **same** value in the `X-Api-Key` header.

3. **Adjust the two `TODO:` lookups** in the handler (`ResolveClientId`,
   `ResolveTicketTypeId`) to match your LLBLGen model — verify the collection
   class names (`ClientCollection` / `TicketTypeCollection`), the search field
   (`Company`), and the PK property names (`Pclient` / `PticketType`). If you
   already have a client-search helper in `DesktopShared`, call that instead.

## Contract

`POST` with header `X-Api-Key: <TeamsBot.ApiKey>` and JSON body:

```json
{ "Client": "Acme Corp", "TicketType": "Helpdesk", "Summary": "VPN down", "Description": "All NYC users affected." }
```

Responses:

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{ "TicketId": 123456 }` | created |
| 400 | `{ "Error": "..." }` | missing/invalid input |
| 401 | `{ "Error": "Unauthorized" }` | bad/missing API key |
| 404 | `{ "Error": "No client found ..." }` | client not found |
| 409 | `{ "Error": "...", "Candidates": [...] }` | client name ambiguous |
| 500 | `{ "Error": "..." }` | server error |

## Quick test (once deployed)

```bash
curl -i -X POST "https://desktop.bbbappdev.com/api/CreateTicket.ashx" \
  -H "X-Api-Key: <your-secret>" \
  -H "Content-Type: application/json" \
  -d '{"Client":"<a real staging client>","TicketType":"Helpdesk","Summary":"Test from bot","Description":"Ignore — integration test."}'
```

A `200` with a `TicketId` means the whole chain works; point the Teams bot at this
URL next (`DESKTOP_TICKET_API_URL` + `DESKTOP_TICKET_API_KEY`).

## Notes / things to confirm

- **Required columns:** `Add2.aspx.cs` also sets `ReportedBy*`, `Email`, `Phone`
  from the selected contact. This endpoint leaves them unset (no contact from
  chat). If any of those DB columns are non-nullable, set safe defaults here.
- **Service user:** `TeamsBot.UserId` is stamped as `EnteredBy`/`AssignedTo`.
  Use a dedicated "Teams Bot" Desktop user so bot-created tickets are attributable.
- **No emails by default:** the history entry is added with `sendEmail = false`.
  Flip that only when you intend outbound notifications.
