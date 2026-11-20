import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { PageHero, RedBand } from '../components/SitePieces';
import { SERVICES } from '../siteContent';

export default function Services() {
  return (
    <>
      <PageHero
        eyebrow="Services"
        title={<>Five services. <span className="mk-red">One MIKROMEK.</span></>}
        lead="Taxi and porter for people and goods, live monitoring for electric fleets, an online shop, and franchises that bring it all to your city."
      />

      {SERVICES.map((s, i) => (
        <section key={s.id} id={s.id} className={`mk-section${i % 2 === 0 ? ' mk-section--white' : ''}`} style={{ scrollMarginTop: 90 }}>
          <div className={`mk-wrap mk-split${i % 2 ? ' mk-split--flip' : ''}`}>
            <div className="mk-stack">
              <span className="mk-eyebrow">0{i + 1} · {s.title}</span>
              <h2>{s.title}</h2>
              <p className="mk-lead">{s.short}</p>
              <div className="mk-actions" style={{ marginTop: 10 }}>
                <Link to={s.cta.to} className="mk-btn mk-btn--red">{s.cta.label} <ArrowRight size={18} /></Link>
              </div>
            </div>
            <div className="mk-card" style={{ padding: 32 }}>
              <span className="mk-card__icon"><s.icon size={28} /></span>
              <h3>What you get</h3>
              <ul className="mk-ticks" style={{ gap: 12 }}>
                {s.points.map((p) => <li key={p}><Check size={18} /> {p}</li>)}
              </ul>
            </div>
          </div>
        </section>
      ))}

      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <RedBand title="Not sure where to start?" text="Tell us what you need, a ride, a delivery, a fleet or a franchise, and we will point you the right way.">
            <Link to="/contact" className="mk-btn mk-btn--light">Contact us <ArrowRight size={18} /></Link>
          </RedBand>
        </div>
      </section>
    </>
  );
}
