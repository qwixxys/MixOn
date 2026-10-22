import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { avatarUrl } from '../lib/tracks.js';
import { parse } from '../lib/validate.js';
import { requireUser, signToken } from '../middleware/auth.js';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  created_at: string;
}

export function toMe(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: avatarUrl(row.avatar_path),
    createdAt: row.created_at,
  };
}

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'минимум 3 символа')
    .max(30, 'максимум 30 символов')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'только латиница, цифры, точка, дефис и подчёркивание'),
  email: z.string().trim().email('некорректный email'),
  password: z.string().min(6, 'минимум 6 символов').max(200),
  displayName: z.string().trim().max(60).optional(),
});

const loginSchema = z.object({
  login: z.string().trim().min(1, 'введите логин или email'),
  password: z.string().min(1, 'введите пароль'),
});

export function authRoutes(ctx: AppContext) {
  const r = Router();
  const { db, config } = ctx;

  r.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body);
    const taken = db
      .prepare('SELECT username FROM users WHERE username = ? OR email = ?')
      .get(input.username, input.email) as { username: string } | undefined;
    if (taken) {
      throw conflict(
        taken.username.toLowerCase() === input.username.toLowerCase()
          ? 'Это имя пользователя уже занято'
          : 'Этот email уже зарегистрирован',
      );
    }
    const hash = await bcrypt.hash(input.password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
      .run(input.username, input.email, hash, input.displayName || input.username);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid) as UserRow;
    res.status(201).json({ token: signToken(user.id, config.jwtSecret), user: toMe(user) });
  });

  r.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(input.login, input.login) as
      | UserRow
      | undefined;
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw unauthorized('Неверный логин или пароль');
    }
    res.json({ token: signToken(user.id, config.jwtSecret), user: toMe(user) });
  });

  r.get('/me', (req, res) => {
    const id = requireUser(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    res.json({ user: toMe(user) });
  });

  return r;
}
