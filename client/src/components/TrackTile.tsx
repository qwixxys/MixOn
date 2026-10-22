import { Link } from 'react-router';
import type { Track } from '../api/types';
import { Cover } from './Cover';
import { PlayButton } from './PlayButton';
import { ServiceBadge } from './ServiceBadge';

export function TrackTile({ track, queue }: { track: Track; queue?: Track[] }) {
  return (
    <div className="tile">
      <div className="tile-cover">
        <Link to={`/tracks/${track.id}`}>
          <Cover url={track.coverUrl} seed={track.id} />
        </Link>
        <div className="tile-play">
          <PlayButton track={track} queue={queue} size={48} />
        </div>
      </div>
      <Link to={`/tracks/${track.id}`} className="tile-title" title={track.title}>
        {track.title}
      </Link>
      <div className="tile-subtitle">
        {track.externalArtist ? (
          <Link to={`/artists/${track.externalArtist.id}`}>{track.artist}</Link>
        ) : track.uploader ? (
          <Link to={`/users/${track.uploader.username}`}>{track.artist}</Link>
        ) : (
          track.artist
        )}
      </div>
      <ServiceBadge source={track.source} preview={track.isPreview} />
    </div>
  );
}

export function TrackGrid({ tracks }: { tracks: Track[] }) {
  return (
    <div className="grid">
      {tracks.map((t) => (
        <TrackTile key={t.id} track={t} queue={tracks} />
      ))}
    </div>
  );
}
