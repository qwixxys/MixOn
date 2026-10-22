import { Heart } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Track } from '../api/types';
import { formatCount } from '../lib/format';
import { useAuth } from '../store/auth';
import { useLikes, useLikeState } from '../store/likes';
import { toast } from '../store/toasts';

export function LikeButton({ track, showCount = true, small = false }: { track: Track; showCount?: boolean; small?: boolean }) {
  const { liked, likeCount } = useLikeState(track);
  const toggle = useLikes((s) => s.toggle);
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();

  return (
    <button
      className={`action-btn ${liked ? 'action-btn-active' : ''} ${small ? 'action-btn-small' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!user) return navigate('/login');
        toggle(track).catch(toast.error);
      }}
      title={liked ? 'Убрать из понравившихся' : 'Нравится'}
      aria-pressed={liked}
    >
      <Heart size={small ? 14 : 15} fill={liked ? 'currentColor' : 'none'} />
      {showCount && <span>{likeCount ? formatCount(likeCount) : small ? '' : 'Нравится'}</span>}
    </button>
  );
}
