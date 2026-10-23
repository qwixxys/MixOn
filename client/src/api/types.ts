export interface UserSummary {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Me extends UserSummary {
  email: string;
  bio: string;
  createdAt: string;
  /** The server's first account, which manages the service keys. */
  owner: boolean;
}

/** An API key the server owner can enter in the app. The value itself is never sent back, only a masked preview. */
export interface ServiceKeyInfo {
  name: string;
  service: string;
  label: string;
  secret: boolean;
  flag: boolean;
  /** The environment (.env), the app, soundFy's built-in key (Genius), or not set. */
  source: 'env' | 'app' | 'builtin' | null;
  preview: string | null;
}

export interface Profile extends UserSummary {
  bio: string;
  createdAt: string;
  followers: number;
  following: number;
  trackCount: number;
  likeCount: number;
  isFollowing: boolean;
  isMe: boolean;
}

export interface SuggestedUser extends UserSummary {
  followers: number;
  tracks?: number;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  description: string;
  genre: string | null;
  duration: number;
  coverUrl: string | null;
  waveform: number[];
  source: string;
  externalUrl: string | null;
  isPreview: boolean;
  playCount: number;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  releasedAt: string | null;
  createdAt: string;
  uploader: UserSummary | null;
  externalArtist: { id: number; provider: string; name: string; imageUrl: string | null } | null;
}

export interface Comment {
  id: number;
  body: string;
  atSeconds: number | null;
  createdAt: string;
  canDelete: boolean;
  user: UserSummary;
}

export interface Playlist {
  id: number;
  title: string;
  description: string;
  isPublic: boolean;
  trackCount: number;
  duration: number;
  coverUrl: string | null;
  owner: UserSummary;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistDetail extends Playlist {
  tracks: Track[];
}

export interface Notification {
  id: number;
  type: 'new_release' | 'new_upload';
  isRead: boolean;
  createdAt: string;
  track: Track;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  requiresToken: boolean;
  connectMode: 'token' | 'oauth' | null;
  /** Signs in with a login and password (VK). */
  canLogin?: boolean;
  fullTracks: boolean;
  configured: boolean;
  connected: boolean;
  account: { displayName: string | null; connectedAt: string } | null;
  serverToken: boolean;
  available: boolean;
  canImportLibrary: boolean;
  canImportFollowings: boolean;
  libraryLabel: string | null;
  /** Works through the service's internal API without keys; it may break or be blocked. */
  unofficial: boolean;
  /** Public playlists from this service can be imported by link. */
  importsLinks: boolean;
}

/** A step of signing in with a login and password (VK): the account connected, or what VK wants next. */
export type LoginStep =
  | { status: 'ok'; service: Service }
  | { status: 'code'; via: 'sms' | 'app' | 'call' | 'other'; phoneMask: string | null; wrongCode: boolean }
  | { status: 'captcha'; image: string | null; sid: string | null; page: string | null };

export interface ImportResult {
  playlistId: number;
  title: string;
  imported: number;
  /** Tracks read from the source; `total` can be larger when the import limit was reached. */
  fetched: number;
  total: number;
  newTracks: number;
  /** Spotify imports: songs found nowhere, and songs found only as 30-second previews. */
  missing?: number;
  previews?: number;
}

export interface FoundArtist {
  externalId: string;
  name: string;
  imageUrl: string | null;
  url: string | null;
  subtitle?: string | null;
  provider: string;
  artistId: number | null;
  isSubscribed: boolean;
}

export interface Artist {
  id: number;
  provider: string;
  externalId: string;
  name: string;
  imageUrl: string | null;
  url: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  trackCount: number;
  latestReleaseAt: string | null;
  subscribers: number;
  subscribedAt: string | null;
  isSubscribed: boolean;
}

export interface SyncResult {
  artistId: number;
  name: string;
  provider: string;
  fetched: number;
  newTracks: number;
  error: string | null;
}

export interface SyncSummary {
  artists: number;
  newTracks: number;
  errors: { artistId: number; name: string; provider: string; error: string }[];
}

export interface StreamSource {
  /** "youtube": a YouTube watch URL, played in YouTube's embedded player (store/youtube.ts). */
  kind: 'direct' | 'hls' | 'youtube';
  url: string;
}

export interface DiscoverData {
  trending: Track[];
  newReleases: Track[];
  freshUploads: Track[];
  playlists: Playlist[];
}

export interface SearchResults {
  tracks: Track[];
  users: SuggestedUser[];
  playlists: Playlist[];
  artists: { id: number; provider: string; name: string; imageUrl: string | null; trackCount: number }[];
}

export type TrackSort = 'new' | 'popular' | 'trending' | 'genre' | 'title';

export interface GenreFacet {
  name: string;
  count: number;
  coverUrl: string | null;
}

export interface GenreFacets {
  genres: GenreFacet[];
  untagged: number;
  total: number;
}

export interface GeniusPerson {
  id: number;
  name: string;
  url: string | null;
  imageUrl: string | null;
}

export interface GeniusSongRef {
  id: number;
  title: string;
  artist: string;
  url: string;
  imageUrl: string | null;
  releaseDate: string | null;
}

export interface GeniusSong extends GeniusSongRef {
  fullTitle: string;
  primaryArtist: GeniusPerson;
  featured: GeniusPerson[];
  writers: GeniusPerson[];
  producers: GeniusPerson[];
  credits: { label: string; people: GeniusPerson[] }[];
  album: { name: string; url: string | null; coverUrl: string | null } | null;
  description: string | null;
  relationships: { type: string; label: string; songs: GeniusSongRef[] }[];
  media: { provider: string; url: string }[];
  recordingLocation: string | null;
  pageviews: number | null;
  embedContent: string | null;
}

export interface TrackGenius {
  configured: boolean;
  song: GeniusSong | null;
  manual: boolean;
  canEdit: boolean;
}

export interface GeniusArtist {
  id: number;
  name: string;
  url: string | null;
  imageUrl: string | null;
  headerImageUrl: string | null;
  description: string | null;
  alternateNames: string[];
  verified: boolean;
  followers: number | null;
  links: { label: string; url: string }[];
  popularSongs: GeniusSongRef[];
}

export interface ArtistGenius {
  configured: boolean;
  artist: GeniusArtist | null;
}

export interface LyricLine {
  /** Seconds from the start of the full track. */
  time: number;
  text: string;
}

export interface TrackLyrics {
  enabled: boolean;
  found: boolean;
  source: 'lrclib' | null;
  instrumental: boolean;
  synced: LyricLine[] | null;
  plain: string | null;
}
