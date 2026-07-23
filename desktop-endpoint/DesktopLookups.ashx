<%@ WebHandler Language="C#" Class="DesktopLookupsHandler" %>

//  DesktopLookups.ashx  —  DRAFT / GENERIC TEMPLATE
//  ------------------------------------------------------------------
//  Read-only pick-lists for the Teams bot's interactive flow. Returns JSON
//  arrays of { id, name }. Same X-Api-Key auth as CreateTicket.ashx.
//
//  Place next to CreateTicket.ashx (e.g. /api/DesktopLookups.ashx) and add the
//  same <location> anonymous-access entry in Web.config for its path.
//
//  GET DesktopLookups.ashx?type=<t>[&search=..&clientId=..]   header X-Api-Key
//    type=clients      &search=   -> [{id,name}]  (company name/code LIKE)
//    type=contacts     &clientId= -> [{id,name}]  (contacts of a client)
//    type=tickettypes             -> [{id,name}]
//    type=employees    &search=   -> [{id,name}]  (assignable techs)
//    type=categories   &clientId= -> [{id,name}]  (per client)
//    type=priorities              -> [{id,name}]
//
//  >>> The lookups marked TODO need their entity/field names verified against
//      your LLBLGen model — same iterate-by-compiler approach as CreateTicket. <<<

using System;
using System.Collections.Generic;
using System.Configuration;
using System.Linq;
using System.Web;
using System.Web.Script.Serialization;
using SD.LLBLGen.Pro.ORMSupportClasses;

public class DesktopLookupsHandler : IHttpHandler
{
    public bool IsReusable { get { return false; } }

    public void ProcessRequest(HttpContext ctx)
    {
        ctx.Response.ContentType = "application/json";
        ctx.Response.TrySkipIisCustomErrors = true;

        try
        {
            string configuredKey = ConfigurationManager.AppSettings["TeamsBot.ApiKey"];
            string providedKey = ctx.Request.Headers["X-Api-Key"];
            if (string.IsNullOrEmpty(configuredKey) || !SafeEquals(configuredKey, providedKey))
            {
                ctx.Response.StatusCode = 401;
                ctx.Response.Write("{\"Error\":\"Unauthorized\"}");
                return;
            }

            string type = (ctx.Request.QueryString["type"] ?? "").Trim().ToLowerInvariant();
            string search = (ctx.Request.QueryString["search"] ?? "").Trim();
            int clientId = ParseInt(ctx.Request.QueryString["clientId"]);

            List<object> result;
            switch (type)
            {
                case "clients":      result = Clients(search); break;
                case "contacts":     result = Contacts(clientId); break;
                case "tickettypes":  result = TicketTypes(); break;
                case "employees":    result = Employees(search); break;
                case "categories":   result = Categories(clientId); break;
                case "priorities":   result = Priorities(); break;
                default:
                    ctx.Response.StatusCode = 400;
                    ctx.Response.Write("{\"Error\":\"Unknown or missing 'type'.\"}");
                    return;
            }

            ctx.Response.Write(new JavaScriptSerializer().Serialize(result));
        }
        catch (Exception ex)
        {
            ctx.Response.StatusCode = 500;
            ctx.Response.Write(new JavaScriptSerializer().Serialize(new { Error = ex.Message }));
        }
    }

    private const int MaxRows = 25;
    private static object Item(int id, string name) { return new { id = id, name = (name ?? "").Trim() }; }
    private static int Pk(IEntity2 e) { return Convert.ToInt32(e.Fields.PrimaryKeyFields[0].CurrentValue); }
    // SelfServicing entities implement IEntity (not IEntity2); overload for that:
    private static int Pk(IEntity e) { return Convert.ToInt32(e.Fields.PrimaryKeyFields[0].CurrentValue); }

    // ── clients (PROVEN pattern) ─────────────────────────────────────────
    private List<object> Clients(string search)
    {
        var col = new DesktopShared.CollectionClasses.ClientCollection();
        IPredicateExpression filter = new PredicateExpression();
        if (search.Length > 0)
            filter.Add(DesktopShared.HelperClasses.ClientFields.Company % ("%" + search + "%"));
        col.GetMulti(filter);
        return col.Cast<DesktopShared.EntityClasses.ClientEntity>()
                  .OrderBy(c => (c.Company ?? "").Trim())
                  .Take(MaxRows)
                  .Select(c => Item(c.Pclient, c.Company))
                  .ToList();
    }

    // ── ticket types (PROVEN pattern) ────────────────────────────────────
    private List<object> TicketTypes()
    {
        var col = new DesktopShared.CollectionClasses.TicketTypeCollection();
        col.GetMulti(null);
        return col.Cast<IEntity>()
                  .Select(e => Item(Pk(e), (string)e.Fields["Name"].CurrentValue))
                  .OrderBy(x => 0) // keep API order
                  .ToList();
    }

    // ── contacts of a client (fairly confident) ──────────────────────────
    // ClientContactEntity: PclientContact (PK), First, Last, FkClient  (seen in Add2.aspx.cs)
    private List<object> Contacts(int clientId)
    {
        if (clientId <= 0) return new List<object>();
        var col = new DesktopShared.CollectionClasses.ClientContactCollection();
        var filter = new PredicateExpression(
            DesktopShared.HelperClasses.ClientContactFields.FkClient == clientId);
        col.GetMulti(filter);
        return col.Cast<DesktopShared.EntityClasses.ClientContactEntity>()
                  .Select(c => Item(c.PclientContact, (c.First + " " + c.Last).Trim()))
                  .OrderBy(x => x == null ? "" : ((dynamic)x).name)
                  .Take(200)
                  .ToList();
    }

    // ── employees / assignable techs (TODO: verify entity + fields) ───────
    private List<object> Employees(string search)
    {
        // TODO: verify collection name (EmployeeCollection?), name fields
        //       (First/Last? Name?), and PK. Filter by the search term.
        var col = new DesktopShared.CollectionClasses.EmployeeCollection();
        IPredicateExpression filter = new PredicateExpression();
        if (search.Length > 0)
        {
            var f = DesktopShared.HelperClasses.EmployeeFields;
            filter.Add(f.First % ("%" + search + "%") | f.Last % ("%" + search + "%"));
        }
        col.GetMulti(filter);
        return col.Cast<IEntity>()
                  .Select(e => Item(Pk(e),
                      (((e.Fields["First"] != null ? e.Fields["First"].CurrentValue : "") + " " +
                        (e.Fields["Last"] != null ? e.Fields["Last"].CurrentValue : "")).ToString()).Trim()))
                  .Take(MaxRows)
                  .ToList();
    }

    // ── ticket categories for a client (TODO: verify entity + fields) ─────
    private List<object> Categories(int clientId)
    {
        // TODO: verify collection (TicketCategoryCollection?), Name field, and
        //       how it filters by client (FkClient? or a helper). Mirror
        //       ddlTicketCategory.PopulateDropDownList(clientId) from Add2.aspx.cs.
        var col = new DesktopShared.CollectionClasses.TicketCategoryCollection();
        col.GetMulti(null);
        return col.Cast<IEntity>()
                  .Select(e => Item(Pk(e), (string)e.Fields["Name"].CurrentValue))
                  .ToList();
    }

    // ── priorities (TODO: verify entity + fields) ─────────────────────────
    private List<object> Priorities()
    {
        // TODO: verify collection (PriorityCollection? TicketPriorityCollection?)
        //       and the display field (Name?).
        var col = new DesktopShared.CollectionClasses.PriorityCollection();
        col.GetMulti(null);
        return col.Cast<IEntity>()
                  .Select(e => Item(Pk(e), (string)e.Fields["Name"].CurrentValue))
                  .ToList();
    }

    private static int ParseInt(string s) { int v; return int.TryParse(s, out v) ? v : 0; }

    private static bool SafeEquals(string a, string b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}
