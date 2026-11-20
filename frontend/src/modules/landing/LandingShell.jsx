import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import SiteFooter from './components/SiteFooter';
import { LandingContentProvider, useLanding } from './landingContentContext';
import './site.css';

/**
 * Shell for the public MIKROMEK site. `.mk-site` scopes site.css so none of it
 * reaches the apps or the admin panel.
 *
 * Contact details and the logo come from Admin → Website Content / General
 * Settings through useLanding; the page copy lives in siteContent.js.
 */

const DEFAULT_TITLE = "MIKROMEK · Power Full Service, Today's Technology";
const DEFAULT_DESCRIPTION =
  'Taxi rides, porter goods transport, EV fleet monitoring, online shopping and city franchises on one MIKROMEK platform.';

function ShellBody() {
  const { brand, contact, seo, waLink } = useLanding();
  const { pathname, hash } = useLocation();

  // Pages scroll to the top on navigation, or to the section a link names.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);

  // The CMS title/description wins only once someone has changed it from the
  // old taxi copy; until then the MIKROMEK defaults apply.
  useEffect(() => {
    const cmsTitle = String(seo?.title || '');
    document.title = cmsTitle && !/Your Ride\. Our Priority/i.test(cmsTitle) ? cmsTitle : DEFAULT_TITLE;
    const cmsDesc = String(seo?.description || '');
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute('content', cmsDesc && !/cabs with verified drivers/i.test(cmsDesc) ? cmsDesc : DEFAULT_DESCRIPTION);
  }, [seo?.title, seo?.description]);

  return (
    <div className="mk-site">
      <SiteHeader logo={brand?.logo} />
      <main>
        <Outlet />
      </main>
      <SiteFooter logo={brand?.logo} contact={contact} />
      {contact?.whatsapp ? (
        <a className="mk-wa" href={waLink("Hi MIKROMEK, I'd like to know more.")} target="_blank" rel="noreferrer" aria-label="Chat with MIKROMEK on WhatsApp">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.13-.42-2.15-1.33-.8-.71-1.34-1.59-1.5-1.89-.15-.3-.02-.46.13-.61.15-.15.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.68-1.63-.93-2.23-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47 0 1.46 1.06 2.87 1.21 3.07.15.2 2.09 3.2 5.07 4.37 2.98 1.17 2.98.78 3.52.73.54-.05 1.75-.71 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.39 1.26 4.82L2 22l5.4-1.42a9.86 9.86 0 004.64 1.18c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2z" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}

export default function LandingShell() {
  return (
    <LandingContentProvider>
      <ShellBody />
    </LandingContentProvider>
  );
}
