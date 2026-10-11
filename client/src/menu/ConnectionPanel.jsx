import { useState } from 'react';

export function savedClientAddress() {
  try { return localStorage.getItem('aerodance-client-ip') || '192.168.43.1'; }
  catch { return '192.168.43.1'; }
}

export default function ConnectionPanel({ source, connection, inputMode, onInputModeChange }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState(savedClientAddress);
  const [error, setError] = useState('');
  const active = ['connecting', 'connected', 'reconnecting'].includes(connection.status);
  return (
    <aside className="connection-panel" aria-label="Client connection">
      {open && (
        <form className="glass-panel connection-form" onSubmit={e => {
          e.preventDefault();
          if (inputMode === 'webcam') { setOpen(false); return; }
          try { source.connect(address); setError(''); }
          catch (err) { setError(err.message); }
        }}>
          <div className="panel-heading"><strong>Connect Client</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close connection panel">×</button></div>
          <label htmlFor="client-type">Client type</label>
          <select id="client-type" value={inputMode} onChange={e => { setError(''); onInputModeChange(e.target.value); }}>
            <option value="android">Android Client</option>
            <option value="webcam">Webcam (dummy)</option>
          </select>
          {inputMode === 'android' ? <>
            <label htmlFor="client-address">Android IP address</label>
            <input id="client-address" autoFocus inputMode="decimal" autoComplete="off" spellCheck="false" value={address} disabled={active} onChange={e => { setAddress(e.target.value); setError(''); }} />
            <p>Use the same Wi-Fi network. Set the Android allowed origin to <code>{window.location.origin}</code> and allow local-network access in your browser.</p>
          </> : <p>Webcam capture and tracking are not implemented yet. This dummy option lets you continue through the menus without connecting Android.</p>}
          <div className="button-row">
            {active ? <button type="button" onClick={() => source.disconnect()}>{connection.status === 'connected' ? 'Disconnect' : 'Cancel connection'}</button> : <button type="submit">Ok</button>}
            <button type="button" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <div role="status" className="connection-message">{error || connection.message || 'Ready to connect on port 1337.'}</div>
        </form>
      )}
      <button className="connect-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className={`connection-dot ${connection.status}`} />
        {{ dummy: 'Webcam · Dummy', connected: 'Client Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…' }[connection.status] || 'Connect Client'}
      </button>
    </aside>
  );
}
