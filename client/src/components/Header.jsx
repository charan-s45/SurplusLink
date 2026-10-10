import ClockControl from './ClockControl.jsx';

export default function Header({ view, onView, donors, volunteers, personId, onPerson, now, onClockChanged }) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); onView('desk'); }}>
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M3 16a13 13 0 0 0 26 0z" className="brand-fill" />
          </svg>
          <span className="brand-name">SurplusLink</span>
        </a>

        <nav className="tabs" aria-label="Sections">
          <button type="button" className={view === 'desk' ? 'tab is-active' : 'tab'} aria-current={view === 'desk' ? 'page' : undefined} onClick={() => onView('desk')}>
            Desk
          </button>
          <button type="button" className={view === 'ledger' ? 'tab is-active' : 'tab'} aria-current={view === 'ledger' ? 'page' : undefined} onClick={() => onView('ledger')}>
            Ledger
          </button>
        </nav>

        <label className="acting">
          <span className="acting-label">Acting as</span>
          <select value={personId} onChange={(e) => onPerson(e.target.value)}>
            <optgroup label="Restaurants">
              {donors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.zone}
                </option>
              ))}
            </optgroup>
            <optgroup label="Volunteers">
              {volunteers.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.capacity_kg} kg
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <ClockControl now={now} onChanged={onClockChanged} />
      </div>
    </header>
  );
}
