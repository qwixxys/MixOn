import type { AppConfig } from '../config.js';
import type { KeyValueStore } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/http.js';
import { DeezerProvider } from './deezer.js';
import { ItunesProvider } from './itunes.js';
import { JamendoProvider } from './jamendo.js';
import { SoundCloudProvider } from './soundcloud.js';
import { SoundCloudWebProvider } from './soundcloudWeb.js';
import type { MusicProvider } from './types.js';
import { VkProvider } from './vk.js';

export * from './types.js';

export class ProviderRegistry {
  private byId = new Map<string, MusicProvider>();

  constructor(providers: MusicProvider[]) {
    this.replace(providers);
  }

  /** Swaps in providers built with new settings (keys entered in the app); everyone holding the registry sees them. */
  replace(providers: MusicProvider[]) {
    this.byId = new Map(providers.map((p) => [p.id, p]));
  }

  list(): MusicProvider[] {
    return [...this.byId.values()];
  }

  find(id: string): MusicProvider | undefined {
    return this.byId.get(id);
  }

  get(id: string): MusicProvider {
    const provider = this.byId.get(id);
    if (!provider) throw notFound(`Неизвестный сервис: ${id}`);
    return provider;
  }
}

export function createProviders(config: AppConfig, store?: KeyValueStore, fetchImpl: FetchLike = fetch): ProviderRegistry {
  const { clientId, clientSecret, publicClient } = config.soundcloud;
  // Official keys always win; the keyless mode is only an opt-in fallback.
  const soundcloud =
    publicClient && !(clientId && clientSecret)
      ? new SoundCloudWebProvider({ store }, fetchImpl)
      : new SoundCloudProvider({ clientId, clientSecret, store }, fetchImpl);
  return new ProviderRegistry([
    new VkProvider(
      { apiVersion: config.vk.apiVersion, userAgent: config.vk.userAgent, fallbackToken: config.vk.accessToken },
      fetchImpl,
    ),
    soundcloud,
    new DeezerProvider(fetchImpl),
    new ItunesProvider(config.itunes.country, fetchImpl),
    new JamendoProvider(config.jamendo.clientId, fetchImpl),
  ]);
}
