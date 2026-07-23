<%@ WebHandler Language="C#" Class="CreateTicketHandler" %>

//  CreateTicket.ashx  —  DRAFT / GENERIC TEMPLATE
//  ------------------------------------------------------------------
//  A small, API-key-protected JSON endpoint for the BBB Desktop app that
//  creates a ticket the SAME way Ticket/Add2.aspx.cs (btnSubmit_Click) does,
//  so the Teams bot can create tickets without touching the database directly.
//
//  WHY THIS LIVES IN THE DESKTOP APP (not in Azure):
//    The staging database is on a private IP (10.34.0.9). Only code running
//    inside your network — like this app — can reach it. The Teams bot (public
//    Azure) calls this endpoint over HTTPS.
//
//  PLACEMENT:
//    Drop this file somewhere in the Desktop web app, e.g. /api/CreateTicket.ashx
//    Public URL becomes:  https://desktop.bbbappdev.com/api/CreateTicket.ashx
//
//  WEB.CONFIG APP SETTINGS (add under <appSettings>):
//    <add key="TeamsBot.ApiKey"            value="<a-long-random-secret>" />
//    <add key="TeamsBot.UserId"            value="<desktop user id to record as EnteredBy/AssignedTo>" />
//    <add key="TeamsBot.DispositionId"     value="99" />   <!-- default "BBB New" -->
//    <add key="TeamsBot.DefaultTicketTypeId" value="3" />  <!-- default "Helpdesk" -->
//
//  CONTRACT:
//    POST  (JSON)   header:  X-Api-Key: <TeamsBot.ApiKey>
//    body: { "Client": "...", "TicketType": "...", "Summary": "...", "Description": "..." }
//    200 -> { "TicketId": 123456 }
//    400 -> { "Error": "..." }              (missing/invalid input)
//    401 -> { "Error": "Unauthorized" }     (bad/missing API key)
//    404 -> { "Error": "No client found ..." }
//    409 -> { "Error": "...", "Candidates": ["Acme Inc", "Acme LLC"] }  (ambiguous client)
//    500 -> { "Error": "..." }
//
//  >>> ADJUST THE  TODO:  BLOCKS TO YOUR CODEBASE (client & ticket-type lookup). <<<

using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Linq;
using System.Web;
using System.Web.Script.Serialization; // System.Web.Extensions (built in)
using SD.LLBLGen.Pro.ORMSupportClasses;

public class CreateTicketHandler : IHttpHandler
{
    private class TicketRequest
    {
        // Names (legacy one-liner path — resolved server-side):
        public string Client { get; set; }
        public string TicketType { get; set; }
        // Resolved IDs (interactive flow path — preferred when present):
        public int? ClientId { get; set; }
        public int? ContactId { get; set; }
        public int? TicketTypeId { get; set; }
        public int? AssignedToId { get; set; }
        public int? TicketCategoryId { get; set; }
        public int? PriorityId { get; set; }
        // Always required:
        public string Summary { get; set; }
        public string Description { get; set; }
    }

    public bool IsReusable { get { return false; } }

    public void ProcessRequest(HttpContext ctx)
    {
        ctx.Response.ContentType = "application/json";
        // Stop IIS from replacing our JSON error bodies with its generic error page,
        // so the bot can read our {Error}/{Candidates} payloads on 4xx/5xx.
        ctx.Response.TrySkipIisCustomErrors = true;

        try
        {
            // ── method ───────────────────────────────────────────────
            if (!string.Equals(ctx.Request.HttpMethod, "POST", StringComparison.OrdinalIgnoreCase))
            {
                Fail(ctx, 405, "Method not allowed. Use POST.");
                return;
            }

            // ── auth (constant-time compare) ─────────────────────────
            string configuredKey = ConfigurationManager.AppSettings["TeamsBot.ApiKey"];
            string providedKey = ctx.Request.Headers["X-Api-Key"];
            if (string.IsNullOrEmpty(configuredKey) || !SafeEquals(configuredKey, providedKey))
            {
                Fail(ctx, 401, "Unauthorized");
                return;
            }

            // ── parse body ───────────────────────────────────────────
            string body;
            using (var reader = new StreamReader(ctx.Request.InputStream))
                body = reader.ReadToEnd();

            TicketRequest req;
            try { req = new JavaScriptSerializer().Deserialize<TicketRequest>(body); }
            catch { Fail(ctx, 400, "Invalid JSON body."); return; }

            if (req == null) { Fail(ctx, 400, "Empty request body."); return; }

            req.Client = (req.Client ?? "").Trim();
            req.Summary = (req.Summary ?? "").Trim();
            req.Description = (req.Description ?? "").Trim();
            req.TicketType = (req.TicketType ?? "").Trim();

            bool haveClientId = req.ClientId.HasValue && req.ClientId.Value > 0;
            var missing = new List<string>();
            if (!haveClientId && req.Client.Length == 0) missing.Add("Client");
            if (req.Summary.Length == 0) missing.Add("Summary");
            if (req.Description.Length == 0) missing.Add("Description");
            if (missing.Count > 0)
            {
                Fail(ctx, 400, "Missing required field(s): " + string.Join(", ", missing));
                return;
            }

            // ── resolve client (prefer explicit id from the interactive flow) ──
            int? clientId;
            if (haveClientId)
            {
                clientId = req.ClientId.Value;
            }
            else
            {
                List<string> candidates;
                clientId = ResolveClientId(req.Client, out candidates);
                if (clientId == null)
                {
                    if (candidates != null && candidates.Count > 1)
                        FailWithCandidates(ctx, 409, "\"" + req.Client + "\" matches multiple clients. Be more specific.", candidates);
                    else
                        Fail(ctx, 404, "No client found matching \"" + req.Client + "\".");
                    return;
                }
            }

            // ── resolve ticket type (explicit id wins, else by name, else default) ──
            int ticketTypeId = (req.TicketTypeId.HasValue && req.TicketTypeId.Value > 0)
                ? req.TicketTypeId.Value
                : ResolveTicketTypeId(req.TicketType);

            // ── create the ticket (mirrors Add2.aspx.cs btnSubmit_Click) ──
            int serviceUserId = GetConfigInt("TeamsBot.UserId", 0);
            // Status/disposition is always "BBB New" for bot-created tickets —
            // the same disposition Add2.aspx.cs defaults a new ticket to.
            int dispositionId = GetConfigInt("TicketDisposition_BBBNewId", 99);
            int assignedTo = (req.AssignedToId.HasValue && req.AssignedToId.Value > 0)
                ? req.AssignedToId.Value
                : serviceUserId;

            var ticket = new DesktopShared.EntityClasses.CscDefectsEntity();
            ticket.InternalOnly = false;
            ticket.Summary = req.Summary;
            ticket.Description = HttpUtility.HtmlEncode(req.Description);
            ticket.Assignedto = assignedTo;
            ticket.FkDisposition = dispositionId;
            ticket.FkStatus = dispositionId == 93 ? 77 : 76;
            ticket.FkClient = clientId;
            ticket.TicketTypeId = ticketTypeId;
            if (req.TicketCategoryId.HasValue && req.TicketCategoryId.Value > 0)
                ticket.TicketCategoryId = req.TicketCategoryId.Value;
            if (req.PriorityId.HasValue && req.PriorityId.Value > 0)
                ticket.FkPriority = req.PriorityId.Value;

            // ── contact / reporter (from the chosen client contact) ──
            if (req.ContactId.HasValue && req.ContactId.Value > 0)
            {
                var cc = new DesktopShared.EntityClasses.ClientContactEntity(req.ContactId.Value);
                if (cc.Fields.State == EntityState.Fetched)
                {
                    string full = (cc.First.Trim() + " " + cc.Last.Trim()).Trim();
                    if (full.Length > 50) full = full.Substring(0, 50);
                    ticket.ReportedByFirst = cc.First.Trim();
                    ticket.ReportedByLast = cc.Last.Trim();
                    ticket.Email = cc.Email.Trim();
                    ticket.Phone = cc.Busphone.Trim();
                    ticket.Reportedby = full;
                    ticket.FkUser = DesktopShared.User.GetIdForClientContact(cc.PclientContact);
                }
            }

            // defaults copied from the Add Ticket page
            ticket.AllowAutoClose = "N";
            ticket.TimerInterval = null;
            ticket.Designation = "N";
            ticket.ReceiveMethod = "P";
            ticket.FkCscprojects = 117;
            ticket.ResponsivePage = true;
            ticket.ReceiveDate = DateTime.Now;
            ticket.EnteredBy = serviceUserId;
            ticket.Lastupdated = DateTime.Now;

            ticket.Save();
            int ticketId = ticket.Pcscdefects;

            // history entry (best-effort; comment out if your History.Add signature differs)
            try
            {
                bool extOk = true, intOk = true;
                int? extMsgId = null, intMsgId = null;
                int historyId = 0; // argument 14 is a ref int (entity id)
                int historyTypeId = DesktopShared.Ticket.History.Type.Id.UpdateByEmployee;
                DesktopShared.Ticket.History.Add(
                    ticketId, serviceUserId, "Ticket Added: Teams", "", true,
                    "", "", false, historyTypeId, DateTime.Now, null, "", null,
                    ref historyId, ref extOk, ref extMsgId, ref intOk, ref intMsgId, true);
            }
            catch { /* history is non-fatal for the bot */ }

            Ok(ctx, ticketId);
        }
        catch (Exception ex)
        {
            Fail(ctx, 500, "Server error: " + ex.Message);
        }
    }

    // ==================================================================
    // TODO: ADJUST THESE TWO LOOKUPS TO YOUR CODEBASE
    // ==================================================================

    /// <summary>
    /// Resolve a company name (or code) to a single ClientId.
    /// Returns null when not found or ambiguous (fills `candidates` when ambiguous).
    ///
    /// TODO: replace the query below with however your app searches clients
    ///       (there may already be a DesktopShared.Client.Search(...) helper).
    ///       This example uses LLBLGen SelfServicing on the ClientEntity — verify
    ///       the collection class name and the "Company" field name in your model.
    /// </summary>
    private int? ResolveClientId(string name, out List<string> candidates)
    {
        candidates = null;
        string term = name.Trim();

        // --- EXAMPLE (verify/replace) -----------------------------------
        var clients = new DesktopShared.CollectionClasses.ClientCollection();
        var filter = new PredicateExpression(
            DesktopShared.HelperClasses.ClientFields.Company % ("%" + term + "%")); // % = LIKE
        clients.GetMulti(filter);

        if (clients.Count == 0) return null;

        // exact (case-insensitive) match wins
        var exact = clients.FirstOrDefault(c =>
            string.Equals((c.Company ?? "").Trim(), term, StringComparison.OrdinalIgnoreCase));
        if (exact != null) return exact.Pclient; // TODO: PK property name (Pclient?)

        if (clients.Count == 1) return clients[0].Pclient;

        candidates = clients.Take(5).Select(c => (c.Company ?? "").Trim()).ToList();
        return null;
        // ----------------------------------------------------------------
    }

    /// <summary>
    /// Resolve a ticket-type name to its id; falls back to TeamsBot.DefaultTicketTypeId.
    ///
    /// TODO: verify the TicketType entity/collection + field names in your model.
    /// </summary>
    private int ResolveTicketTypeId(string typeName)
    {
        int fallback = GetConfigInt("TeamsBot.DefaultTicketTypeId", 3);
        if (string.IsNullOrWhiteSpace(typeName)) return fallback;

        try
        {
            // --- EXAMPLE (verify/replace) -------------------------------
            var types = new DesktopShared.CollectionClasses.TicketTypeCollection();
            types.GetMulti(null);
            var match = types.FirstOrDefault(t =>
                string.Equals((t.Name ?? "").Trim(), typeName.Trim(), StringComparison.OrdinalIgnoreCase));
            // Read the PK generically so we don't depend on its property name.
            return match != null
                ? Convert.ToInt32(match.Fields.PrimaryKeyFields[0].CurrentValue)
                : fallback;
            // ------------------------------------------------------------
        }
        catch { return fallback; }
    }

    // ==================================================================
    // helpers
    // ==================================================================

    private static int GetConfigInt(string key, int fallback)
    {
        int v;
        return int.TryParse(ConfigurationManager.AppSettings[key], out v) ? v : fallback;
    }

    private static bool SafeEquals(string a, string b)
    {
        if (a == null || b == null) return false;
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    private static void Ok(HttpContext ctx, int ticketId)
    {
        ctx.Response.StatusCode = 200;
        ctx.Response.Write(new JavaScriptSerializer().Serialize(new { TicketId = ticketId }));
    }

    private static void Fail(HttpContext ctx, int status, string error)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.Write(new JavaScriptSerializer().Serialize(new { Error = error }));
    }

    private static void FailWithCandidates(HttpContext ctx, int status, string error, List<string> candidates)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.Write(new JavaScriptSerializer().Serialize(new { Error = error, Candidates = candidates }));
    }
}
