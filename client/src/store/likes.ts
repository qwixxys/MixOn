import { create } from 'zustand';
import { api } from '../api/client';
import type { Track } from '../api/types';

interface LikeInfo {
  liked: boolean;
  likeCount: number;
}

interface LikesState {
  /** Likes changed during this session, overriding what list endpoints returned earlier. */
  overrides: Record<number, LikeInfo>;
  toggle(track: Track): Promise<void>;
  reset(): void;
}

export const useLikes = create<LikesState>((set, get) => ({
  overrides: {},
  async toggle(track) {
    const current = get().overrides[track.id] ?? { liked: track.liked, likeCount: track.likeCount };
    const optimistic = { liked: !current.liked, likeCount: current.likeCount + (current.liked ? -1 : 1) };
    set({ overrides: { ...get().overrides, [track.id]: optimistic } });
    try {
      const result = await api<LikeInfo>(`/tracks/${track.id}/like`, { method: current.liked ? 'DELETE' : 'POST' });
      set({ overrides: { ...get().overrides, [track.id]: result } });
    } catch (err) {
      set({ overrides: { ...get().overrides, [track.id]: current } });
      throw err;
    }
  },
  reset() {
    set({ overrides: {} });
  },
}));

export function useLikeState(track: Track): LikeInfo {
  const override = useLikes((s) => s.overrides[track.id]);
  return override ?? { liked: track.liked, likeCount: track.likeCount };
}
