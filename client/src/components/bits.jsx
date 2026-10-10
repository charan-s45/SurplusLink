import { useState } from 'react';

const LABELS = {
  OPEN: 'Open',
  FULLY_CLAIMED: 'Fully claimed',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  ACTIVE: 'Active',
  COLLECTED: 'Collected',
  MISSED: 'Missed',
};

export function StatusTag({ status }) {
  return (
    <span className={`tag tag-${status.toLowerCase().replace('_', '-')}`}>
      <span className="tag-dot" aria-hidden="true" />
      {LABELS[status] ?? status}
    </span>
  );
}

export function Kg({ value, unit = true }) {
  return (
    <span className="num">
      {value}
      {unit && <span className="unit"> kg</span>}
    </span>
  );
}

/** Lists every reason the server gave for refusing a request. */
export function Reasons({ error, title }) {
  if (!error) return null;
  return (
    <div className="reasons" role="alert">
      <p className="reasons-title">{title ?? error.message}</p>
      <ul>
        {error.reasons.map((r) => (
          <li key={r.key + r.text}>
            {r.rule && <span className="rule-no">Rule {r.rule}</span>}
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Two-step button for destructive actions: click, then confirm inline. */
export function ConfirmButton({ children, confirmText, onConfirm, disabled, hint }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <button type="button" className="btn btn-line" disabled={disabled} title={hint} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }

  return (
    <span className="confirm" role="group" aria-label={confirmText}>
      <span className="confirm-q">{confirmText}</span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        autoFocus
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setAsking(false);
        }}
      >
        Yes
      </button>
      <button type="button" className="btn btn-line" onClick={() => setAsking(false)} disabled={busy}>
        No
      </button>
    </span>
  );
}

/** Thin bar showing how much of a donation is held by claims. */
export function Meter({ total, held }) {
  const pct = total > 0 ? Math.min(100, (held / total) * 100) : 0;
  return (
    <div className="meter" role="img" aria-label={`${held} of ${total} kg claimed`}>
      <div className="meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-text">{children}</p>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="loading" aria-busy="true">
      {label}
    </p>
  );
}
