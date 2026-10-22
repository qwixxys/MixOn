import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { GeniusPerson, GeniusSong, GeniusSongRef, Track, TrackGenius } from '../api/types';
import { formatCount } from '../lib/format';
import { toast } from '../store/toasts';
import { Avatar, Cover } from './Cover';
import { Icon } from './Icon';
import { TextField } from './Material';
import { Modal } from './Modal';
import { Empty, Loading } from './States';

export function GeniusBadge() {
  return <span className="genius-badge">Genius</span>;
}

function PersonChips({ people }: { people: GeniusPerson[] }) {
  return (
    <span className="person-chips">
      {people.map((p) =>
        p.url ? (
          <a key={p.id} className="person-chip" href={p.url} target="_blank" rel="noreferrer">
            <Avatar url={p.imageUrl} name={p.name} size={24} />
            {p.name}
          </a>
        ) : (
          <span key={p.id} className="person-chip">
            <Avatar url={p.imageUrl} name={p.name} size={24} />
            {p.name}
          </span>
        ),
      )}
    </span>
  );
}

/** Extra rows for the track facts list: who wrote and produced the song. */
export function GeniusFacts({ song, track }: { song: GeniusSong; track: Track }) {
  return (
    <>
      {song.writers.length > 0 && (
        <>
          <dt>Авторы</dt>
          <dd>
            <PersonChips people={song.writers} />
          </dd>
        </>
      )}
      {song.producers.length > 0 && (
        <>
          <dt>Продюсеры</dt>
          <dd>
            <PersonChips people={song.producers} />
          </dd>
        </>
      )}
      {song.featured.length > 0 && (
        <>
          <dt>При участии</dt>
          <dd>
            <PersonChips people={song.featured} />
          </dd>
        </>
      )}
      {!track.album && song.album && (
        <>
          <dt>Альбом</dt>
          <dd>{song.album.url ? <a className="link" href={song.album.url} target="_blank" rel="noreferrer">{song.album.name}</a> : song.album.name}</dd>
        </>
      )}
      {song.releaseDate && (
        <>
          <dt>Дата выхода</dt>
          <dd>{song.releaseDate}</dd>
        </>
      )}
    </>
  );
}

/**
 * Lyrics through Genius's official embed widget. The Genius API does not hand out lyrics text;
 * the widget is loaded from genius.com by the listener's browser inside a sandboxed frame
 * (no access to soundFy's origin) that reports its height so the page can size it.
 */
export function GeniusLyrics({ song }: { song: GeniusSong }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'soundfy-embed-height') return;
      setHeight(Math.min(Math.max(Number(e.data.height) || 0, 120), 6000));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const srcDoc = useMemo(
    () =>
      song.embedContent
        ? `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>html,body{margin:0;padding:8px 4px;background:#fff;color:#1d1d1d;font:16px/1.6 Roboto,system-ui,sans-serif}</style></head>
<body>${song.embedContent}
<script>
  // The body's own height, not scrollHeight, which never drops below the frame's current height.
  var post = function () { parent.postMessage({ type: 'soundfy-embed-height', height: Math.ceil(document.body.getBoundingClientRect().height) }, '*'); };
  new ResizeObserver(post).observe(document.body);
  window.addEventListener('load', post);
  post();
</script></body></html>`
        : null,
    [song.embedContent],
  );

  return (
    <section className="lyrics">
      {srcDoc ? (
        <iframe
          ref={frame}
          className="lyrics-frame"
          title={`Текст песни «${song.title}» на Genius`}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          style={{ height: height ?? 320 }}
        />
      ) : (
        <Empty icon={<Icon name="lyrics" size={32} />} title="Виджет с текстом недоступен">
          Genius не предоставил виджет для этой песни.
        </Empty>
      )}
      <div className="lyrics-footer">
        <span className="muted small">
          Текст показывается официальным виджетом <GeniusBadge /> и загружается с genius.com.
          {height !== null && height < 160 && ' Если он не появился, откройте песню на сайте.'}
        </span>
        <a className="btn btn-tonal btn-small" href={song.url} target="_blank" rel="noreferrer">
          <Icon name="open_in_new" size={18} /> Открыть на Genius
        </a>
      </div>
    </section>
  );
}

function SongRow({ song }: { song: GeniusSongRef }) {
  return (
    <a className="genius-song-row" href={song.url} target="_blank" rel="noreferrer">
      <Cover url={song.imageUrl} seed={`g${song.id}`} size={40} />
      <span className="genius-song-row-main">
        <span className="strong">{song.title}</span>
        <span className="muted small">
          {song.artist}
          {song.releaseDate && ` · ${song.releaseDate}`}
        </span>
      </span>
      <Icon name="open_in_new" size={18} />
    </a>
  );
}

const MEDIA_LABELS: Record<string, string> = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud', apple_music: 'Apple Music' };
const DESCRIPTION_PREVIEW = 600;

/** "About the song": description, full credits, samples/covers/remixes and links, from Genius. */
export function GeniusAbout({ song }: { song: GeniusSong }) {
  const [expanded, setExpanded] = useState(false);
  const long = (song.description?.length ?? 0) > DESCRIPTION_PREVIEW;
  const description = song.description && (expanded || !long ? song.description : `${song.description.slice(0, DESCRIPTION_PREVIEW)}…`);
  const credits = [
    { label: 'Исполнитель', people: [song.primaryArtist] },
    { label: 'При участии', people: song.featured },
    { label: 'Авторы', people: song.writers },
    { label: 'Продюсеры', people: song.producers },
    ...song.credits,
  ].filter((c) => c.people.length);

  return (
    <section className="genius-about">
      <div className="genius-header">
        <Cover url={song.album?.coverUrl ?? song.imageUrl} seed={`g${song.id}`} size={72} />
        <div className="genius-header-main">
          <a className="title-medium link-plain" href={song.url} target="_blank" rel="noreferrer">
            {song.fullTitle}
          </a>
          <span className="muted small">
            {[song.album?.name, song.releaseDate, song.recordingLocation].filter(Boolean).join(' · ')}
            {song.pageviews ? ` · ${formatCount(song.pageviews)} просмотров на Genius` : ''}
          </span>
        </div>
        <GeniusBadge />
      </div>

      {description && (
        <div className="genius-block">
          <h3>О песне</h3>
          <p className="description">{description}</p>
          {long && (
            <button className="btn btn-text btn-small" onClick={() => setExpanded(!expanded)}>
              <Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={18} />
              {expanded ? 'Свернуть' : 'Читать полностью'}
            </button>
          )}
        </div>
      )}

      <div className="genius-block">
        <h3>Кто сделал песню</h3>
        <dl className="facts">
          {credits.map((c) => (
            <Fragment key={c.label}>
              <dt>{c.label}</dt>
              <dd>
                <PersonChips people={c.people} />
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>

      {song.relationships.map((r) => (
        <div key={r.type} className="genius-block">
          <h3>{r.label}</h3>
          {r.songs.map((s) => (
            <SongRow key={s.id} song={s} />
          ))}
        </div>
      ))}

      {song.media.length > 0 && (
        <div className="genius-block">
          <h3>Слушать и смотреть</h3>
          <div className="row-gap">
            {song.media.map((m) => (
              <a key={m.url} className="btn btn-tonal btn-small" href={m.url} target="_blank" rel="noreferrer">
                <Icon name="open_in_new" size={18} /> {MEDIA_LABELS[m.provider] ?? m.provider}
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Lets a listener pick the right Genius song when the automatic match failed or was wrong. */
export function GeniusLinkDialog({ track, onClose, onLinked }: { track: Track; onClose(): void; onLinked(g: TrackGenius): void }) {
  const [q, setQ] = useState(`${track.artist} ${track.title}`);
  const [results, setResults] = useState<GeniusSongRef[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await api<GeniusSongRef[]>(`/genius/search?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void search();
    // Search once with the track's own name when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = async (geniusId: number | null) => {
    setBusy(true);
    try {
      onLinked(await api<TrackGenius>(`/tracks/${track.id}/genius`, { method: 'PUT', body: { geniusId } }));
      toast.success(geniusId ? 'Песня с Genius привязана' : 'Отмечено: песни на Genius нет');
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Найти песню на Genius" onClose={onClose}>
      <form className="stack" onSubmit={search}>
        <TextField label="Исполнитель и название" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} />
        <div className="form-actions">
          <button className="btn btn-tonal" disabled={busy || !q.trim()}>
            <Icon name="search" size={18} /> Искать
          </button>
        </div>
      </form>
      {busy && !results && <Loading label="Ищем на Genius…" />}
      {results && !results.length && <Empty title="Ничего не нашлось">Попробуйте другое написание.</Empty>}
      <div className="picker-list">
        {results?.map((s) => (
          <div key={s.id} className="picker-item">
            <Cover url={s.imageUrl} seed={`g${s.id}`} size={48} />
            <div className="picker-item-main">
              <span className="strong">{s.title}</span>
              <span className="muted small">
                {s.artist}
                {s.releaseDate && ` · ${s.releaseDate}`}
              </span>
            </div>
            <button className="btn btn-outlined btn-small" disabled={busy} onClick={() => link(s.id)}>
              Выбрать
            </button>
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button className="btn btn-text" disabled={busy} onClick={() => link(null)}>
          <Icon name="link_off" size={18} /> Этой песни нет на Genius
        </button>
      </div>
    </Modal>
  );
}
