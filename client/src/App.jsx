import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { usePreference, useResource } from './hooks.js';
import Header from './components/Header.jsx';
import { ToastProvider } from './components/Toasts.jsx';
import { Loading } from './components/bits.jsx';
import DonorDesk from './views/DonorDesk.jsx';
import VolunteerDesk from './views/VolunteerDesk.jsx';
import Ledger from './views/Ledger.jsx';

const BACKGROUND_REFRESH_MS = 8000;

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  // Bumping `version` makes every visible panel reload from the server.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const [view, setView] = usePreference('view', 'desk');
  const [personId, setPersonId] = usePreference('person', 'D1');

  const boot = useResource(() => api.bootstrap(), [version]);

  // Pick up changes made in another tab (e.g. a second volunteer claiming).
  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), BACKGROUND_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!boot.data) {
    return (
      <main className="page">
        {boot.error ? (
          <div className="fatal">
            <h1>Can’t reach the SurplusLink server</h1>
            <p>{boot.error.message}</p>
            <p className="hint">Start it with <code>npm run dev</code> from the project folder, then reload.</p>
            <button type="button" className="btn btn-solid" onClick={refresh}>Try again</button>
          </div>
        ) : (
          <Loading label="Loading SurplusLink…" />
        )}
      </main>
    );
  }

  const { clock, donors, volunteers } = boot.data;
  const donor = donors.find((d) => d.id === personId);
  const volunteer = volunteers.find((v) => v.id === personId);
  const person = donor ?? volunteer ?? donors[0];

  return (
    <>
      <Header
        view={view}
        onView={setView}
        donors={donors}
        volunteers={volunteers}
        personId={person.id}
        onPerson={(id) => {
          setPersonId(id);
          setView('desk');
        }}
        now={clock}
        onClockChanged={refresh}
      />
      <main className="page">
        {view === 'ledger' ? (
          <Ledger version={version} now={clock} />
        ) : volunteer ? (
          <VolunteerDesk key={volunteer.id} volunteer={volunteer} now={clock} version={version} onChanged={refresh} />
        ) : (
          <DonorDesk key={person.id} donor={person} now={clock} version={version} onChanged={refresh} />
        )}
      </main>
      <footer className="colophon">
        <span>Every figure is computed by the server from saved data, using the simulated clock.</span>
      </footer>
    </>
  );
}
