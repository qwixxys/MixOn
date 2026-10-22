import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push(message: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(message, kind = 'info') {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-3), { id, message, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export const toast = {
  info: (m: string) => useToasts.getState().push(m, 'info'),
  success: (m: string) => useToasts.getState().push(m, 'success'),
  error: (m: string | unknown) =>
    useToasts.getState().push(typeof m === 'string' ? m : ((m as Error)?.message ?? 'Ошибка'), 'error'),
};
