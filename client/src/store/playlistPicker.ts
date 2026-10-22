import { create } from 'zustand';
import type { Track } from '../api/types';

interface PickerState {
  track: Track | null;
  open(track: Track): void;
  close(): void;
}

/** Which track the "add to playlist" dialog is open for. */
export const usePlaylistPicker = create<PickerState>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}));
