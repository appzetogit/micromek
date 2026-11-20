import { Link } from 'react-router-dom';
import { ArrowRight, Cpu, HandHeart, Zap } from 'lucide-react';
import { PageHero, RedBand, SectionHead } from '../components/SitePieces';
import { SERVICES, TAGLINE_BOTTOM, TAGLINE_TOP } from '../siteContent';

const VALUES = [
  { icon: Zap, title: TAGLINE_TOP, text: 'Service that works every time: a ride that arrives, goods that get there, an invoice that adds up.' },
  { icon: Cpu, title: TAGLINE_BOTTOM, text: 'Live tracking, live fleet data, and one system behind every app and panel.' },
  { icon: HandHeart, title: 'Growing together', text: 'Franchise partners and drivers who share in what they build in their own cities.' },
];

export default function AboutUs() {
  return (
    <>
      <PageHero
        eyebrow="About MIKROMEK"
        title={<>{TAGLINE_TOP}.<br /><span className="mk-red">{TAGLINE_BOTTOM}.</span></>}
        lead="MIKROMEK brings taxi rides, porter deliveries, EV fleet monitoring, shopping and city franchises together on one platform."
      />

      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <SectionHead eyebrow="What we stand for" title="Three ideas behind MIKROMEK" />
          <div className="mk-grid-3">
            {VALUES.map((v) => (
              <div key={v.title} className="mk-card">
                <span className="mk-card__icon"><v.icon size={24} /></span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--ink mk-stripes mk-on-dark">
        <div className="mk-wrap">
          <SectionHead eyebrow="The platform" title="What MIKROMEK runs" />
          <div className="mk-tiles">
            {SERVICES.map((s) => (
              <Link key={s.id} to={`/services#${s.id}`} className="mk-tile">
                <span className="mk-tile__icon"><s.icon size={22} /></span>
                <h3>{s.title}</h3>
                <p>{s.short}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap">
          <RedBand title="Work with us" text="Partner with MIKROMEK as a franchise, drive with us, or bring your fleet onto the platform.">
            <Link to="/franchise" className="mk-btn mk-btn--light">Franchise <ArrowRight size={18} /></Link>
            <Link to="/drive-with-us" className="mk-btn mk-btn--ink">Drive with us</Link>
          </RedBand>
        </div>
      </section>
    </>
  );
}
