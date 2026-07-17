import express, { type Request, type Response } from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  type ConfigurationBotFrameworkAuthenticationOptions,
} from 'botbuilder';
import { loadConfig } from './config';
import { TicketBot } from './bot/ticketBot';
import { TeamworkDeskClient } from './ticket/teamworkDeskClient';

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

// ─── Bot + Teamwork Desk client ──────────────────────────────────────────
const deskClient = new TeamworkDeskClient(config.desk);
const bot = new TicketBot(deskClient);

// ─── HTTP server ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get('/', (_req: Request, res: Response) => {
  res.status(200).send('Teams Desktop-Ticket bot is running.');
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/api/messages', async (req: Request, res: Response) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

app.listen(config.port, () => {
  console.log(`Teams Desktop-Ticket bot listening on port ${config.port}`);
  console.log(`Messaging endpoint: POST /api/messages`);
});
