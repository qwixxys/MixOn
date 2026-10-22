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
  fullTracks: boolean;
  configured: boolean;
  connected: boolean;
  account: { displayName: string | null; connectedAt: string } | null;
  serverToken: boolean;
  available: boolean;
  canImportLibrary: boolean;
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

export interface ArtistDetail extends Artist {
  tracks: Track[];
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
  kind: 'direct' | 'hls';
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
