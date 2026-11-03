'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState(null);
  const [password, setPassword] = useState('');
  const [fromName, setFromName] = useState('UGC Suomi');
  const [fromEmail, setFromEmail] = useState('');
  const [postalAddress, setPostalAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/setup')
      .then((res) => res.json())
      .then((data) => setNeedsSetup(Boolean(data.needsSetup)))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (needsSetup) {
        const setup = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password, fromName, fromEmail, postalAddress }),
        });
        const setupBody = await setup.json();
        if (!setup.ok) throw new Error(setupBody.error || 'Alustus epäonnistui');
      }
      const login = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const loginBody = await login.json();
      if (!login.ok) throw new Error(loginBody.error || 'Kirjautuminen epäonnistui');
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (needsSetup === null) {
    return <div className="auth-wrap"><div className="panel auth-card">Ladataan…</div></div>;
  }

  return (
    <div className="auth-wrap">
      <form className="panel auth-card grid" onSubmit={onSubmit}>
        <div>
          <h1 style={{ marginTop: 0 }}>{needsSetup ? 'Ota sovellus käyttöön' : 'Kirjaudu'}</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            {needsSetup
              ? 'Luo salasana ja lähettäjän tiedot. Tämän jälkeen käytät vain tätä sivua — et tarvitse komentoriviä.'
              : 'Syötä sovelluksen salasana.'}
          </p>
        </div>
        {needsSetup && (
          <>
            <label>
              Lähettäjän nimi
              <input value={fromName} onChange={(e) => setFromName(e.target.value)} required />
            </label>
            <label>
              Lähettäjän sähköposti
              <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required />
            </label>
            <label>
              Postiosoite
              <textarea value={postalAddress} onChange={(e) => setPostalAddress(e.target.value)} required placeholder="Yritys Oy, Katu 1, 00100 Helsinki" />
            </label>
          </>
        )}
        <label>
          {needsSetup ? 'Sovelluksen salasana' : 'Salasana'}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={needsSetup ? 8 : 1} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn accent" disabled={loading}>
          {loading ? 'Odota…' : needsSetup ? 'Luo tili ja jatka' : 'Kirjaudu sisään'}
        </button>
      </form>
    </div>
  );
}
