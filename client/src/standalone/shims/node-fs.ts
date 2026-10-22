// The standalone app keeps no files: uploads are turned off, so the server's file helpers do nothing.
const unsupported = (name: string) => () => {
  throw new Error(`fs.${name} недоступен в автономном режиме`);
};

export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const writeFileSync = () => undefined;
export const rm = (_path: string, _options: unknown, callback?: () => void) => callback?.();
export const readFileSync = unsupported('readFileSync');
export const createReadStream = unsupported('createReadStream');
export const statSync = unsupported('statSync');

export default { existsSync, mkdirSync, writeFileSync, rm, readFileSync, createReadStream, statSync };
