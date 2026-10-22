import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { AppConfig } from '../config.js';
import { badRequest } from './errors.js';

export type UploadKind = 'audio' | 'covers' | 'avatars';

export const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};
const AUDIO_EXT = new Set(Object.keys(AUDIO_TYPES));
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function uploadDir(config: AppConfig, kind: UploadKind): string {
  return path.join(config.dataDir, 'uploads', kind);
}

export function ensureUploadDirs(config: AppConfig) {
  for (const kind of ['audio', 'covers', 'avatars'] as const) {
    fs.mkdirSync(uploadDir(config, kind), { recursive: true });
  }
}

export function removeUpload(config: AppConfig, kind: UploadKind, name: string | null | undefined) {
  if (!name) return;
  fs.rm(path.join(uploadDir(config, kind), path.basename(name)), { force: true }, () => {});
}

function isAudio(file: Express.Multer.File) {
  return file.mimetype.startsWith('audio/') || AUDIO_EXT.has(path.extname(file.originalname).toLowerCase());
}
function isImage(file: Express.Multer.File) {
  return file.mimetype.startsWith('image/') && IMAGE_EXT.has(path.extname(file.originalname).toLowerCase());
}

/** Multer instance that stores `audio` fields under uploads/audio and image fields under covers/avatars. */
export function createUploader(config: AppConfig) {
  const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
      const kind: UploadKind = file.fieldname === 'audio' ? 'audio' : file.fieldname === 'avatar' ? 'avatars' : 'covers';
      cb(null, uploadDir(config, kind));
    },
    filename: (_req, file, cb) => {
      // Only whitelisted extensions are kept, since files are later served with a type derived from them.
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = file.fieldname === 'audio' ? AUDIO_EXT : IMAGE_EXT;
      cb(null, `${crypto.randomBytes(12).toString('hex')}${allowed.has(ext) ? ext : ''}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 2 },
    fileFilter: (_req, file, cb) => {
      if (file.fieldname === 'audio') {
        return isAudio(file) ? cb(null, true) : cb(badRequest('Поддерживаются MP3, M4A, AAC, OGG, OPUS, WAV, FLAC'));
      }
      return isImage(file) ? cb(null, true) : cb(badRequest('Обложка должна быть изображением JPG, PNG, WEBP или GIF'));
    },
  });
}

function requestFiles(req: Request): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return req.files ? Object.values(req.files).flat() : [];
}

/** Wraps a multipart handler so files multer already wrote are deleted if the handler fails. */
export function withUploads(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (err) {
      for (const file of requestFiles(req)) fs.rm(file.path, { force: true }, () => {});
      throw err;
    }
  };
}
