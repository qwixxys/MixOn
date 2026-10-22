import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

/** Offset-paginated list from `/api${path}` with "load more" support. */
export function usePaged<T>(path: string | null, pageSize = 20) {
  const userId = useAuth((s) => s.user?.id ?? 0);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [version, setVersion] = useState(0);

  const fetchPage = useCallback(
    (offset: number, signal?: AbortSignal) => {
      const sep = path!.includes('?') ? '&' : '?';
      return api<T[]>(`${path}${sep}limit=${pageSize}&offset=${offset}`, { signal });
    },
    [path, pageSize],
  );

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchPage(0, controller.signal)
      .then((page) => {
        setItems(page);
        setHasMore(page.length === pageSize);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setError(err.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, pageSize, fetchPage, version, userId]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchPage(items.length);
      setItems((prev) => [...prev, ...page]);
      setHasMore(page.length === pageSize);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, items.length, pageSize]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { items, setItems, loading, error, hasMore, loadMore, reload };
}
