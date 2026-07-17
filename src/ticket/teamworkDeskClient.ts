import type { AppConfig } from '../config';

export interface CreateTicketInput {
  subject: string;
  body: string;
  /** Free-text client value from the command (name or email). */
  client: string;
  /** Ticket type name from the command, if provided. */
  typeName?: string;
}

export interface CreatedTicket {
  id: number;
  url: string;
}

interface TicketType {
  id: number;
  name: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Thin REST client for the Teamwork Desk v2 API.
 *
 * Docs: https://apidocs.teamwork.com/docs/desk  (auth: Authorization: Bearer <apiKey>)
 */
export class TeamworkDeskClient {
  private readonly apiBase: string;
  private readonly headers: Record<string, string>;
  private ticketTypeCache: TicketType[] | null = null;

  constructor(private readonly desk: AppConfig['desk']) {
    this.apiBase = `${desk.baseUrl}/desk/api/v2`;
    this.headers = {
      Authorization: `Bearer ${desk.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: this.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Teamwork Desk API ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Loads ticket types once and caches them for the process lifetime. */
  private async getTicketTypes(): Promise<TicketType[]> {
    if (this.ticketTypeCache) return this.ticketTypeCache;
    const data = await this.request<{ tickettypes?: TicketType[] }>(
      'GET',
      '/tickettypes.json',
    );
    this.ticketTypeCache = data.tickettypes ?? [];
    return this.ticketTypeCache;
  }

  /** Resolves a ticket-type name (case-insensitive) to its id, or undefined. */
  async resolveTicketTypeId(typeName?: string): Promise<number | undefined> {
    if (!typeName) return undefined;
    const types = await this.getTicketTypes();
    const wanted = typeName.trim().toLowerCase();
    return types.find((t) => t.name.trim().toLowerCase() === wanted)?.id;
  }

  /**
   * Creates a ticket. Returns the new ticket id and a web URL.
   *
   * Customer handling (phase 1):
   *  - if `client` is an email, Desk matches/creates that customer;
   *  - otherwise the configured DEFAULT_CUSTOMER_EMAIL is used and the client
   *    name is preserved in the ticket body.
   */
  async createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
    const typeId = await this.resolveTicketTypeId(input.typeName);

    const clientIsEmail = EMAIL_RE.test(input.client.trim());
    const customerEmail = clientIsEmail ? input.client.trim() : this.desk.defaultCustomerEmail;

    if (!customerEmail) {
      throw new Error(
        'No customer email available: provide an email as the client, or set DEFAULT_CUSTOMER_EMAIL.',
      );
    }

    // Preserve the named client inside the body when it is not an email.
    const message = clientIsEmail
      ? input.body
      : `Client: ${input.client}\n\n${input.body}`;

    const payload: Record<string, unknown> = {
      inboxId: this.desk.inboxId,
      subject: input.subject,
      // `message` is the body of the first ticket message.
      message,
      customerEmail,
      notifyCustomer: false,
    };
    if (typeId !== undefined) payload.typeId = typeId;
    if (this.desk.defaultStatusId !== undefined) payload.statusId = this.desk.defaultStatusId;
    if (this.desk.defaultPriorityId !== undefined) payload.priorityId = this.desk.defaultPriorityId;

    const data = await this.request<{ ticket?: { id?: number }; id?: number }>(
      'POST',
      '/tickets.json',
      payload,
    );

    const id = data.ticket?.id ?? data.id;
    if (!id) {
      throw new Error('Ticket was created but no id was returned by Teamwork Desk.');
    }

    return {
      id,
      url: `${this.desk.baseUrl}/desk/tickets/${id}`,
    };
  }
}
