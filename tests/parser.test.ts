import { describe, it, expect } from 'vitest';
import {
  isAddTicketCommand,
  parseAddTicketCommand,
} from '../src/ticket/parser';

describe('isAddTicketCommand', () => {
  it('detects the trigger regardless of case and leading space', () => {
    expect(isAddTicketCommand('add_ticket: client=x; summary=y; description=z')).toBe(true);
    expect(isAddTicketCommand('   ADD_TICKET client=x')).toBe(true);
  });

  it('rejects unrelated messages', () => {
    expect(isAddTicketCommand('hello there')).toBe(false);
    expect(isAddTicketCommand('please add a ticket')).toBe(false);
  });
});

describe('parseAddTicketCommand', () => {
  it('parses a well-formed command with = separators', () => {
    const r = parseAddTicketCommand(
      'add_ticket: client=Acme Corp; type=Bug; summary=Login broken; description=User cannot log in',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command).toEqual({
        client: 'Acme Corp',
        type: 'Bug',
        summary: 'Login broken',
        description: 'User cannot log in',
      });
    }
  });

  it('parses with : separators and comma-separated pairs', () => {
    const r = parseAddTicketCommand(
      'add_ticket client: Acme, type: Incident, summary: Down, description: Server is offline, users affected',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.client).toBe('Acme');
      expect(r.command.type).toBe('Incident');
      expect(r.command.summary).toBe('Down');
      // comma inside description must be preserved
      expect(r.command.description).toBe('Server is offline, users affected');
    }
  });

  it('accepts Indonesian aliases', () => {
    const r = parseAddTicketCommand(
      'add_ticket: klien=PT Maju; tipe=Permintaan; ringkasan=Reset password; deskripsi=Tolong reset akun',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.client).toBe('PT Maju');
      expect(r.command.type).toBe('Permintaan');
      expect(r.command.summary).toBe('Reset password');
      expect(r.command.description).toBe('Tolong reset akun');
    }
  });

  it('treats type as optional', () => {
    const r = parseAddTicketCommand(
      'add_ticket: client=x; summary=y; description=z',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.type).toBeUndefined();
    }
  });

  it('handles newline-separated fields', () => {
    const r = parseAddTicketCommand(
      'add_ticket:\nclient=x\nsummary=y\ndescription=z',
    );
    expect(r.ok).toBe(true);
  });

  it('reports missing required fields', () => {
    const r = parseAddTicketCommand('add_ticket: client=x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('summary');
      expect(r.error).toContain('description');
    }
  });

  it('reports empty command', () => {
    const r = parseAddTicketCommand('add_ticket:');
    expect(r.ok).toBe(false);
  });
});
