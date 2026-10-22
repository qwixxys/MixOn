// Session tokens for the standalone app, where the "server" runs inside the app itself and nothing is sent over a
// network: a plain encoded payload with an expiry is enough.
export interface JwtPayload {
  sub?: string;
  exp?: number;
  [key: string]: unknown;
}

const DURATIONS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
const toSeconds = (value: string | number) =>
  typeof value === 'number' ? value : Number(value.slice(0, -1)) * (DURATIONS[value.slice(-1)] ?? 1);

function sign(payload: object, _secret: string, options?: { expiresIn?: string | number }) {
  const exp = options?.expiresIn ? Math.floor(Date.now() / 1000) + toSeconds(options.expiresIn) : undefined;
  return `local.${btoa(encodeURIComponent(JSON.stringify({ ...payload, exp })))}`;
}

function verify(token: string): JwtPayload {
  if (!token.startsWith('local.')) throw new Error('invalid token');
  const payload = JSON.parse(decodeURIComponent(atob(token.slice(6)))) as JwtPayload;
  if (payload.exp && payload.exp < Date.now() / 1000) throw new Error('jwt expired');
  return payload;
}

export default { sign, verify };
