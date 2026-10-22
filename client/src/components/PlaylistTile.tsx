import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import type { Playlist } from '../api/types';
import { plural } from '../lib/format';
import { Cover } from './Cover';

export function PlaylistTile({ playlist }: { playlist: Playlist }) {
  return (
    <Link to={`/playlists/${playlist.id}`} className="tile tile-link">
      <div className="tile-cover tile-cover-stack">
        <Cover url={playlist.coverUrl} seed={`p${playlist.id}`} />
      </div>
      <span className="tile-title">
        {!playlist.isPublic && <Lock size={12} />} {playlist.title}
      </span>
      <span className="tile-subtitle">
        {playlist.owner.displayName} · {playlist.trackCount} {plural(playlist.trackCount, ['трек', 'трека', 'треков'])}
      </span>
    </Link>
  );
}

export function PlaylistGrid({ playlists }: { playlists: Playlist[] }) {
  return (
    <div className="grid">
      {playlists.map((p) => (
        <PlaylistTile key={p.id} playlist={p} />
      ))}
    </div>
  );
}
