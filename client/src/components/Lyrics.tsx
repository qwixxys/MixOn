import { useEffect, useRef } from 'react';
import type { LyricLine, Track, TrackGenius, TrackLyrics } from '../api/types';
import { usePlayer } from '../store/player';
import { GeniusLyrics } from './Genius';
import { Icon } from './Icon';
import { Empty, ErrorState, Loading } from './States';

/** Lines are shown a moment early so they light up as the words start, not after. */
const LEAD_SECONDS = 0.3;
/** After the listener scrolls the lyrics themselves, follow the song again only after this pause. */
const MANUAL_SCROLL_PAUSE_MS = 4000;

/** Index of the line being sung at `time`, or -1 before the first one. */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time + LEAD_SECONDS) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Time-synced lyrics that follow playback: the current line is highlighted and kept in view, and clicking a line
 * jumps there. A 30-second preview starts mid-song, so its lines are shown without following along.
 */
function SyncedLyrics({ track, lines }: { track: Track; lines: LyricLine[] }) {
  const follow = !track.isPreview;
  const time = usePlayer((s) => (follow && s.current?.id === track.id ? s.currentTime : null));
  const play = usePlayer((s) => s.play);
  const box = useRef<HTMLDivElement>(null);
  const manualScrollAt = useRef(0);
  const active = time === null ? -1 : activeLine(lines, time);

  useEffect(() => {
    const container = box.current;
    const line = container?.children[active] as HTMLElement | undefined;
    if (!container || !line || Date.now() - manualScrollAt.current < MANUAL_SCROLL_PAUSE_MS) return;
    // Scroll only the lyrics box, never the page.
    container.scrollTo({ top: line.offsetTop - container.clientHeight / 2 + line.offsetHeight / 2, behavior: 'smooth' });
  }, [active]);

  const userScrolled = () => (manualScrollAt.current = Date.now());

  return (
    <div
      ref={box}
      className={`synced-lyrics${follow ? '' : ' synced-lyrics-static'}`}
      onWheel={userScrolled}
      onTouchMove={userScrolled}
      aria-live="off"
    >
      {lines.map((line, i) => {
        const state = i === active ? ' active' : i < active ? ' past' : '';
        const text = line.text || '♪';
        return follow ? (
          <button
            key={i}
            className={`lyric-line${state}`}
            aria-current={i === active ? 'true' : undefined}
            onClick={() => play(track, undefined, line.time)}
          >
            {text}
          </button>
        ) : (
          <p key={i} className="lyric-line">
            {text}
          </p>
        );
      })}
    </div>
  );
}

interface LyricsTabProps {
  track: Track;
  lyrics: { data: TrackLyrics | null; loading: boolean; error: string | null; reload(): void };
  genius: TrackGenius | null;
  geniusLoading: boolean;
  onFindOnGenius(): void;
}

/** The "Текст" tab: synced or plain lyrics from LRCLIB, falling back to the Genius widget. */
export function LyricsTab({ track, lyrics, genius, geniusLoading, onFindOnGenius }: LyricsTabProps) {
  const found = lyrics.data?.found ? lyrics.data : null;
  const song = genius?.song ?? null;

  if (lyrics.loading || (!found && geniusLoading)) return <Loading label="Ищем текст песни…" />;

  if (found?.instrumental) {
    return (
      <Empty icon={<Icon name="graphic_eq" size={32} />} title="Инструментальный трек">
        В этой композиции нет слов.
      </Empty>
    );
  }

  if (found && (found.synced?.length || found.plain)) {
    return (
      <section className="lyrics">
        {found.synced?.length ? (
          <SyncedLyrics track={track} lines={found.synced} />
        ) : (
          <div className="plain-lyrics">{found.plain}</div>
        )}
        {track.isPreview && found.synced?.length ? (
          <span className="muted small">Это 30-секундный фрагмент из середины песни, поэтому строки не подсвечиваются.</span>
        ) : null}
        <div className="lyrics-footer">
          <span className="muted small">
            {found.synced?.length ? 'Синхронизированный текст' : 'Текст'} из открытой базы{' '}
            <a className="link" href="https://lrclib.net" target="_blank" rel="noreferrer">
              LRCLIB
            </a>
            .
          </span>
          {song && (
            <a className="btn btn-text btn-small" href={song.url} target="_blank" rel="noreferrer">
              <Icon name="open_in_new" size={18} /> Открыть на Genius
            </a>
          )}
        </div>
      </section>
    );
  }

  if (song) return <GeniusLyrics key={song.id} song={song} />;

  if (lyrics.error) return <ErrorState message={lyrics.error} onRetry={lyrics.reload} />;

  const lrclib = Boolean(lyrics.data?.enabled);
  const geniusOn = Boolean(genius?.configured);
  const message =
    lrclib && geniusOn
      ? 'Ни в LRCLIB, ни на Genius нет текста этой песни.'
      : lrclib
        ? 'В LRCLIB нет текста этой песни.'
        : geniusOn
          ? 'На Genius не нашлось этой песни.'
          : 'Поиск текстов отключён на сервере.';
  return (
    <Empty icon={<Icon name="lyrics" size={32} />} title="Текст не найден">
      {message}
      {genius?.configured && genius.canEdit && (
        <div className="row-gap">
          <button className="btn btn-filled" onClick={onFindOnGenius}>
            <Icon name="travel_explore" size={18} /> Найти на Genius вручную
          </button>
        </div>
      )}
    </Empty>
  );
}
