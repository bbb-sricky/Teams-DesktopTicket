import { MessageFactory, TeamsInfo, TurnContext, type Activity, type Attachment } from 'botbuilder';
import {
  ClientResolutionError,
  DesktopApiClient,
  type LookupOption,
} from '../ticket/desktopApiClient';
import { choiceCard, confirmCard, textPromptCard } from './cards';
import { initialState, type DialogState } from './state';

export interface TicketDialogOptions {
  /** Teams channel id to also post created-ticket confirmations to. */
  ticketChannelId?: string;
  /** Bot's Microsoft App ID (needed for proactive channel posts). */
  botAppId?: string;
}

/** Matches a bare "add_ticket" (no key/value args) that starts the flow. */
export function isStartCommand(text: string): boolean {
  return /^add[_\s-]?ticket\s*$/i.test(text.trim());
}

function isCancel(text: string): boolean {
  return /^(cancel|batal)\s*$/i.test(text.trim());
}

export class TicketDialog {
  constructor(
    private readonly api: DesktopApiClient,
    private readonly opts: TicketDialogOptions = {},
  ) {}

  /** Returns true if this activity was consumed by the dialog. */
  async handle(context: TurnContext, state: DialogState): Promise<boolean> {
    const value = (context.activity.value ?? undefined) as Record<string, unknown> | undefined;
    const text = (TurnContext.removeRecipientMention(context.activity) ?? '').trim();

    if (isCancel(text) || value?.action === 'cancel') {
      Object.assign(state, initialState());
      await context.sendActivity('❌ Ticket cancelled.');
      return true;
    }

    try {
      if (value && typeof value.action === 'string') {
        return await this.handleSubmit(context, state, value);
      }

      // Free-typed text while a step expects it.
      switch (state.step) {
        case 'client_search':
          if (text) return await this.afterClientSearch(context, state, text);
          break;
        case 'assigned_search':
          if (text) return await this.afterAssignedSearch(context, state, text);
          break;
        case 'summary':
          if (text) {
            state.data.summary = text;
            return await this.gotoDescription(context, state);
          }
          break;
        case 'description':
          if (text) {
            state.data.description = text;
            return await this.gotoConfirm(context, state);
          }
          break;
        case 'confirm':
          if (/^confirm$/i.test(text)) return await this.finish(context, state);
          break;
      }

      if (isStartCommand(text)) return await this.start(context, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await context.sendActivity(`⚠️ Something went wrong: ${msg}\nType \`add_ticket\` to start again, or \`cancel\`.`);
      return true;
    }

    return false;
  }

  private send(context: TurnContext, attachment: Attachment): Promise<unknown> {
    return context.sendActivity({ attachments: [attachment] });
  }

  /**
   * Parses a pick value. Choice values are "id|name" so the name survives even
   * if in-memory state was lost; "0|" / "" mean the "(none)" option.
   */
  private resolve(choices: LookupOption[], raw: unknown): { id?: number; name?: string } {
    const s = raw === undefined || raw === null ? '' : String(raw);
    if (s === '') return { id: undefined, name: '(none)' };
    const sep = s.indexOf('|');
    const idStr = sep >= 0 ? s.slice(0, sep) : s;
    const namePart = sep >= 0 ? s.slice(sep + 1) : '';
    if (idStr === '0' || idStr === '') return { id: undefined, name: namePart || '(none)' };
    const id = Number(idStr);
    const name = namePart || choices.find((c) => String(c.id) === idStr)?.name || idStr;
    return { id: Number.isNaN(id) ? undefined : id, name };
  }

  // ─── Steps ───────────────────────────────────────────────────────────

  private async start(context: TurnContext, state: DialogState): Promise<boolean> {
    Object.assign(state, initialState());
    state.step = 'client_search';
    await this.send(
      context,
      textPromptCard({
        title: 'Add Ticket — Client',
        subtitle: 'Type part of the client name, then Search.',
        inputId: 'clientSearch',
        action: 'clientSearch',
        placeholder: 'e.g. Bit By Bit',
        submitLabel: 'Search',
      }),
    );
    return true;
  }

  private async afterClientSearch(context: TurnContext, state: DialogState, term: string): Promise<boolean> {
    const results = await this.api.searchClients(term);
    if (results.length === 0) {
      await this.send(
        context,
        textPromptCard({
          title: 'Add Ticket — Client',
          subtitle: `No clients match "${term}". Try again.`,
          inputId: 'clientSearch',
          action: 'clientSearch',
          placeholder: 'e.g. Bit By Bit',
          submitLabel: 'Search',
        }),
      );
      return true;
    }
    state.step = 'client_pick';
    state.choices = results;
    await this.send(
      context,
      choiceCard({
        title: 'Select Client',
        inputId: 'clientId',
        action: 'clientPick',
        options: results,
        searchAgainAction: 'clientSearchAgain',
      }),
    );
    return true;
  }

  private async afterAssignedSearch(context: TurnContext, state: DialogState, term: string): Promise<boolean> {
    const results = await this.api.searchEmployees(term);
    if (results.length === 0) {
      await this.send(
        context,
        textPromptCard({
          title: 'Assigned To',
          subtitle: `Nobody matches "${term}". Try again.`,
          inputId: 'assignedSearch',
          action: 'assignedSearch',
          placeholder: 'technician name',
          submitLabel: 'Search',
        }),
      );
      return true;
    }
    state.step = 'assigned_pick';
    state.choices = results;
    await this.send(
      context,
      choiceCard({
        title: 'Select Assigned To',
        inputId: 'assignedToId',
        action: 'assignedPick',
        options: results,
        searchAgainAction: 'assignedSearchAgain',
      }),
    );
    return true;
  }

  private async gotoDescription(context: TurnContext, state: DialogState): Promise<boolean> {
    state.step = 'description';
    await this.send(
      context,
      textPromptCard({
        title: 'Description',
        subtitle: 'Enter the ticket description.',
        inputId: 'description',
        action: 'description',
        placeholder: 'Full description...',
        multiline: true,
      }),
    );
    return true;
  }

  private async gotoConfirm(context: TurnContext, state: DialogState): Promise<boolean> {
    state.step = 'confirm';
    await this.send(context, confirmCard(state.data));
    return true;
  }

  private async finish(context: TurnContext, state: DialogState): Promise<boolean> {
    const d = state.data;
    if (!d.summary || !d.description || d.clientId === undefined) {
      await context.sendActivity('⚠️ Incomplete data. Type `add_ticket` to start again.');
      Object.assign(state, initialState());
      return true;
    }
    try {
      const ticket = await this.api.createTicket({
        clientId: d.clientId,
        contactId: d.contactId,
        typeId: d.typeId,
        assignedToId: d.assignedToId,
        categoryId: d.categoryId,
        priorityId: d.priorityId,
        summary: d.summary,
        description: d.description,
      });

      const notNone = (s?: string) => (s && s !== '(none)' ? s : undefined);
      const summaryText = [
        `✅ **Ticket #${ticket.id} created**`,
        `• **Client:** ${d.clientName}`,
        notNone(d.contactName) ? `• **Contact:** ${d.contactName}` : undefined,
        d.typeName ? `• **Type:** ${d.typeName}` : undefined,
        notNone(d.assignedToName) ? `• **Assigned To:** ${d.assignedToName}` : undefined,
        notNone(d.categoryName) ? `• **Category:** ${d.categoryName}` : undefined,
        notNone(d.priorityName) ? `• **Priority:** ${d.priorityName}` : undefined,
        `• **Summary:** ${d.summary}`,
        `• **Link:** ${ticket.url}`,
      ]
        .filter(Boolean)
        .join('\n');

      // Post to the Ticket channel if configured (proactive channel message).
      let postedToChannel = false;
      if (this.opts.ticketChannelId) {
        try {
          await TeamsInfo.sendMessageToTeamsChannel(
            context,
            MessageFactory.text(summaryText) as Activity,
            this.opts.ticketChannelId,
            this.opts.botAppId,
          );
          postedToChannel = true;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          await context.sendActivity(
            `⚠️ Ticket created, but I couldn't post it to the Ticket channel: ${m}`,
          );
        }
      }

      await context.sendActivity(
        postedToChannel ? `${summaryText}\n\n_(Also posted to the Ticket channel.)_` : summaryText,
      );
    } catch (err) {
      if (err instanceof ClientResolutionError) {
        await context.sendActivity(`⚠️ ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        await context.sendActivity(`❌ Failed to create the ticket. ${msg}`);
      }
    }
    Object.assign(state, initialState());
    return true;
  }

  // ─── Card submits ────────────────────────────────────────────────────

  private async handleSubmit(context: TurnContext, state: DialogState, value: Record<string, unknown>): Promise<boolean> {
    switch (value.action) {
      case 'clientSearch':
        return this.afterClientSearch(context, state, String(value.clientSearch ?? '').trim());
      case 'clientSearchAgain':
        state.step = 'client_search';
        await this.send(
          context,
          textPromptCard({
            title: 'Add Ticket — Client',
            subtitle: 'Type part of the client name.',
            inputId: 'clientSearch',
            action: 'clientSearch',
            submitLabel: 'Search',
          }),
        );
        return true;

      case 'clientPick': {
        const { id, name } = this.resolve(state.choices, value.clientId);
        if (id === undefined) {
          await context.sendActivity('⚠️ Please select a client first.');
          return true;
        }
        state.data.clientId = id;
        state.data.clientName = name;
        const contacts = await this.api.getContacts(id);
        state.step = 'contact_pick';
        state.choices = contacts;
        await this.send(
          context,
          choiceCard({
            title: 'Select Contact',
            subtitle: contacts.length ? undefined : 'No contacts; choose (none) to continue.',
            inputId: 'contactId',
            action: 'contactPick',
            options: contacts,
            includeNone: true,
          }),
        );
        return true;
      }

      case 'contactPick': {
        const { id, name } = this.resolve(state.choices, value.contactId);
        state.data.contactId = id;
        state.data.contactName = name;
        const types = await this.api.getTicketTypes();
        state.step = 'type_pick';
        state.choices = types;
        await this.send(
          context,
          choiceCard({ title: 'Select Ticket Type', inputId: 'typeId', action: 'typePick', options: types }),
        );
        return true;
      }

      case 'typePick': {
        const { id, name } = this.resolve(state.choices, value.typeId);
        state.data.typeId = id;
        state.data.typeName = name;
        state.step = 'assigned_search';
        await this.send(
          context,
          textPromptCard({
            title: 'Assigned To',
            subtitle: 'Type part of the technician / employee name.',
            inputId: 'assignedSearch',
            action: 'assignedSearch',
            placeholder: 'technician name',
            submitLabel: 'Search',
          }),
        );
        return true;
      }

      case 'assignedSearch':
        return this.afterAssignedSearch(context, state, String(value.assignedSearch ?? '').trim());
      case 'assignedSearchAgain':
        state.step = 'assigned_search';
        await this.send(
          context,
          textPromptCard({
            title: 'Assigned To',
            subtitle: 'Type part of the technician / employee name.',
            inputId: 'assignedSearch',
            action: 'assignedSearch',
            submitLabel: 'Search',
          }),
        );
        return true;

      case 'assignedPick': {
        const { id, name } = this.resolve(state.choices, value.assignedToId);
        state.data.assignedToId = id;
        state.data.assignedToName = name;
        const categories = state.data.clientId !== undefined ? await this.api.getCategories(state.data.clientId) : [];
        state.step = 'category_pick';
        state.choices = categories;
        await this.send(
          context,
          choiceCard({
            title: 'Select Ticket Category',
            subtitle: 'Optional — you may choose (none).',
            inputId: 'categoryId',
            action: 'categoryPick',
            options: categories,
            includeNone: true,
          }),
        );
        return true;
      }

      case 'categoryPick': {
        const { id, name } = this.resolve(state.choices, value.categoryId);
        state.data.categoryId = id;
        state.data.categoryName = name;
        const priorities = await this.api.getPriorities();
        state.step = 'priority_pick';
        state.choices = priorities;
        await this.send(
          context,
          choiceCard({
            title: 'Select Ticket Priority',
            subtitle: 'Optional — you may choose (none).',
            inputId: 'priorityId',
            action: 'priorityPick',
            options: priorities,
            includeNone: true,
          }),
        );
        return true;
      }

      case 'priorityPick': {
        const { id, name } = this.resolve(state.choices, value.priorityId);
        state.data.priorityId = id;
        state.data.priorityName = name;
        state.step = 'summary';
        await this.send(
          context,
          textPromptCard({
            title: 'Summary',
            subtitle: 'Enter a short ticket summary.',
            inputId: 'summary',
            action: 'summary',
            placeholder: 'Short summary',
            multiline: true,
          }),
        );
        return true;
      }

      case 'summary': {
        const s = String(value.summary ?? '').trim();
        if (!s) {
          await context.sendActivity('⚠️ Summary cannot be empty.');
          return true;
        }
        state.data.summary = s;
        return this.gotoDescription(context, state);
      }

      case 'description': {
        const s = String(value.description ?? '').trim();
        if (!s) {
          await context.sendActivity('⚠️ Description cannot be empty.');
          return true;
        }
        state.data.description = s;
        return this.gotoConfirm(context, state);
      }

      case 'confirm':
        return this.finish(context, state);

      default:
        return false;
    }
  }
}
