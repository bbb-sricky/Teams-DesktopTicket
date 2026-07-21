import type { AppConfig } from '../config';

export interface CreateTicketInput {
  summary: string;
  description: string;
  /** Client value from the command — a company name (or ClientCode). */
  client: string;
  /** Ticket type name from the command, if provided. */
  typeName?: string;
}

export interface CreatedTicket {
  id: number;
  url: string;
}

interface AuthResponse {
  Token?: string;
  Expires?: string;
}

interface ClientRecord {
  ClientId: number;
  ClientName: string;
  ClientCode?: string;
}

interface TicketTypeRecord {
  TicketTypeId: number;
  Name: string;
}

/** Raised when a client name cannot be resolved to a single ClientId. */
export class ClientResolutionError extends Error {
  constructor(message: string, readonly candidates: string[] = []) {
    super(message);
    this.name = 'ClientResolutionError';
  }
}

/**
 * Client for the BBB Desktop.Api (ticketing/PSA).
 *
 * Docs: bundled skill `bbb-desktop-api`.
 *  - Auth: POST /authenticate { UserName, Password } -> { Token, Expires }
 *  - Create: POST /CreateTicket { Summary, Description, ClientId, TicketTypeId? }
 *  - Lookups: GET /GetClients?search=, GET /GetTicketTypes?name=
 */
export class DesktopApiClient {
  private token: string | null = null;
  private tokenExpiresAt = 0; // epoch ms

  constructor(private readonly api: AppConfig['api']) {}

  /** True when credentials are present (base URL always has a default). */
  isConfigured(): boolean {
    return Boolean(this.api.baseUrl && this.api.username && this.api.password);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'Desktop.Api is not configured. Set EXTERNAL_API_USERNAME and EXTERNAL_API_PASSWORD.',
      );
    }
  }

  /** Returns a valid bearer token, authenticating (or refreshing) as needed. */
  private async getToken(force = false): Promise<string> {
    const now = Date.now();
    // Refresh a minute before expiry to avoid edge races.
    if (!force && this.token && now < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    const res = await fetch(`${this.api.baseUrl}/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ UserName: this.api.username, Password: this.api.password }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Desktop.Api authentication failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
      );
    }

    const data = JSON.parse(text) as AuthResponse;
    if (!data.Token) {
      throw new Error('Desktop.Api authentication succeeded but no token was returned.');
    }
    this.token = data.Token;
    // Expires is ~7 days out; fall back to 6 days if unparseable.
    const expiresMs = data.Expires ? Date.parse(data.Expires) : NaN;
    this.tokenExpiresAt = Number.isNaN(expiresMs) ? now + 6 * 24 * 60 * 60 * 1000 : expiresMs;
    return this.token;
  }

  /**
   * Performs an authenticated request, re-authenticating exactly once on 401.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    _retriedAuth = false,
  ): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${this.api.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: '*/*',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && !_retriedAuth) {
      await this.getToken(true); // force re-auth once
      return this.request<T>(method, path, body, true);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Desktop.Api ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`,
      );
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Resolves a company name (or code) to a single ClientId. */
  async resolveClientId(client: string): Promise<number> {
    const term = client.trim();
    const results =
      (await this.request<ClientRecord[]>('GET', `/GetClients?search=${encodeURIComponent(term)}`)) ??
      [];

    if (results.length === 0) {
      throw new ClientResolutionError(`No client found matching "${term}".`);
    }

    const lower = term.toLowerCase();
    const exact = results.find(
      (c) =>
        c.ClientName?.trim().toLowerCase() === lower ||
        c.ClientCode?.trim().toLowerCase() === lower,
    );
    if (exact) return exact.ClientId;

    if (results.length === 1) return results[0].ClientId;

    // Ambiguous: ask the user to be more specific.
    const candidates = results.slice(0, 5).map((c) => c.ClientName).filter(Boolean);
    throw new ClientResolutionError(
      `"${term}" matches multiple clients. Please be more specific.`,
      candidates,
    );
  }

  /** Resolves a ticket-type name (case-insensitive) to its id, or undefined. */
  async resolveTicketTypeId(typeName?: string): Promise<number | undefined> {
    if (!typeName) return undefined;
    const wanted = typeName.trim().toLowerCase();
    const results =
      (await this.request<TicketTypeRecord[]>(
        'GET',
        `/GetTicketTypes?name=${encodeURIComponent(typeName.trim())}`,
      )) ?? [];
    return results.find((t) => t.Name?.trim().toLowerCase() === wanted)?.TicketTypeId;
  }

  /** Creates a ticket and returns its id and a web URL. */
  async createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
    this.ensureConfigured();

    const clientId = await this.resolveClientId(input.client);
    const ticketTypeId = await this.resolveTicketTypeId(input.typeName);

    const payload: Record<string, unknown> = {
      Summary: input.summary,
      Description: input.description,
      ClientId: clientId,
      InternalOnly: false,
    };
    if (ticketTypeId !== undefined) payload.TicketTypeId = ticketTypeId;

    const data = await this.request<Record<string, unknown>>('POST', '/CreateTicket', payload);

    const id = Number(data?.Id ?? data?.TicketId ?? data?.id);
    if (!id || Number.isNaN(id)) {
      throw new Error('Ticket was created but no id was returned by Desktop.Api.');
    }

    return { id, url: `${this.api.ticketWebBaseUrl}${id}` };
  }
}
