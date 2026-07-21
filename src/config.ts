import * as dotenv from 'dotenv';

dotenv.config();

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function optionalNumber(name: string): number | undefined {
  const value = optional(name);
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`Environment variable ${name} must be a number, got "${value}"`);
  }
  return n;
}

export interface AppConfig {
  port: number;
  bot: {
    appId: string;
    appPassword: string;
    appType: string;
    appTenantId?: string;
  };
  api: {
    /** Desktop.Api base URL (defaults to staging). */
    baseUrl: string;
    /** Service-account credentials for /authenticate. */
    username?: string;
    password?: string;
    /** Base URL used to build a human-clickable ticket link. */
    ticketWebBaseUrl: string;
  };
}

// Defaults point at the STAGING environment so we never touch production by accident.
const DEFAULT_API_BASE_URL = 'https://desktop-api.bbbappdev.com';
const DEFAULT_TICKET_WEB_BASE_URL = 'https://desktop.bbbappdev.com/Ticket/Detail2.aspx?Id=';

/**
 * Loads configuration from the environment.
 *
 * Deliberately does NOT throw when Desktop.Api / Bot settings are missing:
 * the server still boots so the deployment succeeds and `/` and `/health`
 * respond. Missing values are logged as warnings, and `createTicket` fails
 * with a clear message if it is called before the API is configured.
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    port: optionalNumber('PORT') ?? 3978,
    bot: {
      appId: optional('MICROSOFT_APP_ID') ?? '',
      appPassword: optional('MICROSOFT_APP_PASSWORD') ?? '',
      appType: optional('MICROSOFT_APP_TYPE') ?? 'MultiTenant',
      appTenantId: optional('MICROSOFT_APP_TENANT_ID'),
    },
    api: {
      baseUrl: (optional('DESKTOP_API_BASE_URL') ?? DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
      username: optional('EXTERNAL_API_USERNAME'),
      password: optional('EXTERNAL_API_PASSWORD'),
      ticketWebBaseUrl: optional('DESKTOP_TICKET_WEB_BASE_URL') ?? DEFAULT_TICKET_WEB_BASE_URL,
    },
  };

  const missing = missingSettings(config);
  if (missing.length > 0) {
    console.warn(
      `[config] Server starting, but these settings are not set yet: ${missing.join(', ')}. ` +
        `Ticket creation and/or Teams connectivity will not work until they are provided.`,
    );
  }

  return config;
}

/** Returns the list of not-yet-configured settings (for warnings and /health). */
export function missingSettings(config: AppConfig): string[] {
  const missing: string[] = [];
  if (!config.api.username) missing.push('EXTERNAL_API_USERNAME');
  if (!config.api.password) missing.push('EXTERNAL_API_PASSWORD');
  if (!config.bot.appId) missing.push('MICROSOFT_APP_ID');
  if (!config.bot.appPassword) missing.push('MICROSOFT_APP_PASSWORD');
  return missing;
}
