import type { AppConfig } from './config.js';
import type { KeyValueStore } from './db/index.js';
import type { GeniusService } from './genius/service.js';
import type { FetchLike } from './lib/http.js';
import { createProviders, type ProviderRegistry } from './providers/index.js';
import { SOUNDCLOUD_APP_TOKEN_KEY } from './providers/soundcloud.js';

/**
 * API keys the server owner can enter in the app (Сервисы) instead of the .env file. A value from the environment
 * always wins and cannot be changed from the app. Saved keys are applied at once, without a restart. Flags without a
 * value are on when `defaultOn` says so.
 */
export const SERVICE_KEYS = [
  { name: 'SOUNDCLOUD_CLIENT_ID', service: 'soundcloud', label: 'Client ID', secret: false, flag: false },
  { name: 'SOUNDCLOUD_CLIENT_SECRET', service: 'soundcloud', label: 'Client Secret', secret: true, flag: false },
  {
    name: 'SOUNDCLOUD_PUBLIC_CLIENT',
    service: 'soundcloud',
    label: 'Режим без ключей (неофициальный)',
    secret: false,
    flag: true,
    defaultOn: true,
  },
  { name: 'GENIUS_ACCESS_TOKEN', service: 'genius', label: 'Client access token', secret: true, flag: false },
  { name: 'YOUTUBE_API_KEY', service: 'youtube', label: 'Ключ API', secret: true, flag: false },
] as const;

export type ServiceKeyName = (typeof SERVICE_KEYS)[number]['name'];

/**
 * Keys soundFy ships with, used until the owner enters their own: the project's Genius client access token, so song
 * credits work out of the box. It is public (it is in every build); replace it in the app to use your own.
 */
export const BUILT_IN_KEYS: Partial<Record<ServiceKeyName, string>> = {
  GENIUS_ACCESS_TOKEN: 'CIw9P3YiAjzeyKmIeRfy_tf9RoCo89L6IpzCSuhTMK6Cd3HVmVIe_CD96nWjR3Cm',
};

const storeKey = (name: ServiceKeyName) => `key.${name}`;
const isFlagOn = (value: string | null | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());

/** Shows just enough of a saved value to recognise it. */
function preview(value: string, secret: boolean): string {
  if (secret) return value.length > 8 ? `••••${value.slice(-4)}` : '••••';
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

export interface ServiceKeyInfo {
  name: ServiceKeyName;
  service: string;
  label: string;
  secret: boolean;
  flag: boolean;
  /** Where the value comes from: the environment (.env), the app, soundFy's built-in key, or nowhere yet. */
  source: 'env' | 'app' | 'builtin' | null;
  /** A masked hint of the value, never the secret itself. For flags: "on" or "off". */
  preview: string | null;
}

interface Services {
  providers: ProviderRegistry;
  genius: GeniusService;
  fetchImpl: FetchLike;
}

export class ServiceSettings {
  /** Values given in the environment when the server started; they take precedence over the app's. */
  private fromEnv: Partial<Record<ServiceKeyName, string>> = {};
  private services: Services | null = null;

  constructor(
    private store: KeyValueStore,
    private config: AppConfig,
    env: NodeJS.ProcessEnv = process.env,
    private builtIn: Partial<Record<ServiceKeyName, string>> = BUILT_IN_KEYS,
  ) {
    for (const { name } of SERVICE_KEYS) {
      const value = env[name]?.trim();
      if (value) this.fromEnv[name] = value;
    }
    this.applyTo(config);
  }

  /** The running services that saved keys are applied to. */
  bind(services: Services) {
    this.services = services;
  }

  isFromEnv(name: ServiceKeyName) {
    return Boolean(this.fromEnv[name]);
  }

  private value(name: ServiceKeyName): string | null {
    return this.fromEnv[name] ?? (this.store.get(storeKey(name)) || this.builtIn[name] || null);
  }

  private flag(name: ServiceKeyName): boolean {
    const value = this.value(name);
    const key = SERVICE_KEYS.find((k) => k.name === name)!;
    return value === null ? 'defaultOn' in key && key.defaultOn : isFlagOn(value);
  }

  list(): ServiceKeyInfo[] {
    return SERVICE_KEYS.map(({ name, service, label, secret, flag }) => {
      const source = this.fromEnv[name] ? 'env' : this.store.get(storeKey(name)) ? 'app' : this.builtIn[name] ? 'builtin' : null;
      const value = this.value(name);
      return {
        name,
        service,
        label,
        secret,
        flag,
        source,
        // The built-in key is shown only as such, never even in part.
        preview: flag ? (this.flag(name) ? 'on' : 'off') : source === 'builtin' ? null : value ? preview(value, secret) : null,
      };
    });
  }

  /** Puts the effective keys into the config (done on construction, before the providers are created). */
  private applyTo(config: AppConfig) {
    config.soundcloud.clientId = this.value('SOUNDCLOUD_CLIENT_ID');
    config.soundcloud.clientSecret = this.value('SOUNDCLOUD_CLIENT_SECRET');
    config.soundcloud.publicClient = this.flag('SOUNDCLOUD_PUBLIC_CLIENT');
    config.genius.accessToken = this.value('GENIUS_ACCESS_TOKEN');
    config.youtube.apiKey = this.value('YOUTUBE_API_KEY');
  }

  /**
   * Saves keys (null or "" removes one) and switches the services over right away. Keys set in the environment
   * cannot be changed here.
   */
  save(values: Partial<Record<ServiceKeyName, string | null>>) {
    const soundcloudBefore = this.value('SOUNDCLOUD_CLIENT_ID');
    for (const [name, raw] of Object.entries(values) as [ServiceKeyName, string | null][]) {
      if (this.fromEnv[name]) throw new Error(`${name} задан в переменных окружения сервера и в приложении не меняется`);
      const key = SERVICE_KEYS.find((k) => k.name === name)!;
      const value = (raw ?? '').trim();
      // A flag turned off is stored as "0", so it stays off where it is on by default.
      this.store.set(storeKey(name), key.flag ? (isFlagOn(value) ? '1' : '0') : value);
    }
    // A token issued for another SoundCloud app must not be reused.
    if (this.value('SOUNDCLOUD_CLIENT_ID') !== soundcloudBefore) this.store.set(SOUNDCLOUD_APP_TOKEN_KEY, '');
    this.applyTo(this.config);
    if (this.services) {
      const { providers, genius, fetchImpl } = this.services;
      providers.replace(createProviders(this.config, this.store, fetchImpl).list());
      genius.setToken(this.config.genius.accessToken);
    }
  }
}
