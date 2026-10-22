import type { Request, Response } from './express';

/** Uploads are not available in the standalone app: text fields pass through, files are refused. */
class MulterError extends Error {
  constructor(
    readonly code: string,
    readonly field?: string,
  ) {
    super(code);
  }
}

const refuseFiles = (req: Request, _res: Response, next: (err?: unknown) => void) => {
  if (req.uploads?.length) {
    return next(Object.assign(new Error('Загрузка файлов недоступна в автономном режиме'), { status: 400 }));
  }
  next();
};

function multer() {
  return { single: () => refuseFiles, array: () => refuseFiles, fields: () => refuseFiles, none: () => refuseFiles, any: () => refuseFiles };
}
multer.diskStorage = (options: unknown) => options;
multer.memoryStorage = () => ({});
multer.MulterError = MulterError;

export default multer;
