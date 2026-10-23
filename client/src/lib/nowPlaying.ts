import { useLocation, useNavigate } from 'react-router';

type RouteState = { nowPlaying?: boolean } & Record<string, unknown>;

/**
 * Whether the full-screen player is open. Opening it adds a history entry on the same page, so the phone's back
 * button (and the browser's) closes it instead of leaving the page.
 */
export function useNowPlaying() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? null) as RouteState | null;
  const open = Boolean(state?.nowPlaying);
  const here = { pathname: location.pathname, search: location.search, hash: location.hash };
  return {
    open,
    show() {
      if (!open) navigate(here, { state: { ...state, nowPlaying: true } });
    },
    hide() {
      if (open) navigate(-1);
    },
    /** Drops the flag without a history step, for an entry restored after a reload with nothing playing. */
    forget() {
      if (open) navigate(here, { replace: true, state: { ...state, nowPlaying: undefined } });
    },
  };
}
