import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Header } from './components/Header';
import { PlayerBar } from './components/PlayerBar';
import { PlaylistPicker } from './components/PlaylistPicker';
import { Loading } from './components/States';
import { Toaster } from './components/Toaster';
import { ArtistPage } from './pages/ArtistPage';
import { AuthPage } from './pages/AuthPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaylistPage } from './pages/PlaylistPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { SyncPage } from './pages/SyncPage';
import { TrackPage } from './pages/TrackPage';
import { UploadPage } from './pages/UploadPage';
import { usePlayer } from './store/player';
import { useAuth } from './store/auth';

/** Sends guests to the login page, then back where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function App() {
  const ready = useAuth((s) => s.ready);
  const init = useAuth((s) => s.init);
  const hasPlayer = usePlayer((s) => Boolean(s.current));
  const { pathname } = useLocation();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={`app ${hasPlayer ? 'has-player' : ''}`}>
      <Header />
      <main className="main">
        {!ready ? (
          <Loading />
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/tracks/:id" element={<TrackPage />} />
            <Route path="/users/:username" element={<ProfilePage />} />
            <Route path="/playlists/:id" element={<PlaylistPage />} />
            <Route path="/artists/:id" element={<ArtistPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route
              path="/upload"
              element={
                <RequireAuth>
                  <UploadPage />
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <LibraryPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>
      <PlayerBar />
      <PlaylistPicker />
      <Toaster />
    </div>
  );
}
