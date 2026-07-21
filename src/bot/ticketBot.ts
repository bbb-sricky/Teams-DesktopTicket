import { TeamsActivityHandler, TurnContext } from 'botbuilder';
import {
  isAddTicketCommand,
  parseAddTicketCommand,
  usageHelp,
} from '../ticket/parser';
import { ClientResolutionError, DesktopApiClient } from '../ticket/desktopApiClient';

/**
 * Teams bot that turns an `add_ticket` chat command into a BBB Desktop ticket
 * and replies with the ticket number in the same channel.
 */
export class TicketBot extends TeamsActivityHandler {
  constructor(private readonly api: DesktopApiClient) {
    super();

    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const added = context.activity.membersAdded ?? [];
      const selfId = context.activity.recipient?.id;
      const greetedSelf = added.some((m) => m.id !== selfId);
      if (greetedSelf) {
        await context.sendActivity(
          `👋 Desktop-Ticket bot is ready.\n\n${usageHelp()}`,
        );
      }
      await next();
    });
  }

  private async handleMessage(context: TurnContext): Promise<void> {
    // Strip a leading @mention of the bot so commands work in channels.
    const text = (TurnContext.removeRecipientMention(context.activity) ?? '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!isAddTicketCommand(text)) {
      // Stay quiet unless explicitly addressed with the command, but offer help
      // if the bot was @mentioned with something else in a 1:1 or reply.
      if (text.length > 0 && context.activity.conversation?.conversationType === 'personal') {
        await context.sendActivity(usageHelp());
      }
      return;
    }

    const parsed = parseAddTicketCommand(text);
    if (!parsed.ok) {
      await context.sendActivity(`⚠️ ${parsed.error}`);
      return;
    }

    const { client, type, summary, description } = parsed.command;

    try {
      const ticket = await this.api.createTicket({
        summary,
        description,
        client,
        typeName: type,
      });

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
        const hint =
          err.candidates.length > 0
            ? `\n\nDid you mean: ${err.candidates.join(', ')}?`
            : '';
        await context.sendActivity(`⚠️ ${err.message}${hint}`);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to create ticket:', message);
      await context.sendActivity(
        `❌ Sorry, I couldn't create the ticket. ${message}`,
      );
    }
  }
}
