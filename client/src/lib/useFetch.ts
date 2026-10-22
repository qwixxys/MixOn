import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Loads `/api${path}` and reloads when the path or the signed-in user changes
 * (responses include per-viewer flags such as `liked`). Pass null to skip.
 */
export function useFetch<T>(path: string | null) {
  const userId = useAuth((s) => s.user?.id ?? 0);
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) setState({ data: null, error: err.message, loading: false });
      });
    return () => controller.abort();
  }, [path, version, userId]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((update: (data: T | null) => T | null) => {
    setState((s) => ({ ...s, data: update(s.data) }));
  }, []);

  return { ...state, reload, setData };
}
