import { create } from 'zustand';

const KEY = 'soundfy.playVia';

/**
 * The service music plays through, chosen on «Сервисы». A track found elsewhere (a Deezer preview in the feed, an
 * artist's release from Apple Music) is looked up there and played from there (see store/player.ts); null plays each
 * track where it was found.
 */
interface PlayViaState {
  via: string | null;
  setVia(via: string | null): void;
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export const usePlayVia = create<PlayViaState>((set) => ({
  via: read(),
  setVia(via) {
    try {
      if (via) localStorage.setItem(KEY, via);
      else localStorage.removeItem(KEY);
    } catch {
      // storage unavailable: the choice lasts until reload
    }
    set({ via });
  },
}));
