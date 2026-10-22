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

/** Serialises calls so that at most one request starts every `intervalMs`. */
export class RateLimiter {
  private next = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private intervalMs: number) {}

  wait(): Promise<void> {
    const run = this.chain.then(async () => {
      const delay = this.next - Date.now();
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      this.next = Date.now() + this.intervalMs;
    });
    this.chain = run.catch(() => {});
    return run;
  }
}
