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
  desk: {
    baseUrl?: string;
    apiKey?: string;
    inboxId?: number;
    defaultCustomerEmail?: string;
    defaultStatusId?: number;
    defaultPriorityId?: number;
  };
}

/**
 * Loads configuration from the environment.
 *
 * Deliberately does NOT throw when Teamwork Desk / Bot settings are missing:
 * the server still boots so the deployment succeeds and `/` and `/health`
 * respond. Missing values are logged as warnings, and `createTicket` fails
 * with a clear message if it is called before Desk is configured.
 */
export function loadConfig(): AppConfig {
  // Normalise the base URL: strip a trailing slash and any trailing /desk
  const rawBaseUrl = optional('TEAMWORK_DESK_BASE_URL')?.replace(/\/+$/, '');
  const baseUrl = rawBaseUrl?.replace(/\/desk$/i, '');

  const config: AppConfig = {
    port: optionalNumber('PORT') ?? 3978,
    bot: {
      appId: optional('MICROSOFT_APP_ID') ?? '',
      appPassword: optional('MICROSOFT_APP_PASSWORD') ?? '',
      appType: optional('MICROSOFT_APP_TYPE') ?? 'MultiTenant',
      appTenantId: optional('MICROSOFT_APP_TENANT_ID'),
    },
    desk: {
      baseUrl,
      apiKey: optional('TEAMWORK_DESK_API_KEY'),
      inboxId: optionalNumber('TEAMWORK_DESK_INBOX_ID'),
      defaultCustomerEmail: optional('DEFAULT_CUSTOMER_EMAIL'),
      defaultStatusId: optionalNumber('DEFAULT_STATUS_ID'),
      defaultPriorityId: optionalNumber('DEFAULT_PRIORITY_ID'),
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
  if (!config.desk.baseUrl) missing.push('TEAMWORK_DESK_BASE_URL');
  if (!config.desk.apiKey) missing.push('TEAMWORK_DESK_API_KEY');
  if (config.desk.inboxId === undefined) missing.push('TEAMWORK_DESK_INBOX_ID');
  if (!config.bot.appId) missing.push('MICROSOFT_APP_ID');
  if (!config.bot.appPassword) missing.push('MICROSOFT_APP_PASSWORD');
  return missing;
}
