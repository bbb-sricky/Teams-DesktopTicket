import {
  TeamsActivityHandler,
  TurnContext,
  type ConversationState,
  type StatePropertyAccessor,
} from 'botbuilder';
import {
  isAddTicketCommand,
  parseAddTicketCommand,
  usageHelp,
} from '../ticket/parser';
import { ClientResolutionError, DesktopApiClient } from '../ticket/desktopApiClient';
import { TicketDialog, isStartCommand } from '../dialog/ticketDialog';
import { initialState, type DialogState } from '../dialog/state';

/**
 * Teams bot that creates BBB Desktop tickets.
 *  - `add_ticket` (bare) → interactive step-by-step flow (Adaptive Cards)
 *  - `add_ticket: client=…; summary=…; description=…` → legacy one-liner
 */
export class TicketBot extends TeamsActivityHandler {
  private readonly dialog: TicketDialog;
  private readonly dialogAccessor: StatePropertyAccessor<DialogState>;

  constructor(
    private readonly api: DesktopApiClient,
    private readonly conversationState: ConversationState,
  ) {
    super();
    this.dialog = new TicketDialog(api);
    this.dialogAccessor = conversationState.createProperty<DialogState>('ticketDialog');

    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const added = context.activity.membersAdded ?? [];
      const selfId = context.activity.recipient?.id;
      if (added.some((m) => m.id !== selfId)) {
        await context.sendActivity(
          `👋 Desktop-Ticket bot is ready.\n\nType \`add_ticket\` to create a ticket step by step.`,
        );
      }
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    const state = await this.dialogAccessor.get(context, initialState());
    const text = (TurnContext.removeRecipientMention(context.activity) ?? '').trim();

    // If a flow is active, or this starts/continues one, let the dialog handle it.
    const inFlow = state.step !== 'idle';
    const isCardSubmit = !!context.activity.value;
    if (inFlow || isCardSubmit || isStartCommand(text)) {
      const handled = await this.dialog.handle(context, state);
      if (handled) return;
    }

    // Legacy one-liner: add_ticket: client=…; summary=…; description=…
    if (isAddTicketCommand(text)) {
      const parsed = parseAddTicketCommand(text);
      if (!parsed.ok) {
        await context.sendActivity(`⚠️ ${parsed.error}`);
        return;
      }
      const { client, type, summary, description } = parsed.command;
      try {
        const ticket = await this.api.createTicket({ client, typeName: type, summary, description });
        await context.sendActivity(
          [
            `✅ **Ticket #${ticket.id} created**`,
            `• **Client:** ${client}`,
            type ? `• **Type:** ${type}` : undefined,
            `• **Summary:** ${summary}`,
            `• **Link:** ${ticket.url}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (err) {
        if (err instanceof ClientResolutionError) {
          const hint = err.candidates.length ? `\n\nDid you mean: ${err.candidates.join(', ')}?` : '';
          await context.sendActivity(`⚠️ ${err.message}${hint}`);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          await context.sendActivity(`❌ Failed to create the ticket. ${msg}`);
        }
      }
      return;
    }

    // Otherwise, offer help in 1:1 chats.
    if (text.length > 0 && context.activity.conversation?.conversationType === 'personal') {
      await context.sendActivity(
        `Type \`add_ticket\` to create a ticket step by step.\n\n${usageHelp()}`,
      );
    }
  }
}
