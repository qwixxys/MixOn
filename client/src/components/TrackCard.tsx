import { Fragment } from 'react';
import { Link } from 'react-router';
import type { Track } from '../api/types';
import { formatCount, formatTime, timeAgo } from '../lib/format';
import { usePlayer, useTrackProgress } from '../store/player';
import { Avatar, Cover } from './Cover';
import { PlayButton } from './PlayButton';
import { PreviewNote, ServiceBadge } from './ServiceBadge';
import { TrackActions } from './TrackActions';
import { Waveform } from './Waveform';
import { Icon } from './Icon';
import { tr } from '../i18n/runtime';

/** Approximate playable length used before the player knows the real duration. */
export function playableDuration(track: Track) {
  return track.isPreview ? Math.min(30, track.duration || 30) : track.duration;
}

export function TrackByline({ track }: { track: Track }) {
  if (track.uploader) {
    return (
      <Link to={`/users/${track.uploader.username}`} className="byline">
        <Avatar url={track.uploader.avatarUrl} name={track.uploader.displayName} size={18} />
        {track.uploader.displayName}
      </Link>
    );
  }
  if (track.externalArtist) {
    return (
      <Link to={`/artists/${track.externalArtist.id}`} className="byline">
        {track.artist}
      </Link>
    );
  }
  return <span className="byline">{track.artist}</span>;
}

export function TrackCard({ track, queue, reason }: { track: Track; queue?: Track[]; reason?: string }) {
  const progress = useTrackProgress(track.id);
  const isCurrent = usePlayer((s) => s.current?.id === track.id);
  const playerDuration = usePlayer((s) => (s.current?.id === track.id ? s.duration : 0));
  const play = usePlayer((s) => s.play);
  const seek = usePlayer((s) => s.seek);
  const duration = isCurrent && playerDuration ? playerDuration : playableDuration(track);

  return (
    <article className={`track-card ${isCurrent ? 'is-current' : ''}`}>
      <Link to={`/tracks/${track.id}`} className="track-card-cover">
        <Cover url={track.coverUrl} seed={track.id} />
      </Link>
      <div className="track-card-body">
        <div className="track-card-head">
          <PlayButton track={track} queue={queue} size={40} />
          <div className="track-card-titles">
            <div className="track-card-byline">
              <TrackByline track={track} />
              {reason && <span className="muted"> · {reason}</span>}
            </div>
            <Link to={`/tracks/${track.id}`} className="track-card-title">
              {track.title}
            </Link>
            <PreviewNote track={track} />
          </div>
          <div className="track-card-meta">
            <span className="muted small" title={track.releasedAt ?? track.createdAt}>
              {timeAgo(track.releasedAt ?? track.createdAt)}
            </span>
            <div className="tags">
              <ServiceBadge source={track.source} preview={track.isPreview} />
              {track.genre && (
                <Link to={`/discover?genre=${encodeURIComponent(track.genre)}`} className="tag">
                  #{tr(track.genre)}
                </Link>
              )}
            </div>
          </div>
        </div>
        <Waveform
          peaks={track.waveform}
          progress={progress}
          height={56}
          duration={duration}
          onSeek={(f) => (isCurrent ? seek(f * duration) : play(track, queue, f * duration))}
        />
        <div className="track-card-footer">
          <TrackActions track={track} />
          <div className="track-stats">
            <span title="Прослушивания">
              <Icon name="play_arrow" size={18} filled /> {formatCount(track.playCount)}
            </span>
            <Link to={`/tracks/${track.id}#comments`} title="Комментарии">
              <Icon name="chat_bubble" size={18} /> {formatCount(track.commentCount)}
            </Link>
            <span className="muted">{formatTime(track.duration)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function TrackList({
  tracks,
  reason,
  groupByGenre = false,
}: {
  tracks: Track[];
  reason?: (t: Track) => string | undefined;
  /** Insert a subheader whenever the genre changes (for lists sorted by genre). */
  groupByGenre?: boolean;
}) {
  return (
    <div className="track-list">
      {tracks.map((t, i) => (
        <Fragment key={t.id}>
          {groupByGenre && (i === 0 || tracks[i - 1].genre !== t.genre) && (
            <h3 className="list-subheader">
              <Icon name="category" size={20} />
              {tr(t.genre) ?? 'Без жанра'}
            </h3>
          )}
          <TrackCard track={t} queue={tracks} reason={reason?.(t)} />
        </Fragment>
      ))}
    </div>
  );
}
