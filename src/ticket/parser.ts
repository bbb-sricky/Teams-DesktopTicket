/**
 * Parser for the `add_ticket` chat command.
 *
 * Supported shape (case-insensitive keys, flexible separators):
 *
 *   add_ticket: client=Acme Corp; type=Bug; summary=Login broken; description=User cannot log in
 *
 * Keys may use `=` or `:` and pairs may be separated by `;` or newlines.
 * English and Indonesian aliases are accepted:
 *   client      | klien       | customer
 *   type        | tipe        | jenis
 *   summary     | ringkasan   | subject | judul
 *   description | deskripsi   | desc    | body
 */

export interface ParsedTicketCommand {
  client: string;
  type?: string;
  summary: string;
  description: string;
}

export interface ParseSuccess {
  ok: true;
  command: ParsedTicketCommand;
}

export interface ParseFailure {
  ok: false;
  /** Human-readable reason, safe to show back to the user. */
  error: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

export const COMMAND_TRIGGER = 'add_ticket';

const KEY_ALIASES: Record<string, keyof ParsedTicketCommand> = {
  client: 'client',
  klien: 'client',
  customer: 'client',
  type: 'type',
  tipe: 'type',
  jenis: 'type',
  summary: 'summary',
  ringkasan: 'summary',
  subject: 'summary',
  judul: 'summary',
  description: 'description',
  deskripsi: 'description',
  desc: 'description',
  body: 'description',
};

/**
 * Returns true if the (already text-cleaned) message begins with the
 * add_ticket trigger. Tolerant of a leading bot @mention having been stripped.
 */
export function isAddTicketCommand(text: string): boolean {
  return /^\s*add_ticket\b/i.test(text.trim());
}

/**
 * Splits the argument string into key/value pairs.
 * Pairs are separated by `;` or newlines. A comma is only treated as a pair
 * separator when the following token looks like `key=` / `key:` — this keeps
 * commas inside descriptions intact.
 */
function splitPairs(args: string): string[] {
  // Normalise newlines to ';'
  const normalised = args.replace(/\r?\n/g, ';');

  // Insert a ';' before any ", key=" / ", key:" boundary so commas inside
  // free text (e.g. a description) are preserved.
  const knownKeys = Object.keys(KEY_ALIASES).join('|');
  const boundary = new RegExp(`\\s*,\\s*(?=(?:${knownKeys})\\s*[:=])`, 'gi');
  const withBoundaries = normalised.replace(boundary, ';');

  return withBoundaries
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseAddTicketCommand(rawText: string): ParseResult {
  const text = rawText.trim();

  const match = /^add_ticket\s*[:=]?\s*([\s\S]*)$/i.exec(text);
  if (!match) {
    return { ok: false, error: `Message does not start with "${COMMAND_TRIGGER}".` };
  }

  const args = match[1].trim();
  if (!args) {
    return { ok: false, error: emptyHelp() };
  }

  const collected: Partial<Record<keyof ParsedTicketCommand, string>> = {};

  for (const pair of splitPairs(args)) {
    const kv = /^([^:=]+)[:=]([\s\S]*)$/.exec(pair);
    if (!kv) {
      continue; // ignore stray tokens without a key/value separator
    }
    const rawKey = kv[1].trim().toLowerCase();
    const value = kv[2].trim();
    const canonical = KEY_ALIASES[rawKey];
    if (canonical && value) {
      collected[canonical] = value;
    }
  }

  const missing: string[] = [];
  if (!collected.client) missing.push('client');
  if (!collected.summary) missing.push('summary');
  if (!collected.description) missing.push('description');

  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `Missing field(s): ${missing.join(', ')}.\n\n` + usageHelp(),
    };
  }

  return {
    ok: true,
    command: {
      client: collected.client!,
      type: collected.type,
      summary: collected.summary!,
      description: collected.description!,
    },
  };
}

function emptyHelp(): string {
  return `No fields provided.\n\n${usageHelp()}`;
}

export function usageHelp(): string {
  return [
    'Usage:',
    '`add_ticket: client=<name/email>; type=<ticket type>; summary=<short title>; description=<details>`',
    '',
    '`type` is optional. `client`, `summary`, and `description` are required.',
  ].join('\n');
}
