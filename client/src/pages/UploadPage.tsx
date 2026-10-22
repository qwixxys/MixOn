import { ImagePlus, LoaderCircle, Music, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { uploadWithProgress } from '../api/client';
import type { Track } from '../api/types';
import { LinearProgress, TextArea, TextField } from '../components/Material';
import { Waveform } from '../components/Waveform';
import { formatTime } from '../lib/format';
import { analyseAudio } from '../lib/waveform';
import { useAuth } from '../store/auth';
import { toast } from '../store/toasts';

export const GENRES = [
  'Hip-Hop',
  'Rap',
  'Pop',
  'Rock',
  'Indie',
  'Electronic',
  'House',
  'Techno',
  'Drum & Bass',
  'Ambient',
  'Lo-Fi',
  'Jazz',
  'R&B',
  'Metal',
  'Phonk',
  'Classical',
  'Folk',
  'Шансон',
];

const MAX_MB = 100;

export function UploadPage() {
  const user = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{ peaks: number[]; duration: number } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [form, setForm] = useState({ title: '', artist: user.displayName, genre: '', description: '' });
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!cover) return setCoverPreview(null);
    const url = URL.createObjectURL(cover);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name)) {
      return toast.error('Выберите аудиофайл: MP3, M4A, OGG, WAV, FLAC…');
    }
    if (f.size > MAX_MB * 1024 * 1024) return toast.error(`Файл больше ${MAX_MB} МБ`);
    setFile(f);
    setAnalysis(null);
    setForm((prev) => ({ ...prev, title: prev.title || f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ') }));
    setAnalysing(true);
    try {
      setAnalysis(await analyseAudio(f));
    } catch {
      // The server can still read the file; the waveform will be generated.
    } finally {
      setAnalysing(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const data = new FormData();
    data.append('audio', file);
    if (cover) data.append('cover', cover);
    for (const [k, v] of Object.entries(form)) data.append(k, v.trim());
    if (analysis) {
      data.append('waveform', JSON.stringify(analysis.peaks));
      data.append('duration', String(analysis.duration));
    }
    setProgress(0);
    try {
      const track = await uploadWithProgress<Track>('/tracks', data, setProgress);
      toast.success('Трек опубликован');
      navigate(`/tracks/${track.id}`);
    } catch (err) {
      toast.error(err);
      setProgress(null);
    }
  };

  if (!file) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Загрузить трек</h1>
        </div>
        <div
          className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void pickFile(e.dataTransfer.files[0]);
          }}
          onClick={() => fileInput.current?.click()}
        >
          <span className="dropzone-icon">
            <UploadCloud size={44} />
          </span>
          <h2>Перетащите аудиофайл сюда</h2>
          <p className="muted">MP3, M4A, AAC, OGG, OPUS, WAV или FLAC до {MAX_MB} МБ</p>
          <button type="button" className="btn btn-filled">
            Выбрать файл
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac"
            hidden
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
        </div>
      </div>
    );
  }

  const uploading = progress !== null;
  return (
    <div className="page">
      <div className="page-header">
        <h1>Загрузить трек</h1>
      </div>
      <form className="upload-form" onSubmit={submit}>
        <div className="upload-file">
          <Music size={20} />
          <span className="upload-file-name">{file.name}</span>
          <span className="muted small">
            {(file.size / 1024 / 1024).toFixed(1)} МБ{analysis && ` · ${formatTime(analysis.duration)}`}
          </span>
          {!uploading && (
            <button type="button" className="icon-btn" onClick={() => setFile(null)} aria-label="Выбрать другой файл">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="upload-waveform">
          {analysing ? (
            <span className="muted">
              <LoaderCircle size={16} className="spin" /> Анализируем звук…
            </span>
          ) : analysis ? (
            <Waveform peaks={analysis.peaks} progress={progress ?? 0} height={70} />
          ) : (
            <span className="muted small">Не удалось прочитать файл в браузере — волна будет сгенерирована автоматически.</span>
          )}
        </div>

        <div className="upload-grid">
          <label className="cover-picker" style={coverPreview ? { backgroundImage: `url(${coverPreview})` } : undefined}>
            {!coverPreview && (
              <>
                <ImagePlus size={32} />
                <span className="title-medium">Обложка</span>
                <span className="muted small">Если не выбрать — возьмём из тегов файла</span>
              </>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
          </label>

          <div className="upload-fields">
            <TextField label="Название" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
            <TextField label="Исполнитель" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} maxLength={200} />
            <TextField
              label="Жанр"
              list="genres"
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
              maxLength={50}
              supportingText="Начните вводить или выберите из списка"
            />
            <datalist id="genres">
              {GENRES.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <TextArea
              label="Описание"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={5000}
              hint="Расскажите о треке"
            />
          </div>
        </div>

        {uploading && (
          <div>
            <LinearProgress value={progress ?? 0} />
            <div className="progress-label small">
              {progress! < 1 ? `Загрузка ${Math.round(progress! * 100)}%` : 'Обработка…'}
            </div>
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-filled btn-large" disabled={uploading || !form.title.trim()}>
            {uploading ? 'Загружаем…' : 'Опубликовать'}
          </button>
        </div>
      </form>
    </div>
  );
}
