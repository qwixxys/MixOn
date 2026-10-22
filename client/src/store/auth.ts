import { create } from 'zustand';
import { api, getToken, setToken } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  ready: boolean;
  init(): Promise<void>;
  login(login: string, password: string): Promise<void>;
  register(input: { username: string; email: string; password: string; displayName?: string }): Promise<void>;
  logout(): void;
  setUser(user: Me): void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  ready: false,
  async init() {
    if (!getToken()) return set({ ready: true });
    try {
      const { user } = await api<{ user: Me }>('/auth/me');
      set({ user, ready: true });
    } catch {
      setToken(null);
      set({ user: null, ready: true });
    }
  },
  async login(login, password) {
    const { token, user } = await api<{ token: string; user: Me }>('/auth/login', { body: { login, password } });
    setToken(token);
    set({ user });
  },
  async register(input) {
    const { token, user } = await api<{ token: string; user: Me }>('/auth/register', { body: input });
    setToken(token);
    set({ user });
  },
  logout() {
    setToken(null);
    set({ user: null });
  },
  setUser(user) {
    set({ user });
  },
}));
