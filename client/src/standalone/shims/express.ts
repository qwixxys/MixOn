// A small stand-in for Express 5, enough for soundFy's routes to run inside the standalone app: routers mounted under
// paths, `:param` routes, middleware, async handlers whose errors reach the error handler, req.params/query/body and
// res.status/json/redirect. Requests come in as fetch Request objects and leave as Response objects.

type Next = (err?: unknown) => void;
type Handler = (req: ShimRequest, res: ShimResponse, next: Next) => unknown;
type ErrorHandler = (err: unknown, req: ShimRequest, res: ShimResponse, next: Next) => unknown;

interface Layer {
  /** Mount prefix (`use`) or exact route path (`get`, `post`…); null matches everything. */
  path: string | null;
  method: string | null;
  handler: Handler | ErrorHandler;
  isError: boolean;
}

export interface ShimRequest {
  method: string;
  url: string;
  originalUrl: string;
  baseUrl: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  headers: Record<string, string>;
  protocol: string;
  userId?: number;
  file?: unknown;
  files?: unknown;
  /** Uploaded files from a multipart body; the multer shim rejects them. */
  uploads?: File[];
  get(name: string): string | undefined;
}

export class ShimResponse {
  statusCode = 200;
  headersSent = false;
  private headers = new Headers();
  private body: BodyInit | null = null;
  private resolve!: (response: Response) => void;
  readonly done = new Promise<Response>((resolve) => (this.resolve = resolve));

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name) ?? undefined;
  }

  set(name: string, value: string) {
    return this.setHeader(name, value);
  }

  type(contentType: string) {
    return this.setHeader('content-type', contentType);
  }

  json(data: unknown) {
    this.headers.set('content-type', 'application/json; charset=utf-8');
    return this.send(JSON.stringify(data));
  }

  send(body?: BodyInit | null) {
    if (this.headersSent) return this;
    this.body = body ?? null;
    return this.end();
  }

  redirect(statusOrUrl: number | string, maybeUrl?: string) {
    const [status, url] = typeof statusOrUrl === 'number' ? [statusOrUrl, maybeUrl!] : [302, statusOrUrl];
    this.statusCode = status;
    this.headers.set('location', url);
    return this.end();
  }

  sendFile() {
    throw Object.assign(new Error('Файлы на устройстве не раздаются'), { status: 404 });
  }

  on() {
    return this;
  }

  end(chunk?: BodyInit | null) {
    if (this.headersSent) return this;
    if (chunk !== undefined) this.body = chunk;
    this.headersSent = true;
    const noBody = this.statusCode === 204 || this.statusCode === 304;
    this.resolve(new Response(noBody ? null : this.body, { status: this.statusCode, headers: this.headers }));
    return this;
  }
}

function compile(path: string, end: boolean) {
  const keys: string[] = [];
  const pattern = path
    .replace(/\/+$/, '')
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { keys, regex: new RegExp(`^${pattern}${end ? '/?$' : '(?=/|$)'}`, 'i') };
}

const isRouter = (h: unknown): h is RouterFn => typeof h === 'function' && 'handle' in (h as object);

export interface RouterFn extends Handler {
  handle(req: ShimRequest, res: ShimResponse, out: Next): void;
  use(...args: unknown[]): RouterFn;
  get(path: string, ...handlers: Handler[]): RouterFn;
  post(path: string, ...handlers: Handler[]): RouterFn;
  put(path: string, ...handlers: Handler[]): RouterFn;
  patch(path: string, ...handlers: Handler[]): RouterFn;
  delete(path: string, ...handlers: Handler[]): RouterFn;
  set(...args: unknown[]): RouterFn;
  disable(...args: unknown[]): RouterFn;
}

export function Router(): RouterFn {
  const stack: Layer[] = [];

  const router = ((req: ShimRequest, res: ShimResponse, next: Next) => router.handle(req, res, next)) as RouterFn;

  const add = (method: string | null, path: string | null, handlers: unknown[]) => {
    for (const handler of handlers.flat()) {
      stack.push({ path, method, handler: handler as Handler, isError: !isRouter(handler) && (handler as Handler).length === 4 });
    }
    return router;
  };

  router.use = (...args: unknown[]) => (typeof args[0] === 'string' ? add(null, args[0], args.slice(1)) : add(null, null, args));
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    router[method] = (path: string, ...handlers: Handler[]) => add(method.toUpperCase(), path, handlers);
  }
  router.set = () => router;
  router.disable = () => router;

  router.handle = (req, res, out) => {
    let index = 0;
    const basePath = req.path;
    const baseUrl = req.baseUrl;
    const baseParams = req.params;

    const next: Next = (err) => {
      req.path = basePath;
      req.baseUrl = baseUrl;
      req.params = baseParams;
      if (res.headersSent) return;
      const layer = stack[index++];
      if (!layer) return out(err);
      if (err !== undefined ? !layer.isError : layer.isError) return next(err);
      if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) return next(err);

      let rest = basePath;
      if (layer.path) {
        const { keys, regex } = compile(layer.path, layer.method !== null);
        const match = regex.exec(basePath);
        if (!match) return next(err);
        const params = { ...baseParams };
        keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
        req.params = params;
        if (layer.method === null) {
          rest = basePath.slice(match[0].length) || '/';
          req.baseUrl = baseUrl + match[0];
          req.path = rest.startsWith('/') ? rest : `/${rest}`;
        }
      }

      try {
        const result = layer.isError
          ? (layer.handler as ErrorHandler)(err, req, res, next)
          : (layer.handler as Handler)(req, res, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          (result as Promise<unknown>).catch((e) => next(e ?? new Error('Rejected')));
        }
      } catch (e) {
        next(e);
      }
    };
    next();
  };

  return router;
}

export interface App extends RouterFn {
  /** Answers one request the way the soundFy server would. */
  fetch(request: Request): Promise<Response>;
}

async function readBody(request: Request, req: ShimRequest) {
  const type = request.headers.get('content-type') ?? '';
  if (request.method === 'GET' || request.method === 'HEAD') return;
  if (type.includes('application/json')) {
    const text = await request.text();
    try {
      req.body = text ? JSON.parse(text) : {};
    } catch {
      throw Object.assign(new Error('Некорректный JSON'), { type: 'entity.parse.failed', status: 400 });
    }
  } else if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const body: Record<string, string> = {};
    const uploads: File[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') body[key] = value;
      else uploads.push(value);
    }
    req.body = body;
    req.uploads = uploads;
  }
}

function express(): App {
  const app = Router() as App;
  app.fetch = async (request: Request) => {
    const url = new URL(request.url);
    const query: Record<string, string | string[]> = {};
    for (const [key, value] of url.searchParams) {
      const existing = query[key];
      query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
    }
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => (headers[key] = value));
    const req: ShimRequest = {
      method: request.method.toUpperCase(),
      url: url.pathname + url.search,
      originalUrl: url.pathname + url.search,
      baseUrl: '',
      path: url.pathname,
      params: {},
      query,
      body: undefined,
      headers,
      protocol: url.protocol.replace(':', ''),
      get: (name: string) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'host' ? url.host : undefined),
    };
    const res = new ShimResponse();
    try {
      await readBody(request, req);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
    app.handle(req, res, (err) => {
      if (res.headersSent) return;
      if (err) {
        console.error(err);
        res.status(500).json({ error: 'Внутренняя ошибка' });
      } else {
        res.status(404).json({ error: 'Не найдено' });
      }
    });
    return res.done;
  };
  return app;
}

/** Bodies are parsed before routing (see readBody), so these are pass-throughs. */
express.json = () => ((_req: ShimRequest, _res: ShimResponse, next: Next) => next()) as Handler;
express.urlencoded = express.json;
/** There are no files on the device to serve; anything under a static mount is "not found". */
express.static = (_root: string, options?: { fallthrough?: boolean }) =>
  ((_req: ShimRequest, _res: ShimResponse, next: Next) =>
    options?.fallthrough === false ? next(Object.assign(new Error('Not found'), { status: 404 })) : next()) as Handler;
express.Router = Router;

export default express;
export type { ShimRequest as Request, ShimResponse as Response, Next as NextFunction };
