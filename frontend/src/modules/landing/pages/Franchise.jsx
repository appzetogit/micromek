import { useState } from 'react';
import { BarChart3, Building2, CheckCircle2, Loader2, MapPinned, ReceiptIndianRupee, ShieldCheck, Users } from 'lucide-react';
import api from '../../../shared/api/axiosInstance';
import { FaqList, PageHero, SectionHead } from '../components/SitePieces';

const BENEFITS = [
  { icon: MapPinned, title: 'Your territory', text: 'A city or area allocated to you alone. No other franchise can operate there.' },
  { icon: Users, title: 'Your panel', text: 'Drivers, vehicles, bookings, EV fleet and stores in your territory, on your own login.' },
  { icon: ReceiptIndianRupee, title: 'Clear payouts', text: 'Commission rules agreed up front, and settlements weekly, fortnightly or monthly.' },
  { icon: BarChart3, title: 'Real numbers', text: 'Revenue, commission and performance reports for every period.' },
];

const FRANCHISE_FAQ = [
  { q: 'What does a franchise cover?', a: 'Taxi and porter operations in your territory, and optionally MIKROMEK stores: products, stock, orders and billing.' },
  { q: 'How is my share worked out?', a: 'A percentage of the platform commission or of the fare on each completed trip in your territory, agreed per service. You see every settlement line by line.' },
  { q: 'What happens after I apply?', a: 'Our team reviews the application and contacts you. Once approved, you can sign in to your franchise panel with the email and password you set here.' },
];

const BUSINESS_TYPES = [
  { value: 'mobility', label: 'Taxi & porter' },
  { value: 'commerce', label: 'Stores (shop)' },
  { value: 'both', label: 'Both' },
];

const ApplyForm = () => {
  const [v, setV] = useState({ name: '', contact_name: '', mobile: '', email: '', city: '', state: '', business_type: 'mobility', password: '' });
  const [state, setState] = useState({ sending: false, error: '', done: null });
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setState({ sending: true, error: '', done: null });
    try {
      const body = await api.post('/franchise/apply', v);
      setState({ sending: false, error: '', done: body?.data || {} });
    } catch (err) {
      setState({ sending: false, error: err?.message || 'Could not send the application. Please try again.', done: null });
    }
  };

  if (state.done) {
    return (
      <div className="mk-form">
        <div className="mk-success">
          <CheckCircle2 size={48} />
          <h3>Application received</h3>
          {state.done.code ? <p>Your reference: <b>{state.done.code}</b></p> : null}
          <p className="mk-muted">Our team will review it and contact you. Keep your email and password for the franchise panel.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="mk-form" onSubmit={submit} id="apply">
      <h3>Apply for a franchise</h3>
      <div className="mk-form__grid">
        <label className="mk-field is-wide"><span>Business name *</span><input required value={v.name} onChange={set('name')} autoComplete="organization" /></label>
        <label className="mk-field"><span>Your name *</span><input required value={v.contact_name} onChange={set('contact_name')} autoComplete="name" /></label>
        <label className="mk-field"><span>Mobile *</span><input required inputMode="tel" value={v.mobile} onChange={set('mobile')} autoComplete="tel" /></label>
        <label className="mk-field is-wide"><span>Email *</span><input required type="email" value={v.email} onChange={set('email')} autoComplete="email" /></label>
        <label className="mk-field"><span>City *</span><input required value={v.city} onChange={set('city')} autoComplete="address-level2" /></label>
        <label className="mk-field"><span>State</span><input value={v.state} onChange={set('state')} autoComplete="address-level1" /></label>
        <label className="mk-field"><span>Interested in</span>
          <select value={v.business_type} onChange={set('business_type')}>
            {BUSINESS_TYPES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        <label className="mk-field"><span>Panel password *</span><input required type="password" minLength={8} value={v.password} onChange={set('password')} autoComplete="new-password" /></label>
      </div>
      <p className="mk-form__note">The password is for your franchise panel once you are approved. At least 8 characters.</p>
      {state.error ? <div className="mk-alert mk-alert--error">{state.error}</div> : null}
      <button type="submit" className="mk-btn mk-btn--red" disabled={state.sending}>
        {state.sending ? <Loader2 size={18} className="mk-spin" /> : <Building2 size={18} />} Send application
      </button>
    </form>
  );
};

export default function Franchise() {
  return (
    <>
      <PageHero
        eyebrow="Franchise"
        title={<>Bring MIKROMEK <span className="mk-red">to your city</span></>}
        lead="Taxi, porter and stores in a territory that is yours alone, run from your own panel, with clear commission and regular settlements."
      >
        <a href="#apply" className="mk-btn mk-btn--red">Apply now</a>
      </PageHero>

      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <SectionHead eyebrow="Why partner" title="What you get" />
          <div className="mk-tiles" style={{ gridTemplateColumns: undefined }}>
            {BENEFITS.map((b) => (
              <div key={b.title} className="mk-card">
                <span className="mk-card__icon"><b.icon size={24} /></span>
                <h3>{b.title}</h3>
                <p>{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk-wrap mk-split" style={{ alignItems: 'start' }}>
          <div className="mk-stack">
            <SectionHead eyebrow="How it works" title="From application to first payout" />
            <div className="mk-steps" style={{ gridTemplateColumns: '1fr' }}>
              <div className="mk-step"><h3>Apply</h3><p>Send this form. We check your territory is free and review your details.</p></div>
              <div className="mk-step"><h3>Get approved</h3><p>Your city or area is allocated and your commission rules agreed.</p></div>
              <div className="mk-step"><h3>Operate and earn</h3><p>Run your territory from the franchise panel; settlements follow every cycle.</p></div>
            </div>
            <p className="mk-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={18} color="var(--red)" /> Each territory goes to one franchise only.</p>
          </div>
          <ApplyForm />
        </div>
      </section>

      <section className="mk-section mk-section--white">
        <div className="mk-wrap">
          <SectionHead center eyebrow="Questions" title="Franchise FAQ" />
          <FaqList items={FRANCHISE_FAQ} />
        </div>
      </section>
    </>
  );
}
