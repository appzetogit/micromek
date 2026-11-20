import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, BellRing, Check, Gauge, LayoutDashboard, MapPin, MessageCircle,
  ReceiptText, ShieldCheck, Smartphone, Store, Truck, Users, Wallet,
} from 'lucide-react';
import { Bolt, ReturnArrow } from '../components/BrandArt';
import { FaqList, RedBand, Ribbon, SectionHead } from '../components/SitePieces';
import { APP_LINKS, PLATFORM, SERVICES, TAGLINE_BOTTOM, TAGLINE_TOP } from '../siteContent';
import { useLanding } from '../landingContentContext';

// Five services placed around the logo, starting at the top, clockwise.
const ORBIT = SERVICES.map((s, i) => {
  const angle = (-90 + i * 72) * (Math.PI / 180);
  return { ...s, left: `${50 + 44 * Math.cos(angle)}%`, top: `${50 + 44 * Math.sin(angle)}%` };
});

const Hero = ({ logo }) => (
  <section className="mk-hero">
    <Bolt className="mk-hero__bolt" />
    <div className="mk-wrap mk-hero__grid">
      <div>
        <span className="mk-eyebrow mk-rise">One platform · Five services</span>
        <h1 className="mk-rise mk-rise--2" style={{ marginTop: 16 }}>
          {TAGLINE_TOP.split(' ').slice(0, 2).join(' ')}<br />
          <span className="mk-red">Service.</span><br />
          <span className="mk-outline">{TAGLINE_BOTTOM}.</span>
        </h1>
        <span className="mk-rule" />
        <p className="mk-lead mk-rise mk-rise--3">
          Book a taxi, move goods with a porter, track your electric fleet live, order from our
          stores, or run MIKROMEK in your own city.
        </p>
        <div className="mk-hero__actions mk-rise mk-rise--4">
          <Link to={APP_LINKS.ride} className="mk-btn mk-btn--red">Book a ride <ArrowRight size={18} /></Link>
          <Link to={APP_LINKS.parcel} className="mk-btn mk-btn--ink"><Truck size={18} /> Send goods</Link>
          <Link to="/franchise" className="mk-btn mk-btn--ghost">Get a franchise</Link>
        </div>
        <div className="mk-hero__chips">
          <span className="mk-chip"><MapPin size={16} /> Live tracking</span>
          <span className="mk-chip"><Wallet size={16} /> Online or cash</span>
          <span className="mk-chip"><ReceiptText size={16} /> Invoice every trip</span>
          <span className="mk-chip"><ShieldCheck size={16} /> Verified drivers</span>
        </div>
      </div>

      <div className="mk-orbit" role="list" aria-label="MIKROMEK services">
        <svg className="mk-orbit__ring" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx="200" cy="200" r="176" fill="none" stroke="#cfd3d9" strokeWidth="2" strokeDasharray="4 10" />
        </svg>
        <div className="mk-orbit__ring mk-orbit__spin"><ReturnArrow strokeWidth={10} /></div>
        <div className="mk-orbit__core"><img src={logo || '/mikromek-logo.jpg'} alt="MIKROMEK" /></div>
        {ORBIT.map((s) => (
          <Link key={s.id} to={`/services#${s.id}`} role="listitem" className="mk-orbit__node" style={{ left: s.left, top: s.top }}>
            <span className="mk-orbit__icon"><s.icon size={26} /></span>
            <span className="mk-orbit__label">{s.title}</span>
          </Link>
        ))}
      </div>
    </div>
  </section>
);

const Services = () => (
  <section className="mk-section mk-section--white" id="services">
    <div className="mk-wrap">
      <SectionHead
        eyebrow="What we do"
        title={<>Everything that <span className="mk-red">moves</span>, on one platform</>}
        lead="Rides and goods for people, live data for fleets, products for shoppers and a business for partners."
      />
      <div className="mk-services">
        {SERVICES.map((s, i) => (
          <article key={s.id} className="mk-card">
            <span className="mk-card__num" aria-hidden="true">0{i + 1}</span>
            <span className="mk-card__icon"><s.icon size={26} /></span>
            <h3>{s.title}</h3>
            <p>{s.short}</p>
            <ul className="mk-ticks">
              {s.points.slice(0, 3).map((p) => <li key={p}><Check size={16} /> {p}</li>)}
            </ul>
            <div className="mk-card__foot">
              <Link to={s.cta.to} className="mk-link">{s.cta.label} <ArrowRight size={16} /></Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

const PLATFORM_ICONS = [Smartphone, Truck, Users, LayoutDashboard];

const Platform = () => (
  <section className="mk-section mk-section--ink mk-stripes mk-on-dark">
    <div className="mk-wrap">
      <SectionHead
        eyebrow="Today's technology"
        title={<>Built as <span className="mk-outline">one</span> system</>}
        lead="Apps for customers and drivers, a panel for every franchise, and a control centre for the whole business."
      />
      <div className="mk-tiles">
        {PLATFORM.map((p, i) => {
          const Icon = PLATFORM_ICONS[i];
          return (
            <div key={p.title} className="mk-tile">
              <span className="mk-tile__icon"><Icon size={22} /></span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

const FLEET = [
  { id: 'EV-101', place: 'Charging · Hub 2', soc: 64 },
  { id: 'EV-102', place: 'On trip · 32 km/h', soc: 81 },
  { id: 'EV-103', place: 'Parked · Depot', soc: 17, low: true },
  { id: 'EV-104', place: 'On trip · 41 km/h', soc: 55 },
];

const EvFeature = () => (
  <section className="mk-section" id="ev">
    <div className="mk-wrap mk-split">
      <div>
        <SectionHead
          eyebrow="EV fleet monitoring"
          title={<>Every vehicle. <span className="mk-red">Every percent.</span></>}
          lead="Connect your telematics and see the whole electric fleet live: where each vehicle is, how much charge it has, and which ones need attention."
        />
        <ul className="mk-ticks" style={{ gap: 12 }}>
          <li><Gauge size={18} /> Battery %, charging status and estimated range</li>
          <li><MapPin size={18} /> Live GPS position, movement and trip history</li>
          <li><BellRing size={18} /> Alerts for low battery and vehicles that go offline</li>
          <li><BarChart3 size={18} /> Utilisation and performance reports per vehicle</li>
        </ul>
        <div className="mk-actions mk-mt">
          <Link to="/contact?topic=ev" className="mk-btn mk-btn--red">Request a demo <ArrowRight size={18} /></Link>
        </div>
      </div>

      <div className="mk-dash" aria-label="Example EV fleet dashboard">
        <div className="mk-dash__top">
          <span className="mk-dash__title">Fleet · Live</span>
          <span className="mk-dash__live"><i /> Updating</span>
        </div>
        <div className="mk-dash__stats">
          <div className="mk-dash__stat"><b>4</b><span>Vehicles</span></div>
          <div className="mk-dash__stat"><b>54%</b><span>Avg battery</span></div>
          <div className="mk-dash__stat"><b className="mk-red">1</b><span>Low battery</span></div>
        </div>
        {FLEET.map((v) => (
          <div key={v.id} className="mk-dash__row">
            <div><b>{v.id}</b><small>{v.place}</small></div>
            <div className={`mk-soc${v.low ? ' mk-soc--low' : ''}`}><span style={{ width: `${v.soc}%` }} /></div>
            <b style={{ textAlign: 'right' }}>{v.soc}%</b>
          </div>
        ))}
        <p className="mk-dash__note">Illustration. Live figures come from your fleet&apos;s telematics.</p>
      </div>
    </div>
  </section>
);

const HowItWorks = () => (
  <section className="mk-section mk-section--white">
    <div className="mk-wrap">
      <SectionHead center eyebrow="Ride or porter" title="Booked in three steps" />
      <div className="mk-steps">
        <div className="mk-step"><h3>Sign in</h3><p>Use your mobile number and a one-time code. No passwords to remember.</p></div>
        <div className="mk-step"><h3>Choose</h3><p>Pickup, drop and vehicle. See the fare before you confirm, for a ride or for goods.</p></div>
        <div className="mk-step"><h3>Track and pay</h3><p>Follow the driver live, pay online or in cash, and get an invoice for every trip.</p></div>
      </div>
      <div className="mk-actions mk-mt" style={{ justifyContent: 'center' }}>
        <Link to={APP_LINKS.ride} className="mk-btn mk-btn--red">Book a ride</Link>
        <Link to={APP_LINKS.parcel} className="mk-btn mk-btn--ghost">Send goods</Link>
      </div>
    </div>
  </section>
);

const ShopFeature = () => (
  <section className="mk-section" id="shop">
    <div className="mk-wrap mk-split mk-split--flip">
      <div>
        <SectionHead
          eyebrow="MIKROMEK shop"
          title={<>Retail. Wholesale. <span className="mk-red">Delivered.</span></>}
          lead="Several stores, one business. Buy in the app, or order wholesale over WhatsApp or a call, with a GST invoice either way."
        />
        <div className="mk-actions">
          <Link to="/contact?topic=wholesale" className="mk-btn mk-btn--ink">Wholesale enquiry</Link>
        </div>
      </div>
      <div className="mk-grid-2">
        <div className="mk-card"><span className="mk-card__icon"><Store size={24} /></span><h3>Many stores</h3><p>Stock, pricing and billing for every store, managed in one place.</p></div>
        <div className="mk-card"><span className="mk-card__icon"><MessageCircle size={24} /></span><h3>Order on WhatsApp</h3><p>Wholesale orders and enquiries come straight to our team.</p></div>
        <div className="mk-card"><span className="mk-card__icon"><Truck size={24} /></span><h3>City and pan-India</h3><p>Same-city delivery by our porters; courier shipping everywhere else.</p></div>
        <div className="mk-card"><span className="mk-card__icon"><ReceiptText size={24} /></span><h3>GST invoices</h3><p>A proper invoice for every retail and wholesale order.</p></div>
      </div>
    </div>
  </section>
);

export default function Home() {
  const { brand } = useLanding();
  return (
    <>
      <Hero logo={brand?.logo} />
      <Ribbon />
      <Services />
      <Platform />
      <EvFeature />
      <HowItWorks />
      <ShopFeature />
      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <RedBand
            title="Run MIKROMEK in your city"
            text="Get a city or area of your own, a franchise panel for your drivers, vehicles, bookings and stores, and settlements on an agreed cycle."
          >
            <Link to="/franchise" className="mk-btn mk-btn--light">Apply now <ArrowRight size={18} /></Link>
            <Link to="/contact" className="mk-btn mk-btn--ink">Talk to us</Link>
          </RedBand>
        </div>
      </section>
      <section className="mk-section">
        <div className="mk-wrap">
          <SectionHead center eyebrow="Questions" title="Good to know" />
          <FaqList />
        </div>
      </section>
    </>
  );
}
