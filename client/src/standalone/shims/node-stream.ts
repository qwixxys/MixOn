// The server streams audio files and relayed streams with Node streams; the standalone app plays services' links
// directly, so these are never reached.
const unsupported = () => {
  throw new Error('Потоки недоступны в автономном режиме');
};

export const Readable = { fromWeb: unsupported };
export const pipeline = unsupported;
export default { Readable, pipeline };
