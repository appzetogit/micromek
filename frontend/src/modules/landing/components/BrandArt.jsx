/**
 * Brand shapes from the MIKROMEK logo: the lightning bolt and the red return
 * arrow. Drawn as SVG so they stay sharp and take the brand colours.
 */

export const Bolt = ({ className = '', ...props }) => (
  <svg viewBox="0 0 200 90" className={className} fill="currentColor" aria-hidden="true" {...props}>
    <path d="M0 52 L118 30 L96 50 L200 18 L74 78 L98 56 Z" />
  </svg>
);

/** The circular red arrow that wraps the wordmark in the logo. */
export const ReturnArrow = ({ className = '', strokeWidth = 14, ...props }) => (
  <svg viewBox="0 0 400 400" className={className} fill="none" aria-hidden="true" {...props}>
    <path
      d="M200 30 A170 170 0 1 0 370 200"
      stroke="#e1251b"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
    <path d="M200 30 l-34 -22 l6 44 z" fill="#e1251b" transform="rotate(8 200 30)" />
  </svg>
);

/** Logo image with the wordmark beside it. */
export const BrandMark = ({ logo, compact = false }) => (
  <span className="mk-brand">
    <img src={logo || '/mikromek-logo.jpg'} alt="" width="52" height="52" />
    {compact ? null : (
      <span className="mk-brand__text">
        <span className="mk-brand__name">MIK<b>R</b>OMEK</span>
        <span className="mk-brand__tag">Power Full Service</span>
      </span>
    )}
  </span>
);
