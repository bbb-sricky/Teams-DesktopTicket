import type { AppConfig } from '../config';

/** A generic pick-list option returned by the lookup endpoint. */
export interface LookupOption {
  id: number;
  name: string;
}

export interface CreateTicketInput {
  summary: string;
  description: string;
  // Interactive flow supplies resolved IDs:
  clientId?: number;
  contactId?: number;
  typeId?: number;
  assignedToId?: number;
  categoryId?: number;
  priorityId?: number;
  // Legacy one-liner supplies names (resolved server-side):
  client?: string;
  typeName?: string;
}

export interface CreatedTicket {
  id: number;
  url: string;
}

/** Raised when the endpoint reports the client name is missing/ambiguous. */
export class ClientResolutionError extends Error {
  constructor(message: string, readonly candidates: string[] = []) {
    super(message);
    this.name = 'ClientResolutionError';
  }
}

/**
 * Calls the BBB Desktop app endpoints (see `desktop-endpoint/`):
 *  - CreateTicket.ashx  — creates a ticket
 *  - DesktopLookups.ashx — returns pick-lists (clients, contacts, types, …)
 * Both run inside the network and are secured with the X-Api-Key header.
 */
export class DesktopApiClient {
  constructor(private readonly api: AppConfig['api']) {}

  isConfigured(): boolean {
    return Boolean(this.api.url && this.api.apiKey);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'Desktop ticket endpoint is not configured. Set DESKTOP_TICKET_API_URL and DESKTOP_TICKET_API_KEY.',
      );
    }
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'X-Api-Key': this.api.apiKey ?? '',
    };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // ─── Lookups ─────────────────────────────────────────────────────────

  /** Generic list fetch against DesktopLookups.ashx. */
  private async lookup(type: string, params: Record<string, string | number | undefined> = {}): Promise<LookupOption[]> {
    if (!this.api.lookupUrl) {
      throw new Error('Lookup endpoint is not configured (DESKTOP_LOOKUP_API_URL).');
    }
    const qs = new URLSearchParams({ type });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && `${v}` !== '') qs.set(k, `${v}`);
    }
    const res = await fetch(`${this.api.lookupUrl}?${qs.toString()}`, { headers: this.headers() });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Lookup "${type}" failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
    }
    const data = text ? JSON.parse(text) : [];
    const arr: unknown[] = Array.isArray(data) ? data : [];
    return arr
      .map((r) => {
        const o = r as Record<string, unknown>;
        return { id: Number(o.id ?? o.Id), name: String(o.name ?? o.Name ?? '') };
      })
      .filter((o) => !Number.isNaN(o.id) && o.name !== '');
  }

  searchClients(term: string): Promise<LookupOption[]> {
    return this.lookup('clients', { search: term });
  }
  getContacts(clientId: number): Promise<LookupOption[]> {
    return this.lookup('contacts', { clientId });
  }
  getTicketTypes(): Promise<LookupOption[]> {
    return this.lookup('tickettypes');
  }
  searchEmployees(term: string): Promise<LookupOption[]> {
    return this.lookup('employees', { search: term });
  }
  getCategories(clientId: number): Promise<LookupOption[]> {
    return this.lookup('categories', { clientId });
  }
  getPriorities(): Promise<LookupOption[]> {
    return this.lookup('priorities');
  }

  // ─── Create ──────────────────────────────────────────────────────────

  async createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
    this.ensureConfigured();

    const payload: Record<string, unknown> = {
      Summary: input.summary,
      Description: input.description,
    };
    // Prefer resolved IDs (interactive flow); fall back to names (legacy).
    if (input.clientId !== undefined) payload.ClientId = input.clientId;
    else if (input.client) payload.Client = input.client;
    if (input.contactId !== undefined) payload.ContactId = input.contactId;
    if (input.typeId !== undefined) payload.TicketTypeId = input.typeId;
    else if (input.typeName) payload.TicketType = input.typeName;
    if (input.assignedToId !== undefined) payload.AssignedToId = input.assignedToId;
    if (input.categoryId !== undefined) payload.TicketCategoryId = input.categoryId;
    if (input.priorityId !== undefined) payload.PriorityId = input.priorityId;

    const res = await fetch(this.api.url!, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        /* non-JSON error page — fall through */
      }
    }

    if (res.ok) {
      const id = Number(data.TicketId ?? data.Id ?? data.id);
      if (!id || Number.isNaN(id)) throw new Error('Endpoint returned success but no TicketId.');
      return { id, url: `${this.api.ticketWebBaseUrl}${id}` };
    }

    const errorMsg = typeof data.Error === 'string' ? data.Error : `${res.status} ${res.statusText}`;
    if (res.status === 409 || res.status === 404) {
      const candidates = Array.isArray(data.Candidates) ? (data.Candidates as string[]) : [];
      throw new ClientResolutionError(errorMsg, candidates);
    }
    throw new Error(`Desktop ticket endpoint failed: ${errorMsg}`);
  }
}
