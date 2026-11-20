/**
 * Public site routes. The router builds from this list, and old marketing URLs
 * redirect to their closest new page so existing links keep working.
 */
export const LANDING_TABS = [
  { id: 'home', path: '/' },
  { id: 'services', path: '/services' },
  { id: 'franchise', path: '/franchise' },
  { id: 'driver', path: '/drive-with-us' },
  { id: 'about', path: '/about' },
  { id: 'contact', path: '/contact' },
];

export const LANDING_REDIRECTS = [
  { from: '/partner', to: '/franchise' },
  { from: '/corporate', to: '/contact' },
  { from: '/advertise', to: '/contact' },
  { from: '/zi-bus', to: '/services' },
];
