export type ProviderId = 'vk' | 'deezer' | 'itunes' | 'jamendo';

export interface ExternalArtist {
  externalId: string;
  name: string;
  imageUrl: string | null;
  url: string | null;
  /** Short human-readable hint shown in search results, e.g. "1.2M подписчиков". */
  subtitle?: string | null;
}

export interface ExternalTrack {
  externalId: string;
  title: string;
  artist: string;
  album: string | null;
  /** Full track length in seconds (even if only a preview is playable). */
  duration: number;
  streamUrl: string | null;
  coverUrl: string | null;
  externalUrl: string | null;
  releasedAt: string | null;
  genre: string | null;
  /** True when the service only gives a short (usually 30s) preview. */
  isPreview: boolean;
  /** Provider-specific data needed to re-resolve the stream later. */
  extra?: Record<string, unknown>;
}

export interface StreamSource {
  url: string;
  kind: 'direct' | 'hls';
}

export interface ArtistRef {
  externalId: string;
  name: string;
}

export interface ProviderContext {
  /** User access token for services that need one (VK). */
  token?: string | null;
}

export interface StoredExternalTrack {
  externalId: string;
  streamUrl: string | null;
  extra: Record<string, unknown> | null;
}

export interface MusicProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly description: string;
  /** Every request needs a user/server access token. */
  readonly requiresToken: boolean;
  /** Streams full tracks (as opposed to previews). */
  readonly fullTracks: boolean;
  /** Stream URLs must be fetched by the server and relayed to the browser. */
  readonly proxyStreams: boolean;
  /** Extra request headers the service expects when the server fetches audio. */
  readonly streamHeaders?: Record<string, string>;

  /** False when server-side configuration (API key) is missing. */
  isConfigured(): boolean;
  searchArtists(query: string, ctx: ProviderContext): Promise<ExternalArtist[]>;
  /** Latest tracks of an artist, newest first. */
  getArtistTracks(artist: ArtistRef, ctx: ProviderContext): Promise<ExternalTrack[]>;
  /** Fresh playable URL for a previously imported track. */
  resolveStream(track: StoredExternalTrack, ctx: ProviderContext): Promise<StreamSource | null>;

  /** Validates a user token, returning the account it belongs to. */
  verifyToken?(token: string): Promise<{ externalUserId: string; displayName: string }>;
  /** The user's own saved tracks on the service. */
  getUserLibrary?(ctx: ProviderContext): Promise<ExternalTrack[]>;
}

export function streamKind(url: string): StreamSource['kind'] {
  return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'direct';
}
