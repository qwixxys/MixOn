export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public code?: string | number,
  ) {
    super(message);
  }
}

export async function fetchJson<T = unknown>(
  fetchImpl: FetchLike,
  provider: string,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15000, ...rest } = init;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ProviderError(provider, `Сервис недоступен: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ProviderError(provider, `Сервис ответил ошибкой HTTP ${res.status}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderError(provider, 'Сервис вернул некорректный ответ');
  }
}

/**
 * Who is waiting on a request: «urgent» for a song about to play, «normal» for what a listener is looking at,
 * «background» for work nobody waits on (filling «Моя волна», recommendations).
 */
export type RequestLane = 'urgent' | 'normal' | 'background';

/**
 * Spaces requests to a service so that at most one starts every `intervalMs`, the waiting ones by lane: urgent first,
 * then normal, then background. A song to play waits one interval at most, never behind a queue of lookups.
 */
export class RateLimiter {
  private next = 0;
  private queues: Record<RequestLane, (() => void)[]> = { urgent: [], normal: [], background: [] };
  private pumping = false;

  constructor(private intervalMs: number) {}

  wait(lane: RequestLane = 'normal'): Promise<void> {
    return new Promise((resolve) => {
      this.queues[lane].push(resolve);
      void this.pump();
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queues.urgent.length || this.queues.normal.length || this.queues.background.length) {
        const delay = this.next - Date.now();
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        // Chosen after the wait, so a request that came meanwhile goes before the less pressing ones.
        const go = this.queues.urgent.shift() ?? this.queues.normal.shift() ?? this.queues.background.shift();
        if (!go) break;
        this.next = Date.now() + this.intervalMs;
        go();
      }
    } finally {
      this.pumping = false;
    }
  }
}
