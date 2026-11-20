import { CheckCircle2, Loader2, Plus, Zap } from 'lucide-react';
import { useState } from 'react';
import { Bolt, ReturnArrow } from './BrandArt';
import useEnquiryForm from '../useEnquiryForm';
import { FAQ, TAGLINE_BOTTOM, TAGLINE_TOP } from '../siteContent';

export const Eyebrow = ({ children }) => (
  <span className="mk-eyebrow"><Zap size={15} fill="currentColor" /> {children}</span>
);

export const SectionHead = ({ eyebrow, title, lead, center = false }) => (
  <div className={`mk-section__head${center ? ' mk-section__head--center' : ''}`}>
    {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
    <h2>{title}</h2>
    {lead ? <p className="mk-lead">{lead}</p> : null}
  </div>
);

/** Dark hero for inner pages, with the logo's return arrow in the corner. */
export const PageHero = ({ eyebrow, title, lead, children }) => (
  <section className="mk-pagehero mk-stripes mk-on-dark">
    <ReturnArrow className="mk-pagehero__arc" strokeWidth={10} />
    <div className="mk-wrap" style={{ position: 'relative' }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mk-rise" style={{ marginTop: 14 }}>{title}</h1>
      {lead ? <p className="mk-lead mk-rise mk-rise--2">{lead}</p> : null}
      {children ? <div className="mk-actions mk-mt mk-rise mk-rise--3">{children}</div> : null}
    </div>
  </section>
);

export const Ribbon = () => {
  const items = [TAGLINE_TOP, TAGLINE_BOTTOM, 'Taxi', 'Porter', 'EV Fleet', 'Shop', 'Franchise'];
  const row = [...items, ...items];
  return (
    <div className="mk-ribbon" aria-hidden="true">
      <div className="mk-ribbon__track">
        {row.map((text, i) => (
          <span key={`${text}-${i}`} className="mk-ribbon__item"><Zap size={18} fill="currentColor" /> {text}</span>
        ))}
      </div>
    </div>
  );
};

export const FaqList = ({ items = FAQ }) => (
  <div className="mk-faq">
    {items.map((f) => (
      <details key={f.q}>
        <summary>{f.q} <Plus size={20} /></summary>
        <p>{f.a}</p>
      </details>
    ))}
  </div>
);

export const RedBand = ({ title, text, children }) => (
  <div className="mk-band">
    <Bolt className="mk-band__bolt" />
    <div className="mk-stack" style={{ position: 'relative' }}>
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
    </div>
    <div className="mk-actions" style={{ position: 'relative' }}>{children}</div>
  </div>
);

/**
 * Enquiry form posting to /users/enquiry (Admin → Website Enquiries).
 * `type` must be one the backend accepts: contact | driver | partner | corporate | advertise.
 * `extra` describes additional fields; their keys must be ones the backend keeps for that type.
 */
export const EnquiryForm = ({ type = 'contact', title, extra = [], defaults = {}, submitLabel = 'Send' }) => {
  const { submitted, sending, error, submit } = useEnquiryForm(type);
  const [values, setValues] = useState({ name: '', phone: '', email: '', message: '', ...defaults });
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  if (submitted) {
    return (
      <div className="mk-form">
        <div className="mk-success">
          <CheckCircle2 size={44} />
          <h3>Thanks, we have it</h3>
          <p className="mk-muted">Our team will get back to you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="mk-form" onSubmit={(e) => submit(e, values)}>
      {title ? <h3>{title}</h3> : null}
      <div className="mk-form__grid">
        <label className="mk-field"><span>Name *</span><input required value={values.name} onChange={set('name')} autoComplete="name" /></label>
        <label className="mk-field"><span>Mobile</span><input inputMode="tel" value={values.phone} onChange={set('phone')} autoComplete="tel" placeholder="10-digit number" /></label>
        <label className="mk-field is-wide"><span>Email</span><input type="email" value={values.email} onChange={set('email')} autoComplete="email" /></label>
        {extra.map((f) => (
          <label key={f.key} className={`mk-field${f.wide ? ' is-wide' : ''}`}>
            <span>{f.label}</span>
            {f.options ? (
              <select value={values[f.key] || ''} onChange={set(f.key)}>
                <option value="">Select…</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input value={values[f.key] || ''} onChange={set(f.key)} />
            )}
          </label>
        ))}
        <label className="mk-field is-wide"><span>Message</span><textarea value={values.message} onChange={set('message')} /></label>
      </div>
      {error ? <div className="mk-alert mk-alert--error">{error}</div> : null}
      <p className="mk-form__note">Give us a mobile number or an email so we can reply.</p>
      <button type="submit" className="mk-btn mk-btn--red" disabled={sending}>
        {sending ? <Loader2 size={18} className="mk-spin" /> : null}{submitLabel}
      </button>
    </form>
  );
};
