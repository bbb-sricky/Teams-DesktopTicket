import type { LookupOption } from '../ticket/desktopApiClient';

export type DialogStep =
  | 'idle'
  | 'client_search'
  | 'client_pick'
  | 'contact_pick'
  | 'type_pick'
  | 'assigned_search'
  | 'assigned_pick'
  | 'category_pick'
  | 'priority_pick'
  | 'summary'
  | 'description'
  | 'confirm';

/** Values collected across the conversation. */
export interface TicketData {
  clientId?: number;
  clientName?: string;
  contactId?: number;
  contactName?: string;
  typeId?: number;
  typeName?: string;
  assignedToId?: number;
  assignedToName?: string;
  categoryId?: number;
  categoryName?: string;
  priorityId?: number;
  priorityName?: string;
  summary?: string;
  description?: string;
}

export interface DialogState {
  step: DialogStep;
  data: TicketData;
  /** The options last shown for the current pick step, to resolve id → name. */
  choices: LookupOption[];
}

export function initialState(): DialogState {
  return { step: 'idle', data: {}, choices: [] };
}
