import { Link } from 'react-router-dom';
import { ArrowRight, FileCheck2, Navigation, Power, Wallet } from 'lucide-react';
import { EnquiryForm, PageHero, SectionHead } from '../components/SitePieces';
import { APP_LINKS } from '../siteContent';

const PERKS = [
  { icon: Power, title: 'Your hours', text: 'Go online when you want to work and offline when you don’t.' },
  { icon: Navigation, title: 'Rides and goods', text: 'Take taxi and porter jobs on the same app, with navigation to every pickup and drop.' },
  { icon: Wallet, title: 'See your earnings', text: 'Earnings, commission and payouts for every trip, in the app.' },
  { icon: FileCheck2, title: 'Simple sign-up', text: 'Register, upload your documents and vehicle details, and get verified.' },
];

export default function Drive() {
  return (
    <>
      <PageHero
        eyebrow="Drive with us"
        title={<>Drive. Deliver. <span className="mk-red">Earn.</span></>}
        lead="Join MIKROMEK as a driver partner for taxi rides and porter deliveries."
      >
        <Link to={APP_LINKS.driver} className="mk-btn mk-btn--red">Register as a driver <ArrowRight size={18} /></Link>
      </PageHero>

      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <SectionHead eyebrow="Why drive with MIKROMEK" title="Built for drivers" />
          <div className="mk-tiles">
            {PERKS.map((p) => (
              <div key={p.title} className="mk-card">
                <span className="mk-card__icon"><p.icon size={24} /></span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap mk-split" style={{ alignItems: 'start' }}>
          <SectionHead
            eyebrow="Questions first?"
            title="Talk to our team"
            lead="Leave your details and city and we will call you back about joining, documents and vehicles."
          />
          <EnquiryForm
            type="driver"
            submitLabel="Request a call back"
            extra={[
              { key: 'city', label: 'City' },
              { key: 'experience', label: 'Driving experience', options: ['Less than 1 year', '1–3 years', '3–5 years', 'More than 5 years'] },
            ]}
          />
        </div>
      </section>
    </>
  );
}
