import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { SuggestedUser } from '../api/types';
import { formatCount, plural } from '../lib/format';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Avatar } from './Cover';

export function SuggestedUsers() {
  const { data } = useFetch<SuggestedUser[]>('/users/suggested');
  const [followed, setFollowed] = useState<number[]>([]);
  if (!data?.length) return null;

  const follow = async (u: SuggestedUser) => {
    try {
      await api(`/users/${u.username}/follow`, { method: 'POST' });
      setFollowed((f) => [...f, u.id]);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="side-card">
      <div className="side-card-header">
        <h3>Кого послушать</h3>
      </div>
      {data.map((u) => (
        <div key={u.id} className="user-line">
          <Link to={`/users/${u.username}`}>
            <Avatar url={u.avatarUrl} name={u.displayName} size={40} />
          </Link>
          <div className="user-line-main">
            <Link to={`/users/${u.username}`}>{u.displayName}</Link>
            <span className="muted small">
              {formatCount(u.followers)} {plural(u.followers, ['подписчик', 'подписчика', 'подписчиков'])}
              {u.tracks !== undefined && ` · ${u.tracks} ${plural(u.tracks, ['трек', 'трека', 'треков'])}`}
            </span>
          </div>
          <button className="btn btn-small btn-outline" disabled={followed.includes(u.id)} onClick={() => follow(u)}>
            {followed.includes(u.id) ? 'Вы подписаны' : 'Подписаться'}
          </button>
        </div>
      ))}
    </section>
  );
}
