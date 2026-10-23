export type ProviderId = 'vk' | 'deezer' | 'itunes' | 'jamendo' | 'soundcloud' | 'youtube';

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
  /** "youtube": a YouTube video (watch URL) that may only be played in YouTube's embedded player. */
  kind: 'direct' | 'hls' | 'youtube';
}

/** What the app-wide search found on one service. */
export interface SearchHits {
  artists: ExternalArtist[];
  tracks: ExternalTrack[];
}

/** Tracks each service contributes to the app-wide search. */
export const SEARCH_TRACK_LIMIT = 15;

export interface ArtistRef {
  externalId: string;
  name: string;
}

export interface ProviderContext {
  /** User access token for services that need one (VK). */
  token?: string | null;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO time the access token stops working, if the service says. */
  expiresAt: string | null;
}

/** OAuth 2.1 authorization-code flow with PKCE. */
export interface OAuthFlow {
  authorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
}

/** A playlist or album read from a public link. */
export interface ImportedPlaylist {
  title: string;
  description: string | null;
  /** Canonical link to the source; the same playlist imported again is recognised by it. */
  url: string;
  tracks: ExternalTrack[];
  /** Tracks the source lists, including ones that could not be imported. */
  total: number;
  /** Tracks actually read: fewer than `total` when the import limit cut the list short. */
  fetched: number;
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
  /** How a user links their account: by pasting a token, via OAuth, or not at all. */
  readonly connectMode: 'token' | 'oauth' | null;
  /** What `getUserLibrary` imports, e.g. "мои аудиозаписи" or "лайки". */
  readonly libraryLabel?: string;
  /** Streams full tracks (as opposed to previews). */
  readonly fullTracks: boolean;
  /** Stream URLs must be fetched by the server and relayed to the browser. */
  readonly proxyStreams: boolean;
  /** Works through a service's internal API rather than an official one, which may break or be blocked. */
  readonly unofficial?: boolean;
  /** Extra request headers the service expects when the server fetches audio. */
  readonly streamHeaders?: Record<string, string>;

  /** False when server-side configuration (API key) is missing. */
  isConfigured(): boolean;
  searchArtists(query: string, ctx: ProviderContext): Promise<ExternalArtist[]>;
  /** Artists and tracks for the app-wide search (only artists when a service has no track search). */
  search?(query: string, ctx: ProviderContext): Promise<SearchHits>;
  /** Latest tracks of an artist, newest first. */
  getArtistTracks(artist: ArtistRef, ctx: ProviderContext): Promise<ExternalTrack[]>;
  /** Fresh playable URL for a previously imported track. */
  resolveStream(track: StoredExternalTrack, ctx: ProviderContext): Promise<StreamSource | null>;

  /** Validates a user token, returning the account it belongs to. */
  verifyToken?(token: string): Promise<{ externalUserId: string; displayName: string }>;
  /** The user's own saved tracks on the service. */
  getUserLibrary?(ctx: ProviderContext): Promise<ExternalTrack[]>;
  /** Artists the user follows on the service. */
  getUserFollowings?(ctx: ProviderContext): Promise<ExternalArtist[]>;

  /** Whether `importPlaylist` understands this (already expanded) link. */
  canImport?(url: URL): boolean;
  importPlaylist?(url: URL, ctx: ProviderContext): Promise<ImportedPlaylist>;
  /** Share-link hosts that redirect to the service (fetched only to read the redirect). */
  readonly shortLinkHosts?: string[];
  readonly oauth?: OAuthFlow;
}

/**
 * When a signed CDN link stops working, if the link says so: `expires`/`Expires` (unix seconds, SoundCloud's CloudFront
 * links) or `hdnea=exp=…` (Deezer previews). Milliseconds since the epoch.
 */
export function signedUrlExpiry(url: string): number | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const value = parsed.searchParams.get('expires') ?? parsed.searchParams.get('Expires') ?? parsed.searchParams.get('hdnea')?.match(/(?:^|~)exp=(\d+)/)?.[1];
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function streamKind(url: string): 'direct' | 'hls' {
  return /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'direct';
}
