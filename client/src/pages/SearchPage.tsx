import { Link, useSearchParams } from 'react-router';
import type { SearchResults } from '../api/types';
import { Avatar } from '../components/Cover';
import { PlaylistGrid } from '../components/PlaylistTile';
import { ServiceBadge } from '../components/ServiceBadge';
import { Empty, ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackCard';
import { formatCount, plural } from '../lib/format';
import { STANDALONE } from '../lib/standalone';
import { useFetch } from '../lib/useFetch';
import { Icon } from '../components/Icon';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const { data, loading, error, reload } = useFetch<SearchResults>(q ? `/search?q=${encodeURIComponent(q)}` : null);
  const nothing = data && !data.tracks.length && !data.users.length && !data.playlists.length && !data.artists.length;

  return (
    <div className="page">
      <div className="page-header">
        <h1>{q ? `Результаты по запросу «${q}»` : 'Поиск'}</h1>
      </div>
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {q && (
        <div className="search-hint">
          <Icon name="hub" size={18} />
          <span>
            Ищете артиста из SoundCloud, {STANDALONE ? '' : 'ВК Музыки, '}Deezer или Apple Music?{' '}
            <Link to={`/sync?q=${encodeURIComponent(q)}`}>Найдите «{q}» в сервисах</Link> и подпишитесь на новые релизы.
          </span>
        </div>
      )}
      {nothing && <Empty title="Ничего не найдено">Попробуйте другой запрос.</Empty>}
      {data && data.artists.length > 0 && (
        <section className="section">
          <h2>Артисты с сервисов</h2>
          <div className="people">
            {data.artists.map((a) => (
              <Link key={a.id} to={`/artists/${a.id}`} className="person">
                <Avatar url={a.imageUrl} name={a.name} size={96} />
                <span className="person-name">{a.name}</span>
                <ServiceBadge source={a.provider} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {data && data.users.length > 0 && (
        <section className="section">
          <h2>Люди</h2>
          <div className="people">
            {data.users.map((u) => (
              <Link key={u.id} to={`/users/${u.username}`} className="person">
                <Avatar url={u.avatarUrl} name={u.displayName} size={96} />
                <span className="person-name">{u.displayName}</span>
                <span className="muted small">
                  {formatCount(u.followers)} {plural(u.followers, ['подписчик', 'подписчика', 'подписчиков'])}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {data && data.tracks.length > 0 && (
        <section className="section">
          <h2>Треки</h2>
          <TrackList tracks={data.tracks} />
        </section>
      )}
      {data && data.playlists.length > 0 && (
        <section className="section">
          <h2>Плейлисты</h2>
          <PlaylistGrid playlists={data.playlists} />
        </section>
      )}
    </div>
  );
}
