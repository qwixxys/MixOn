import type { DB } from '../db/index.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { MusicProvider } from '../providers/types.js';
import type { SyncService } from '../sync/syncService.js';
import { findSong } from './findSong.js';
import { getTrack, type TrackDTO, type TrackRow } from './tracks.js';

/** How long a found (or missing) version of a song on another service is remembered. */
const FOUND_TTL_MS = 24 * 60 * 60_000;
const MISSING_TTL_MS = 60 * 60_000;
const CACHE_SIZE = 2000;

const rank = (id: string, preferred: string | null) => (id === preferred ? 0 : id === 'vk' ? 2 : 1);

/**
 * The same song on other services: for «Слушать через», for carrying on without YouTube's video, and for «Моя волна»,
 * which plays whole songs only. Answers are remembered for a while, so a queue played again does not search the
 * services again; per listener, as the services answer each account with what it may play. Two lookups of the same
 * song at once search once.
 */
export class SongVersions {
  private found = new Map<string, { id: number | null; until: number }>();
  private searching = new Map<string, Promise<number | null>>();

  constructor(
    private db: DB,
    private providers: ProviderRegistry,
    private sync: SyncService,
  ) {}

  /** `row`'s song as a full track on one of `services`, tried in order; `on` names that choice in the cache. */
  async find(me: number, row: TrackRow, on: string, services: MusicProvider[]): Promise<TrackDTO | null> {
    const key = `${me}:${row.id}:${on}`;
    const known = this.found.get(key);
    let id = known && known.until > Date.now() ? known.id : undefined;
    if (id === undefined) {
      let search = this.searching.get(key);
      if (!search) {
        search = findSong(row, services, (p) => this.sync.userToken(p, me))
          .then((hit) => {
            const stored = hit ? this.sync.storeTracks([hit.track], hit.provider, null).ids[0] : null;
            this.found.delete(key);
            this.found.set(key, { id: stored, until: Date.now() + (stored ? FOUND_TTL_MS : MISSING_TTL_MS) });
            if (this.found.size > CACHE_SIZE) this.found.delete(this.found.keys().next().value!);
            return stored;
          })
          .finally(() => this.searching.delete(key));
        this.searching.set(key, search);
      }
      id = await search;
    }
    return id ? getTrack(this.db, id, me) : null;
  }

  /**
   * The whole song for a preview (Deezer, Apple Music, a SoundCloud Go snippet): from `preferred` first when the
   * listener chose a service to listen through, then from any service with full tracks. YouTube only when chosen, as
   * its songs play in a video window.
   */
  full(me: number, row: TrackRow, preferred: string | null): Promise<TrackDTO | null> {
    const services = this.providers
      .list()
      .filter((p) => p.fullTracks && p.id !== row.source && (p.id !== 'youtube' || p.id === preferred))
      // VK limits searches more strictly than the others, so unless chosen it is asked last.
      .sort((a, b) => rank(a.id, preferred) - rank(b.id, preferred));
    return this.find(me, row, `full:${preferred ?? ''}`, services);
  }
}
