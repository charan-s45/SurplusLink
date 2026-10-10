import { useEffect, useState } from 'react';

/**
 * Loads data with `load()` whenever a dependency changes. Previous data stays
 * on screen while a refresh is in flight, so background refreshes don't flicker.
 */
export function useResource(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    load()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/** localStorage for small UI preferences only (who you are acting as, which tab). */
export function usePreference(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(`surpluslink.${key}`) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(`surpluslink.${key}`, value);
    } catch {
      // storage unavailable; the preference just won't be remembered
    }
  }, [key, value]);

  return [value, setValue];
}
