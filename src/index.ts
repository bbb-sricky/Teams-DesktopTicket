import express, { type Request, type Response } from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConversationState,
  MemoryStorage,
  type ConfigurationBotFrameworkAuthenticationOptions,
} from 'botbuilder';
import { loadConfig, missingSettings } from './config';
import { TicketBot } from './bot/ticketBot';
import { DesktopApiClient } from './ticket/desktopApiClient';

const config = loadConfig();

// ─── Bot Framework authentication + adapter ──────────────────────────────
const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: config.bot.appId,
  MicrosoftAppPassword: config.bot.appPassword,
  MicrosoftAppType: config.bot.appType,
  MicrosoftAppTenantId: config.bot.appTenantId,
} as ConfigurationBotFrameworkAuthenticationOptions);

const adapter = new CloudAdapter(botFrameworkAuth);

adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError] unhandled error:', error);
  await context.sendActivity('The bot hit an unexpected error. Please try again.');
};

// ─── Bot + Desktop.Api client ────────────────────────────────────────────
// In-memory conversation state (per-conversation dialog progress). Resets on
// restart — an in-progress flow would just be restarted with `add_ticket`.
const conversationState = new ConversationState(new MemoryStorage());
const apiClient = new DesktopApiClient(config.api);
const bot = new TicketBot(apiClient, conversationState, {
  ticketChannelId: config.bot.ticketChannelId,
  botAppId: config.bot.appId,
});

// ─── HTTP server ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  const missing = missingSettings(config);
  const configured = missing.length === 0;
  res
    .status(200)
    .send(
      `Teams Desktop-Ticket bot is running.\n` +
        (configured
          ? 'All required settings are configured. ✅'
          : `Not yet configured. Missing settings: ${missing.join(', ')}`),
    );
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    apiConfigured: apiClient.isConfigured(),
    missingSettings: missingSettings(config),
  });
});

app.post('/api/messages', async (req: Request, res: Response) => {
  await adapter.process(req, res, async (context) => {
    await bot.run(context);
    // Persist dialog progress after each turn.
    await conversationState.saveChanges(context, false);
  });
});

app.listen(config.port, () => {
  console.log(`Teams Desktop-Ticket bot listening on port ${config.port}`);
  console.log(`Messaging endpoint: POST /api/messages`);
});
