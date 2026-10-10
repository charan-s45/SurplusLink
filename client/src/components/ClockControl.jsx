import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { addMinutes, formatDay, formatTime } from '../time.js';
import { Reasons } from './bits.jsx';
import { useNotify } from './Toasts.jsx';

const STEPS = [
  { label: '+15m', minutes: 15 },
  { label: '+1h', minutes: 60 },
  { label: '+3h', minutes: 180 },
  { label: '+1d', minutes: 1440 },
];

export default function ClockControl({ now, onChanged }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(now);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const notify = useNotify();
  const panel = useRef(null);

  useEffect(() => {
    if (open) setTarget(now);
    setError(null);
  }, [open, now]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => panel.current && !panel.current.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  async function apply(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.setClock(target);
      const missed = result.claims_marked_missed;
      notify('ok', `Clock set to ${formatDay(result.now)}, ${formatTime(result.now)}`, missed ? [`${missed} overdue claim${missed === 1 ? '' : 's'} marked missed`] : []);
      setOpen(false);
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="clock" ref={panel}>
      <button
        type="button"
        className="clock-face"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="clock-panel"
        title="Simulated time. Click to move it forward."
      >
        <span className="clock-label">Simulated time</span>
        <span className="clock-value">
          <span className="clock-day">{formatDay(now)}</span>
          <span className="clock-time">{formatTime(now)}</span>
        </span>
      </button>

      {open && (
        <form id="clock-panel" className="clock-panel" onSubmit={apply} noValidate>
          <label className="field">
            <span className="field-label">Move the clock to</span>
            <input
              type="datetime-local"
              value={target}
              min={now}
              step="60"
              required
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <div className="clock-steps" role="group" aria-label="Quick steps">
            {STEPS.map((s) => (
              <button key={s.label} type="button" className="chip-btn" onClick={() => setTarget(addMinutes(target || now, s.minutes))}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="hint">The clock only moves forward. Active claims on donations whose window has closed become missed.</p>
          <Reasons error={error} />
          <div className="row-end">
            <button type="button" className="btn btn-line" onClick={() => setOpen(false)}>
              Close
            </button>
            <button type="submit" className="btn btn-solid" disabled={busy}>
              {busy ? 'Setting…' : 'Set clock'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
