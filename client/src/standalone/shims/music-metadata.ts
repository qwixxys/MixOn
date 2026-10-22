// Tags are only read from uploaded files, which the standalone app does not accept.
export async function parseFile(): Promise<never> {
  throw new Error('Загрузка файлов недоступна в автономном режиме');
}
