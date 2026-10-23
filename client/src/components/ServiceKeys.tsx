import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { ServiceKeyInfo } from '../api/types';
import { copyText } from '../lib/clipboard';
import { STANDALONE } from '../lib/standalone';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { Switch, TextField } from './Material';

const link = (href: string, text: string) => (
  <a className="link" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

function CopyValue({ value }: { value: string }) {
  const copy = async () => {
    try {
      await copyText(value);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать — выделите адрес вручную');
    }
  };
  return (
    <span className="copy-value">
      <code>{value}</code>
      <button type="button" className="icon-btn" onClick={copy} title="Скопировать">
        <Icon name="content_paste" size={18} />
      </button>
    </span>
  );
}

export interface Guide {
  title: string;
  what: string;
  steps: ReactNode[];
}

/** Where to get each service's keys, step by step. */
export function keyGuides(origin: string): Record<string, Guide> {
  return {
    soundcloud: {
      title: 'SoundCloud',
      what: 'Поиск авторов, их новые треки, полное прослушивание, плейлисты по ссылке, вход через SoundCloud для импорта лайков и подписок.',
      steps: [
        <>Откройте {link('https://soundcloud.com/you/apps', 'soundcloud.com/you/apps')} и зарегистрируйте приложение (Register a new application). SoundCloud может проверять заявки вручную.</>,
        STANDALONE ? (
          <>В поле Redirect URI можно указать любой адрес, например http://localhost/callback: на телефоне он не используется.</>
        ) : (
          <>
            В поле Redirect URI укажите этот адрес: <CopyValue value={`${origin}/api/services/soundcloud/oauth/callback`} />
          </>
        ),
        STANDALONE ? (
          <>Скопируйте Client ID и Client Secret в поля ниже.</>
        ) : (
          <>Скопируйте Client ID и Client Secret в поля ниже. Входить через SoundCloud нужно с этого же адреса, то есть на этом компьютере.</>
        ),
      ],
    },
    genius: {
      title: 'Genius',
      what: 'Авторы и продюсеры песен, описание, сэмплы и виджет с текстом, если текста нет в LRCLIB.',
      steps: [
        <>Откройте {link('https://genius.com/api-clients', 'genius.com/api-clients')} и войдите в аккаунт Genius.</>,
        <>Нажмите New API Client. Название любое, в App Website URL можно указать {STANDALONE ? 'любой сайт' : 'адрес этого сервера'}.</>,
        <>Нажмите Generate Access Token и вставьте Client Access Token ниже.</>,
        <>Без своего ключа работает встроенный ключ MixOn: он общий для всех, поэтому Genius иногда может ограничивать запросы.</>,
      ],
    },
    youtube: {
      title: 'YouTube Music',
      what: 'Релизы и клипы артистов с YouTube и YouTube Music, импорт плейлистов по ссылке. Видео играют во встроенном плеере YouTube.',
      steps: [
        <>
          Откройте {link('https://console.cloud.google.com/apis/library/youtube.googleapis.com', 'YouTube Data API v3 в Google Cloud')}, войдите в
          аккаунт Google, создайте проект (Create project) и нажмите Enable.
        </>,
        <>
          Откройте {link('https://console.cloud.google.com/apis/credentials', 'Credentials')} → Create credentials → <b>API key</b> (не OAuth client ID).
          Если спросят, какие данные нужны, выберите Public data. Ограничение по приложениям (Android apps и т. п.) не ставьте: с ним
          ключ не заработает. Вставьте ключ, он начинается с AIza, в поле ниже.
        </>,
        <>
          Ключ бесплатный. Его дневной квоты хватает примерно на 100 поисков артистов, а проверка новых релизов и импорт плейлистов
          почти её не тратят.
        </>,
      ],
    },
    jamendo: {
      title: 'Jamendo',
      what: 'Полные треки независимых артистов под лицензией Creative Commons.',
      steps: [
        <>Зарегистрируйтесь на {link('https://devportal.jamendo.com', 'devportal.jamendo.com')}.</>,
        <>Создайте приложение в разделе My Applications и вставьте его Client ID ниже.</>,
      ],
    },
  };
}

const KEYLESS_NOTE = 'Действует, только пока свои ключи не заданы. Подписки на авторов в этом режиме могут не работать.';

/** The keyless-mode switch (SoundCloud), shown in the card itself since it is on by default. */
export function KeyFlag({ flag, onSaved }: { flag: ServiceKeyInfo; onSaved(list: ServiceKeyInfo[]): void }) {
  const [busy, setBusy] = useState(false);
  const set = async (on: boolean) => {
    setBusy(true);
    try {
      onSaved(await api<ServiceKeyInfo[]>('/settings/keys', { method: 'PUT', body: { values: { [flag.name]: on ? '1' : '0' } } }));
      toast.success(on ? 'Режим без ключей включён' : 'Режим без ключей выключен');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Switch
      checked={flag.preview === 'on'}
      disabled={busy || flag.source === 'env'}
      onChange={(on) => void set(on)}
      label={flag.label}
      description={flag.source === 'env' ? `${KEYLESS_NOTE} Задан в настройках сервера (.env).` : KEYLESS_NOTE}
    />
  );
}

function keySupportingText(k: ServiceKeyInfo) {
  switch (k.source) {
    case 'env':
      return 'Задан в настройках сервера (.env)';
    case 'app':
      return `Сохранён: ${k.preview}. Введите новый, чтобы заменить`;
    case 'builtin':
      return 'Используется встроенный ключ MixOn — можно указать свой';
    default:
      return undefined;
  }
}

/**
 * A service's API keys inside its card, for the server's owner: where to get them, the fields, save and delete. The
 * keys are stored on the server (on the phone in the standalone app), apply at once and are never shown again in full.
 * Folded away once the keys are in.
 */
export function KeyForm({
  guide,
  keys,
  onSaved,
  optional = false,
}: {
  guide: Guide;
  keys: ServiceKeyInfo[];
  onSaved(list: ServiceKeyInfo[]): void;
  /** The service already works without these keys (SoundCloud in keyless mode). */
  optional?: boolean;
}) {
  const textKeys = keys.filter((k) => !k.flag);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!textKeys.length) return null;
  const editable = textKeys.filter((k) => k.source !== 'env');
  const saved = textKeys.some((k) => k.source === 'app');
  const ready = textKeys.every((k) => k.source);
  const builtIn = textKeys.some((k) => k.source === 'builtin');

  const send = async (body: Record<string, string | null>, message: string) => {
    setBusy(true);
    try {
      onSaved(await api<ServiceKeyInfo[]>('/settings/keys', { method: 'PUT', body: { values: body } }));
      setValues({});
      toast.success(message);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (Object.keys(changed).length) void send(changed, `${guide.title}: ключи сохранены`);
  };

  return (
    <details className="key-form" open={!ready && !optional}>
      <summary>
        <Icon name="key" size={18} />
        <span className="key-form-title">Ключи API</span>
        {builtIn ? (
          <span className="pill">Встроенный</span>
        ) : ready ? (
          <span className="pill pill-good">
            <Icon name="check" size={16} /> Указаны
          </span>
        ) : optional ? (
          <span className="pill">Необязательно</span>
        ) : (
          <span className="pill pill-warn">Нужны</span>
        )}
        <Icon name="keyboard_arrow_down" size={20} className="key-form-chevron" />
      </summary>
      <form className="stack" onSubmit={save}>
        <ol className="key-steps">
          {guide.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {textKeys.map((k) => (
          <TextField
            key={k.name}
            label={k.label}
            type={k.secret ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            value={values[k.name] ?? ''}
            onChange={(e) => setValues({ ...values, [k.name]: e.target.value })}
            disabled={k.source === 'env' || busy}
            supportingText={keySupportingText(k)}
            maxLength={500}
          />
        ))}
        {editable.length > 0 && (
          <div className="form-actions">
            {saved && (
              <button
                type="button"
                className="btn btn-text"
                disabled={busy}
                onClick={() =>
                  void send(Object.fromEntries(editable.map((k) => [k.name, null])), builtIn ? `${guide.title}: снова встроенный ключ` : `${guide.title}: ключи удалены`)
                }
              >
                <Icon name="delete" size={18} /> Удалить {editable.length > 1 ? 'ключи' : 'ключ'}
              </button>
            )}
            <button className="btn btn-filled" disabled={busy || !Object.values(values).some((v) => v.trim())}>
              Сохранить
            </button>
          </div>
        )}
      </form>
    </details>
  );
}
