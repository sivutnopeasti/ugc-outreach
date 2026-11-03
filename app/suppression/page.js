'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '../components/Shell';

export default function SuppressionPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/suppression')
      .then(async (res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then((body) => {
        if (body?.text != null) setText(body.text);
      })
      .catch((err) => setError(err.message));
  }, [router]);

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/suppression', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || 'Tallennus epäonnistui');
      return;
    }
    setMessage('Estolista tallennettu.');
  }

  return (
    <Shell>
      <div className="hero">
        <div>
          <h1>Estolista</h1>
          <p>Näille osoitteille ei koskaan lähetetä. Lisää yksi sähköposti per rivi, esimerkiksi jos yritys vastasi ”Ei kiitos”.</p>
        </div>
      </div>
      <form className="panel grid" onSubmit={save}>
        <label>
          Estetyt osoitteet
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} />
        </label>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <div className="actions">
          <button className="btn accent">Tallenna</button>
        </div>
      </form>
    </Shell>
  );
}
