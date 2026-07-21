import type { AppConfig } from '../config';

export interface CreateTicketInput {
  summary: string;
  description: string;
  /** Client value from the command — a company name (or code). */
  client: string;
  /** Ticket type name from the command, if provided. */
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
 * Calls the BBB Desktop app's `CreateTicket.ashx` endpoint (see
 * `desktop-endpoint/`), which runs inside the network and creates the ticket
 * via the same ORM logic as the Add Ticket page.
 *
 * Contract:
 *   POST <url>   header X-Api-Key: <key>
 *   body: { Client, TicketType, Summary, Description }
 *   200 -> { TicketId }
 *   409 -> { Error, Candidates: [...] }   (ambiguous client)
 *   4xx -> { Error }
 */
export class DesktopApiClient {
  constructor(private readonly api: AppConfig['api']) {}

  /** True when the endpoint URL and API key are both set. */
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

  async createTicket(input: CreateTicketInput): Promise<CreatedTicket> {
    this.ensureConfigured();

    const res = await fetch(this.api.url!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Api-Key': this.api.apiKey!,
      },
      body: JSON.stringify({
        Client: input.client,
        TicketType: input.typeName ?? '',
        Summary: input.summary,
        Description: input.description,
      }),
    });

    const text = await res.text();
    let data: Record<string, unknown> = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        /* non-JSON error page (e.g. IIS/WAF) — fall through to status handling */
      }
    }

    if (res.ok) {
      const id = Number(data.TicketId ?? data.Id ?? data.id);
      if (!id || Number.isNaN(id)) {
        throw new Error('Endpoint returned success but no TicketId.');
      }
      return { id, url: `${this.api.ticketWebBaseUrl}${id}` };
    }

    const errorMsg = typeof data.Error === 'string' ? data.Error : `${res.status} ${res.statusText}`;

    // Ambiguous / unresolved client → surface as a friendly, actionable error.
    if (res.status === 409 || res.status === 404) {
      const candidates = Array.isArray(data.Candidates) ? (data.Candidates as string[]) : [];
      throw new ClientResolutionError(errorMsg, candidates);
    }

    throw new Error(`Desktop ticket endpoint failed: ${errorMsg}`);
  }
}
