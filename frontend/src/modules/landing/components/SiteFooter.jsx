import { Link } from 'react-router-dom';
import { BrandMark } from './BrandArt';
import { APP_LINKS, SERVICES, TAGLINE_BOTTOM, TAGLINE_TOP, contactRows } from '../siteContent';

export default function SiteFooter({ logo, contact }) {
  const rows = contactRows(contact);
  const year = new Date().getFullYear();
  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <div className="mk-footer__grid">
          <div className="mk-stack">
            <BrandMark logo={logo} />
            <p className="mk-muted" style={{ color: 'var(--steel-2)', maxWidth: '38ch' }}>
              {TAGLINE_TOP}. {TAGLINE_BOTTOM}. Taxi, porter, EV fleet monitoring, shopping and
              city franchises on one platform.
            </p>
          </div>

          <div>
            <h4>Services</h4>
            <ul>
              {SERVICES.map((s) => (
                <li key={s.id}><Link to={`/services#${s.id}`}>{s.title}</Link></li>
              ))}
            </ul>
          </div>

          <div>
            <h4>Company</h4>
            <ul>
              <li><Link to="/about">About</Link></li>
              <li><Link to="/franchise">Franchise</Link></li>
              <li><Link to="/drive-with-us">Drive with us</Link></li>
              <li><Link to="/contact">Contact</Link></li>
              <li><Link to={APP_LINKS.login}>Sign in</Link></li>
            </ul>
          </div>

          <div>
            <h4>Get in touch</h4>
            {rows.length ? (
              <ul>
                {rows.map((r) => (
                  <li key={r.label} style={{ display: 'flex', gap: 10 }}>
                    <r.icon size={18} style={{ flex: 'none', color: 'var(--red)', marginTop: 3 }} />
                    {r.href ? <a href={r.href} target={r.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{r.value}</a> : <span>{r.value}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p><Link to="/contact" className="mk-link">Send us a message</Link></p>
            )}
          </div>
        </div>

        <div className="mk-footer__bottom">
          <span>© {year} MIKROMEK. All rights reserved.</span>
          <nav aria-label="Legal">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/support">Support</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
