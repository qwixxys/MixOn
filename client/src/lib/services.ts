/** Display metadata for each music service; `ink` is the logo's colour on its brand background (white by default). */
export const SERVICES: Record<string, { label: string; short: string; color: string; ink?: string }> = {
  local: { label: 'MixOn', short: 'SF', color: '#ff5500' },
  vk: { label: 'VK Музыка', short: 'VK', color: '#0077ff' },
  soundcloud: { label: 'SoundCloud', short: 'SC', color: '#ff5500' },
  deezer: { label: 'Deezer', short: 'DZ', color: '#a238ff' },
  itunes: { label: 'Apple Music', short: '', color: '#fa243c' },
  jamendo: { label: 'Jamendo', short: 'JM', color: '#00b39b' },
  youtube: { label: 'YouTube Music', short: 'YT', color: '#ff0000' },
  genius: { label: 'Genius', short: 'G', color: '#ffff64', ink: '#000' },
};

export function serviceInfo(id: string) {
  return SERVICES[id] ?? { label: id, short: id.slice(0, 2).toUpperCase(), color: '#777' };
}
