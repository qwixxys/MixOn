import { api } from '../api/client';
import type { Artist, FoundArtist } from '../api/types';

/** The soundFy page of an artist found on a service; opening it the first time also loads the artist's tracks. */
export async function openFoundArtist(a: FoundArtist): Promise<number> {
  if (a.artistId) return a.artistId;
  const artist = await api<Artist>('/artists', {
    body: { provider: a.provider, externalId: a.externalId, name: a.name, imageUrl: a.imageUrl, url: a.url },
  });
  return artist.id;
}
