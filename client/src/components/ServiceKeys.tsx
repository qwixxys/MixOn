import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { ServiceKeyInfo } from '../api/types';
import { useFetch } from '../lib/useFetch';
import { toast } from '../store/toasts';
import { Icon } from './Icon';
import { Switch, TextField } from './Material';
import { ServiceIcon } from './ServiceBadge';
import { ErrorState, Loading } from './States';

const link = (href: string, text: string) => (
  <a className="link" href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

function CopyValue({ value }: { value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
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

interface Guide {
  title: string;
  what: string;
  steps: ReactNode[];
}

function guides(origin: string): Record<string, Guide> {
  return {
    soundcloud: {
      title: 'SoundCloud',
      what: 'Поиск авторов, их новые треки, полное прослушивание, плейлисты по ссылке, вход через SoundCloud для импорта лайков и подписок.',
      steps: [
        <>Откройте {link('https://soundcloud.com/you/apps', 'soundcloud.com/you/apps')} и зарегистрируйте приложение (Register a new application). SoundCloud может проверять заявки вручную.</>,
        <>
          В поле Redirect URI укажите этот адрес: <CopyValue value={`${origin}/api/services/soundcloud/oauth/callback`} />
        </>,
        <>Скопируйте Client ID и Client Secret в поля ниже. Входить через SoundCloud нужно с этого же адреса, то есть на этом компьютере.</>,
      ],
    },
    genius: {
      title: 'Genius',
      what: 'Авторы и продюсеры песен, описание, сэмплы и виджет с текстом, если текста нет в LRCLIB.',
      steps: [
        <>Откройте {link('https://genius.com/api-clients', 'genius.com/api-clients')} и войдите в аккаунт Genius.</>,
        <>Нажмите New API Client. Название любое, в App Website URL можно указать адрес этого сервера.</>,
        <>Нажмите Generate Access Token и вставьте Client Access Token ниже.</>,
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

function KeyGroup({ service, guide, keys, onSaved }: { service: string; guide: Guide; keys: ServiceKeyInfo[]; onSaved(list: ServiceKeyInfo[]): void }) {
  const textKeys = keys.filter((k) => !k.flag);
  const flagKey = keys.find((k) => k.flag);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = textKeys.filter((k) => k.source !== 'env');
  const saved = textKeys.some((k) => k.source === 'app');
  const ready = textKeys.every((k) => k.source);

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
    <form className="key-group" onSubmit={save}>
      <div className="key-group-head">
        <ServiceIcon id={service} size={40} />
        <div className="key-group-title">
          <h3>{guide.title}</h3>
          <span className="muted small">{guide.what}</span>
        </div>
        {ready ? (
          <span className="pill pill-good">
            <Icon name="check" size={16} /> Подключён
          </span>
        ) : (
          <span className="pill pill-warn">Нужны ключи</span>
        )}
      </div>
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
          supportingText={
            k.source === 'env' ? 'Задан в настройках сервера (.env)' : k.source === 'app' ? `Сохранён: ${k.preview}. Введите новый, чтобы заменить` : undefined
          }
          maxLength={500}
        />
      ))}
      {flagKey && (
        <Switch
          checked={flagKey.preview === 'on'}
          onChange={(on) => void send({ [flagKey.name]: on ? '1' : '0' }, on ? 'Режим без ключей включён' : 'Режим без ключей выключен')}
          label={flagKey.label}
          description="Если ключи получить не удалось: soundFy работает как веб-плеер soundcloud.com и действует, только пока ключи не заданы. SoundCloud не разрешает такое использование и может его заблокировать, а подписки на авторов в этом режиме могут не работать."
        />
      )}
      {editable.length > 0 && (
        <div className="form-actions">
          {saved && (
            <button
              type="button"
              className="btn btn-text"
              disabled={busy}
              onClick={() => void send(Object.fromEntries(editable.map((k) => [k.name, null])), `${guide.title}: ключи удалены`)}
            >
              <Icon name="delete" size={18} /> Удалить ключи
            </button>
          )}
          <button className="btn btn-filled" disabled={busy || !Object.values(values).some((v) => v.trim())}>
            Сохранить
          </button>
        </div>
      )}
    </form>
  );
}

/**
 * API keys for the services that need them, entered by the server's owner. They are stored on the server, apply at
 * once and are never shown again in full.
 */
export function ServiceKeys({ onSaved }: { onSaved(): void }) {
  const keys = useFetch<ServiceKeyInfo[]>('/settings/keys');
  const all = guides(location.origin);

  useEffect(() => {
    if (keys.data && location.hash === '#keys') document.getElementById('keys')?.scrollIntoView({ behavior: 'smooth' });
  }, [keys.data]);

  return (
    <section className="section" id="keys">
      <h2>Ключи сервисов</h2>
      <p className="muted">
        Эти сервисы работают только с вашими ключами API. Ключи хранятся на этом сервере, видны только вам как владельцу и сразу
        включают сервис, перезапуск не нужен. Deezer, Apple Music, LRCLIB и импорт по ссылке работают без ключей, а ВКонтакте
        каждый подключает своим токеном в карточке выше.
      </p>
      {keys.loading && !keys.data && <Loading />}
      {keys.error && <ErrorState message={keys.error} onRetry={keys.reload} />}
      {keys.data && (
        <div className="key-groups">
          {Object.entries(all).map(([service, guide]) => (
            <KeyGroup
              key={service}
              service={service}
              guide={guide}
              keys={keys.data!.filter((k) => k.service === service)}
              onSaved={(list) => {
                keys.setData(() => list);
                onSaved();
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
