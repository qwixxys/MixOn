import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AppContext } from '../context.js';
import { unauthorized } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function signToken(userId: number, secret: string): string {
  return jwt.sign({ sub: String(userId) }, secret, { expiresIn: '30d' });
}

/** Attaches `req.userId` when a valid bearer token is present; never rejects. */
export function authenticate(ctx: AppContext) {
  const userExists = ctx.db.prepare('SELECT 1 FROM users WHERE id = ?');
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(header.slice(7), ctx.config.jwtSecret) as jwt.JwtPayload;
        const id = Number(payload.sub);
        if (id && userExists.get(id)) req.userId = id;
      } catch {
        // invalid or expired token: treat as guest
      }
    }
    next();
  };
}

export function requireUser(req: Request): number {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
