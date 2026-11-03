'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Kampanjat' },
  { href: '/settings', label: 'Asetukset' },
  { href: '/suppression', label: 'Estolista' },
];

export default function Shell({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          UGC Suomi
          <span>Outreach-sovellus</span>
        </div>
        <nav className="nav">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
            return (
              <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="actions" style={{ marginTop: 32 }}>
          <button type="button" className="btn secondary" onClick={logout}>Kirjaudu ulos</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
