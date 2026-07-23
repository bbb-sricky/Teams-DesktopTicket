import { CardFactory, type Attachment } from 'botbuilder';
import type { LookupOption } from '../ticket/desktopApiClient';
import type { TicketData } from './state';

const VERSION = '1.4';

function card(body: unknown[], actions: unknown[]): Attachment {
  return CardFactory.adaptiveCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: VERSION,
    body,
    actions,
  });
}

function heading(text: string) {
  return { type: 'TextBlock', text, weight: 'Bolder', size: 'Medium', wrap: true };
}

/** A free-text prompt (used for search terms, summary, description). */
export function textPromptCard(opts: {
  title: string;
  subtitle?: string;
  inputId: string;
  action: string;
  placeholder?: string;
  multiline?: boolean;
  submitLabel?: string;
}): Attachment {
  const body: unknown[] = [heading(opts.title)];
  if (opts.subtitle) body.push({ type: 'TextBlock', text: opts.subtitle, isSubtle: true, wrap: true });
  body.push({
    type: 'Input.Text',
    id: opts.inputId,
    placeholder: opts.placeholder ?? '',
    isMultiline: !!opts.multiline,
  });
  return card(body, [
    { type: 'Action.Submit', title: opts.submitLabel ?? 'Next', data: { action: opts.action } },
    { type: 'Action.Submit', title: 'Cancel', data: { action: 'cancel' } },
  ]);
}

/** A dropdown pick from a list of options. */
export function choiceCard(opts: {
  title: string;
  subtitle?: string;
  inputId: string;
  action: string;
  options: LookupOption[];
  includeNone?: boolean;
  searchAgainAction?: string;
}): Attachment {
  const choices = opts.options.map((o) => ({ title: o.name, value: String(o.id) }));
  // Use "0" (not "") for the none option — an empty choice value makes the
  // Adaptive Card ChoiceSet fail to render in Web Chat/Teams.
  if (opts.includeNone) choices.unshift({ title: '(none)', value: '0' });

  const body: unknown[] = [heading(opts.title)];
  if (opts.subtitle) body.push({ type: 'TextBlock', text: opts.subtitle, isSubtle: true, wrap: true });
  body.push({
    type: 'Input.ChoiceSet',
    id: opts.inputId,
    style: 'compact',
    choices,
    value: choices.length ? choices[0].value : undefined,
  });

  const actions: unknown[] = [
    { type: 'Action.Submit', title: 'Next', data: { action: opts.action } },
  ];
  if (opts.searchAgainAction) {
    actions.push({ type: 'Action.Submit', title: 'Search again', data: { action: opts.searchAgainAction } });
  }
  actions.push({ type: 'Action.Submit', title: 'Cancel', data: { action: 'cancel' } });
  return card(body, actions);
}

/** Final review card with Confirm / Cancel. */
export function confirmCard(data: TicketData): Attachment {
  const facts = [
    { title: 'Client', value: data.clientName ?? '-' },
    { title: 'Contact', value: data.contactName ?? '-' },
    { title: 'Ticket Type', value: data.typeName ?? '-' },
    { title: 'Assigned To', value: data.assignedToName ?? '-' },
    { title: 'Category', value: data.categoryName ?? '-' },
    { title: 'Priority', value: data.priorityName ?? '-' },
    { title: 'Summary', value: data.summary ?? '-' },
    { title: 'Description', value: data.description ?? '-' },
  ];
  const body: unknown[] = [
    heading('Review ticket'),
    { type: 'TextBlock', text: 'Type **confirm** or press the button to create the ticket.', wrap: true, isSubtle: true },
    { type: 'FactSet', facts },
  ];
  return card(body, [
    { type: 'Action.Submit', title: '✅ Confirm', data: { action: 'confirm' } },
    { type: 'Action.Submit', title: 'Cancel', data: { action: 'cancel' } },
  ]);
}
