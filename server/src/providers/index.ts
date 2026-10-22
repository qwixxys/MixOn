import type { AppConfig } from '../config.js';
import { notFound } from '../lib/errors.js';
import type { FetchLike } from '../lib/http.js';
import { DeezerProvider } from './deezer.js';
import { ItunesProvider } from './itunes.js';
import { JamendoProvider } from './jamendo.js';
import type { MusicProvider } from './types.js';
import { VkProvider } from './vk.js';

export * from './types.js';

export class ProviderRegistry {
  private byId = new Map<string, MusicProvider>();

  constructor(providers: MusicProvider[]) {
    for (const p of providers) this.byId.set(p.id, p);
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

export function createProviders(config: AppConfig, fetchImpl: FetchLike = fetch): ProviderRegistry {
  return new ProviderRegistry([
    new VkProvider(
      { apiVersion: config.vk.apiVersion, userAgent: config.vk.userAgent, fallbackToken: config.vk.accessToken },
      fetchImpl,
    ),
    new DeezerProvider(fetchImpl),
    new ItunesProvider(config.itunes.country, fetchImpl),
    new JamendoProvider(config.jamendo.clientId, fetchImpl),
  ]);
}
