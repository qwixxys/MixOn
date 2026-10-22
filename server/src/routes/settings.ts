import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { requireUser } from '../middleware/auth.js';
import { SERVICE_KEYS, type ServiceKeyName } from '../settings.js';

/** The server's owner is its first account: on the desktop app that is the person who installed it. */
export function isOwner(db: DB, userId: number | null | undefined): boolean {
  if (!userId) return false;
  const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  return first?.id === userId;
}

const names = SERVICE_KEYS.map((k) => k.name) as [ServiceKeyName, ...ServiceKeyName[]];
const saveSchema = z.object({
  values: z.record(z.enum(names), z.string().max(500, 'слишком длинный ключ').nullable()),
});

export function settingsRoutes(ctx: AppContext) {
  const r = Router();
  const { db, settings } = ctx;

  const requireOwner = (req: Parameters<typeof requireUser>[0]) => {
    const me = requireUser(req);
    if (!isOwner(db, me)) throw forbidden('Ключи сервисов может менять только владелец сервера — первый зарегистрированный аккаунт');
    return me;
  };

  r.get('/settings/keys', (req, res) => {
    requireOwner(req);
    res.json(settings.list());
  });

  r.put('/settings/keys', (req, res) => {
    requireOwner(req);
    const { values } = parse(saveSchema, req.body);
    for (const name of Object.keys(values) as ServiceKeyName[]) {
      if (settings.isFromEnv(name)) throw badRequest(`${name} задан в настройках сервера (.env) и здесь не меняется`);
    }
    settings.save(values);
    res.json(settings.list());
  });

  return r;
}
