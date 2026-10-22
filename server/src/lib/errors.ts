export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Требуется авторизация') => new HttpError(401, message);
export const forbidden = (message = 'Недостаточно прав') => new HttpError(403, message);
export const notFound = (message = 'Не найдено') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
