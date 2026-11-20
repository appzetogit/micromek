import { BatteryCharging, Building2, Car, Mail, MapPin, MessageCircle, Package, Phone, ShoppingBag } from 'lucide-react';

/**
 * Copy for the MIKROMEK public site, taken from the platform scope: taxi,
 * porter, EV fleet monitoring, the online shop, and city franchises.
 *
 * Contact details (phone, WhatsApp, email, address) are NOT here: they come
 * from Admin → Website Content (useLanding), and anything left blank there is
 * simply not shown.
 */

export const TAGLINE_TOP = 'Power Full Service';
export const TAGLINE_BOTTOM = "Today's Technology";

export const NAV = [
  { label: 'Home', to: '/' },
  { label: 'Services', to: '/services' },
  { label: 'Franchise', to: '/franchise' },
  { label: 'Drive with us', to: '/drive-with-us' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
];

/** Where the customer app starts each flow. */
export const APP_LINKS = {
  ride: '/ride/select-location',
  parcel: '/parcel/type',
  login: '/login',
  driver: '/taxi/driver',
  franchisePanel: '/franchise',
};

export const SERVICES = [
  {
    id: 'taxi',
    icon: Car,
    title: 'Taxi',
    short: 'City rides, airport and outstation trips with live tracking.',
    points: [
      'Pickup, drop and vehicle choice with the fare shown upfront',
      'Live driver and vehicle tracking',
      'Pay online or in cash, invoice for every trip',
      'Ratings, reviews and in-app support',
    ],
    cta: { label: 'Book a ride', to: APP_LINKS.ride },
  },
  {
    id: 'porter',
    icon: Package,
    title: 'Porter',
    short: 'Goods transport across the city, from parcels to loads.',
    points: [
      'Choose a vehicle by the size of the load',
      'Sender and receiver details, live tracking to the door',
      'Proof of pickup and delivery',
      'Business deliveries from our own stores',
    ],
    cta: { label: 'Send goods', to: APP_LINKS.parcel },
  },
  {
    id: 'ev',
    icon: BatteryCharging,
    title: 'EV Fleet',
    short: 'Live monitoring for electric fleets: battery, charging and trips.',
    points: [
      'Live GPS position for every vehicle',
      'Battery %, charging status and estimated range',
      'Low-battery and offline alerts',
      'Trip history, utilisation and performance reports',
    ],
    cta: { label: 'Request a demo', to: '/contact?topic=ev' },
  },
  {
    id: 'shop',
    icon: ShoppingBag,
    title: 'Shop',
    short: 'Retail and wholesale from our stores, delivered city-wide or pan-India.',
    points: [
      'Retail orders and billing in the app',
      'Wholesale orders over WhatsApp or a call',
      'GST invoices for every order',
      'Same-city delivery by our porters, pan-India shipping',
    ],
    cta: { label: 'Wholesale enquiry', to: '/contact?topic=wholesale' },
  },
  {
    id: 'franchise',
    icon: Building2,
    title: 'Franchise',
    short: 'Run MIKROMEK in your city with your own dashboard and payouts.',
    points: [
      'City or area allocation, exclusive to you',
      'Your own panel: drivers, vehicles, bookings, stores',
      'Clear commission rules and regular settlements',
      'Revenue and performance reports',
    ],
    cta: { label: 'Apply for a franchise', to: '/franchise' },
  },
];

export const PLATFORM = [
  { title: 'Customer app', text: 'Book rides and porters, track live, pay, rate and get support.' },
  { title: 'Driver app', text: 'Go online, accept jobs, navigate, start and finish trips, see earnings.' },
  { title: 'Franchise panel', text: 'Drivers, vehicles, bookings, EV fleet and settlements for your territory.' },
  { title: 'Control centre', text: 'Fares, commissions, payments, reports and EV dashboards in one admin.' },
];

export const FAQ = [
  {
    q: 'Which services does MIKROMEK offer?',
    a: 'Taxi rides, porter (goods transport), EV fleet monitoring for businesses, an online shop with retail and wholesale ordering, and city franchises.',
  },
  {
    q: 'How do I book a ride or a porter?',
    a: 'Sign in with your mobile number and a one-time code, choose pickup and drop, pick a vehicle and confirm. You can track the driver live and pay online or in cash.',
  },
  {
    q: 'How does EV fleet monitoring work?',
    a: 'Your vehicles’ telematics feed live position, battery level and charging status into a dashboard, with alerts for low battery or vehicles that go offline, and reports on trips and utilisation. What can be shown depends on the vehicle and the telematics provider.',
  },
  {
    q: 'Can I place a wholesale order?',
    a: 'Yes. Wholesale orders are taken over WhatsApp or a call and billed with a GST invoice. Send a wholesale enquiry and our team will get back to you.',
  },
  {
    q: 'How do I become a franchise partner?',
    a: 'Apply on the Franchise page. Once approved, you get a city or area that is yours alone, your own franchise panel, and settlements on an agreed cycle.',
  },
];

/** Contact rows: only what has been filled in under Admin → Website Content. */
export const contactRows = (contact = {}) =>
  [
    contact.tollFree && { icon: Phone, label: 'Call', value: contact.tollFree, href: `tel:${String(contact.tollFree).replace(/\s/g, '')}` },
    contact.whatsapp && { icon: MessageCircle, label: 'WhatsApp', value: contact.whatsappDisplay || `+${contact.whatsapp}`, href: `https://wa.me/${contact.whatsapp}` },
    contact.email && { icon: Mail, label: 'Email', value: contact.email, href: `mailto:${contact.email}` },
    contact.address && { icon: MapPin, label: 'Office', value: contact.address, href: contact.mapsUrl || undefined },
  ].filter(Boolean);
