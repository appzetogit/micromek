import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowRight, Menu, X } from 'lucide-react';
import { BrandMark } from './BrandArt';
import { APP_LINKS, NAV } from '../siteContent';

export default function SiteHeader({ logo }) {
  const { pathname } = useLocation();
  // Remembers the page the menu was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState(null);
  const open = openOn === pathname;

  // Stop the page scrolling behind the open menu.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const navClass = ({ isActive }) => (isActive ? 'is-active' : undefined);

  return (
    <header className="mk-header">
      <div className="mk-wrap mk-header__bar">
        <Link to="/" aria-label="MIKROMEK home">
          <BrandMark logo={logo} />
        </Link>

        <nav className="mk-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mk-header__cta">
          <Link to="/franchise" className="mk-btn mk-btn--ghost mk-btn--sm">Get a franchise</Link>
          <Link to={APP_LINKS.ride} className="mk-btn mk-btn--red mk-btn--sm">
            Book a ride <ArrowRight size={16} />
          </Link>
        </div>

        <button
          type="button"
          className="mk-burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open ? (
        <div className="mk-drawer">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `mk-drawer__link${isActive ? ' is-active' : ''}`}>
              {item.label} <ArrowRight size={20} />
            </NavLink>
          ))}
          <div className="mk-drawer__cta">
            <Link to={APP_LINKS.ride} className="mk-btn mk-btn--red">Book a ride</Link>
            <Link to={APP_LINKS.parcel} className="mk-btn mk-btn--ink">Send goods</Link>
            <Link to="/franchise" className="mk-btn mk-btn--ghost">Get a franchise</Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
