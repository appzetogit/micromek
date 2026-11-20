import { useSearchParams } from 'react-router-dom';
import { EnquiryForm, PageHero, SectionHead } from '../components/SitePieces';
import { contactRows } from '../siteContent';
import { useLanding } from '../landingContentContext';

const TOPICS = {
  ev: 'EV fleet monitoring demo',
  wholesale: 'Wholesale order',
  franchise: 'Franchise',
  taxi: 'Taxi',
  porter: 'Porter',
};
const SUBJECTS = ['General', 'Taxi', 'Porter', 'EV fleet monitoring demo', 'Wholesale order', 'Franchise', 'Support'];

export default function ContactUs() {
  const { contact } = useLanding();
  const [params] = useSearchParams();
  const subject = TOPICS[params.get('topic')] || 'General';
  const rows = contactRows(contact);

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={<>Let&apos;s <span className="mk-red">talk</span></>}
        lead="Questions, a demo of EV fleet monitoring, a wholesale order or a franchise: send us a message and our team will reply."
      />

      <section className="mk-section">
        <div className="mk-wrap mk-split" style={{ alignItems: 'start' }}>
          <div className="mk-stack">
            <SectionHead eyebrow="Reach us" title="We reply fast" />
            {rows.length ? (
              <div className="mk-contacts">
                {rows.map((r) => (
                  <div key={r.label} className="mk-contact">
                    <r.icon size={22} />
                    <div>
                      <b>{r.label}</b>
                      {r.href ? <a href={r.href} target={r.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{r.value}</a> : <span>{r.value}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mk-muted">Use the form and our team will get back to you by phone or email.</p>
            )}
          </div>

          {/* Keyed by subject so a ?topic= link pre-selects it. */}
          <EnquiryForm
            key={subject}
            type="contact"
            title="Send a message"
            defaults={{ subject }}
            extra={[{ key: 'subject', label: 'About', options: SUBJECTS, wide: true }]}
          />
        </div>
      </section>
    </>
  );
}
