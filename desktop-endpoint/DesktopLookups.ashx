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

    // ── ticket types (active only) ───────────────────────────────────────
    private List<object> TicketTypes()
    {
        var list = new List<object>();
        // Get(true) = active ticket types only (Get(null) would return all).
        foreach (DesktopShared.EntityClasses.TicketTypeEntity t in DesktopShared.Ticket.TypeHelper.Get(true))
            list.Add(Item(t.Id, t.Name));
        return list;
    }

    // ── contacts of a client (same source as the ClientContact dropdown) ──
    private List<object> Contacts(int clientId)
    {
        var list = new List<object>();
        if (clientId <= 0) return list;
        System.Data.DataTable dt = DesktopShared.Client.GetActiveContacts(clientId, "");
        if (dt == null) return list;
        foreach (System.Data.DataRow r in dt.Rows)
            list.Add(Item(Convert.ToInt32(r["PclientContact"]), Convert.ToString(r["FullName"])));
        return list;
    }

    // ── employees / assignable techs (same source as the AssignTo dropdown) ──
    // GetAssignToActiveEmployees() DataTable has Pusers + FullName; Add2 uses
    // the Pusers value as the ticket's Assignedto.
    private List<object> Employees(string search)
    {
        var list = new List<object>();
        System.Data.DataTable dt = DesktopShared.Employee.GetAssignToActiveEmployees();
        if (dt == null) return list;
        string s = (search ?? "").Trim().ToLowerInvariant();
        foreach (System.Data.DataRow r in dt.Rows)
        {
            string full = Convert.ToString(r["FullName"]) ?? "";
            if (s.Length > 0 && full.ToLowerInvariant().IndexOf(s) < 0) continue;
            list.Add(Item(Convert.ToInt32(r["Pusers"]), full));
            if (list.Count >= MaxRows) break;
        }
        return list;
    }

    // ── ticket categories for a client (same stored proc as the dropdown) ──
    private List<object> Categories(int clientId)
    {
        var list = new List<object>();
        string cs = ConfigurationManager.AppSettings["ConnectionString.SQL Server (SqlClient)"];
        using (var conn = new System.Data.SqlClient.SqlConnection(cs))
        {
            var dt = new System.Data.DataTable();
            using (var adp = new System.Data.SqlClient.SqlDataAdapter("proc_GetDefaultTicketCategory", conn))
            {
                adp.SelectCommand.CommandType = System.Data.CommandType.StoredProcedure;
                adp.SelectCommand.Parameters.AddWithValue("@clientid", clientId > 0 ? (object)clientId : DBNull.Value);
                adp.Fill(dt);
            }
            foreach (System.Data.DataRow r in dt.Rows)
                list.Add(Item(Convert.ToInt32(r["Id"]), Convert.ToString(r["CategoryName"])));
        }
        return list;
    }

    // ── priorities (same source as the TicketPriority dropdown) ──────────
    private List<object> Priorities()
    {
        var list = new List<object>();
        foreach (DesktopShared.EntityClasses.CscFieldsEntity p in DesktopShared.Ticket.CscField.GetPriorities())
            list.Add(Item(p.Pcscfields, p.AlternateDisplayText));
        return list;
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
