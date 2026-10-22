import { Check, Moon, Pipette, Sun, SunMoon } from 'lucide-react';
import { useMemo } from 'react';
import { buildScheme, roleHex, type SchemeVariant } from '../theme/scheme';
import { activeSeed, useTheme, type ThemeMode } from '../theme/store';
import { SegmentedButtons, Switch } from './Material';
import { Modal } from './Modal';

const PRESETS = [
  { hex: '#ff5500', name: 'Оранжевый (SoundCloud)' },
  { hex: '#6750a4', name: 'Фиолетовый (Material)' },
  { hex: '#0077ff', name: 'Синий (VK)' },
  { hex: '#1db954', name: 'Зелёный' },
  { hex: '#00897b', name: 'Бирюзовый' },
  { hex: '#e91e63', name: 'Розовый' },
  { hex: '#d32f2f', name: 'Красный' },
  { hex: '#f9a825', name: 'Жёлтый' },
  { hex: '#455a64', name: 'Сине-серый' },
];

const VARIANTS: { id: SchemeVariant; label: string }[] = [
  { id: 'vibrant', label: 'Яркая' },
  { id: 'tonalSpot', label: 'Спокойная' },
  { id: 'expressive', label: 'Выразительная' },
  { id: 'fidelity', label: 'Точная' },
  { id: 'content', label: 'По цвету' },
  { id: 'rainbow', label: 'Радуга' },
  { id: 'fruitSalad', label: 'Фруктовый салат' },
  { id: 'neutral', label: 'Нейтральная' },
  { id: 'monochrome', label: 'Монохром' },
];

const CONTRAST = [
  { id: '0', label: 'Обычный' },
  { id: '0.5', label: 'Средний' },
  { id: '1', label: 'Высокий' },
];

/** Preview of the palette a seed would produce: primary on top, secondary and tertiary below. */
function SwatchDial({ hex }: { hex: string }) {
  const variant = useTheme((s) => s.variant);
  const isDark = useTheme((s) => s.isDark);
  const colors = useMemo(() => {
    const scheme = buildScheme(hex, variant, isDark, 0);
    return [roleHex(scheme, 'primary'), roleHex(scheme, 'secondary'), roleHex(scheme, 'tertiary')];
  }, [hex, variant, isDark]);
  return (
    <span className="swatch-dial">
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

export function AppearanceDialog({ onClose }: { onClose(): void }) {
  const theme = useTheme();
  const seed = activeSeed(theme);
  const custom = !PRESETS.some((p) => p.hex === theme.seed);

  return (
    <Modal title="Оформление" onClose={onClose}>
      <div className="appearance">
        <section>
          <h3>Тема</h3>
          <SegmentedButtons<ThemeMode>
            block
            label="Тема"
            value={theme.mode}
            onChange={(mode) => theme.update({ mode })}
            options={[
              { id: 'light', label: 'Светлая', icon: <Sun size={18} /> },
              { id: 'system', label: 'Авто', icon: <SunMoon size={18} /> },
              { id: 'dark', label: 'Тёмная', icon: <Moon size={18} /> },
            ]}
          />
        </section>

        <section>
          <h3>Основной цвет</h3>
          <div className="swatches" style={theme.fromCover ? { opacity: 0.5 } : undefined}>
            {PRESETS.map((p) => {
              const selected = !theme.fromCover && theme.seed === p.hex;
              return (
                <button
                  key={p.hex}
                  className={`swatch ${selected ? 'swatch-selected' : ''}`}
                  onClick={() => theme.update({ seed: p.hex, fromCover: false })}
                  aria-label={p.name}
                  aria-pressed={selected}
                  title={p.name}
                >
                  <SwatchDial hex={p.hex} />
                  {selected && (
                    <span className="swatch-check">
                      <Check size={20} />
                    </span>
                  )}
                </button>
              );
            })}
            <label
              className={`swatch swatch-custom ${custom && !theme.fromCover ? 'swatch-selected' : ''}`}
              title="Свой цвет"
              aria-label="Свой цвет"
            >
              {custom ? <SwatchDial hex={theme.seed} /> : <Pipette size={22} />}
              <input type="color" value={theme.seed} onChange={(e) => theme.update({ seed: e.target.value, fromCover: false })} />
            </label>
          </div>
        </section>

        <Switch
          checked={theme.fromCover}
          onChange={(fromCover) => theme.update({ fromCover })}
          label="Цвета из обложки"
          description={
            theme.fromCover && theme.coverSeed
              ? `Сейчас: ${seed.toUpperCase()} — из обложки играющего трека`
              : 'Палитра подстраивается под обложку играющего трека, как Material You под обои'
          }
        />

        <section>
          <h3>Стиль палитры</h3>
          <div className="chips" style={{ marginBottom: 0 }}>
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                className={`chip ${theme.variant === v.id ? 'chip-selected' : ''}`}
                aria-pressed={theme.variant === v.id}
                onClick={() => theme.update({ variant: v.id })}
              >
                {theme.variant === v.id && <Check size={18} />}
                {v.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Контрастность</h3>
          <SegmentedButtons
            block
            label="Контрастность"
            value={String(theme.contrast)}
            onChange={(c) => theme.update({ contrast: Number(c) })}
            options={CONTRAST}
          />
        </section>

        <div className="form-actions">
          <button className="btn btn-text" onClick={theme.reset}>
            Сбросить
          </button>
          <button className="btn btn-filled" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </Modal>
  );
}
