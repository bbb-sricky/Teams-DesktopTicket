import * as dotenv from 'dotenv';

dotenv.config();

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
    baseUrl: string;
    apiKey: string;
    inboxId: number;
    defaultCustomerEmail?: string;
    defaultStatusId?: number;
    defaultPriorityId?: number;
  };
}

/**
 * Loads and validates configuration from the environment.
 * Throws early (at startup) if anything required is missing.
 */
export function loadConfig(): AppConfig {
  const inboxId = optionalNumber('TEAMWORK_DESK_INBOX_ID');
  if (inboxId === undefined) {
    throw new Error('Missing required environment variable: TEAMWORK_DESK_INBOX_ID');
  }

  // Normalise the base URL: strip a trailing slash and any trailing /desk
  const rawBaseUrl = required('TEAMWORK_DESK_BASE_URL').replace(/\/+$/, '');
  const baseUrl = rawBaseUrl.replace(/\/desk$/i, '');

  return {
    port: optionalNumber('PORT') ?? 3978,
    bot: {
      appId: optional('MICROSOFT_APP_ID') ?? '',
      appPassword: optional('MICROSOFT_APP_PASSWORD') ?? '',
      appType: optional('MICROSOFT_APP_TYPE') ?? 'MultiTenant',
      appTenantId: optional('MICROSOFT_APP_TENANT_ID'),
    },
    desk: {
      baseUrl,
      apiKey: required('TEAMWORK_DESK_API_KEY'),
      inboxId,
      defaultCustomerEmail: optional('DEFAULT_CUSTOMER_EMAIL'),
      defaultStatusId: optionalNumber('DEFAULT_STATUS_ID'),
      defaultPriorityId: optionalNumber('DEFAULT_PRIORITY_ID'),
    },
  };
}
