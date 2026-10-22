/** Display metadata for each music service. */
export const SERVICES: Record<string, { label: string; short: string; color: string }> = {
  local: { label: 'soundFy', short: 'SF', color: '#ff5500' },
  vk: { label: 'VK Музыка', short: 'VK', color: '#0077ff' },
  soundcloud: { label: 'SoundCloud', short: 'SC', color: '#ff5500' },
  deezer: { label: 'Deezer', short: 'DZ', color: '#a238ff' },
  itunes: { label: 'Apple Music', short: '', color: '#fa2d48' },
  jamendo: { label: 'Jamendo', short: 'JM', color: '#00b39b' },
};

export function serviceInfo(id: string) {
  return SERVICES[id] ?? { label: id, short: id.slice(0, 2).toUpperCase(), color: '#777' };
}
