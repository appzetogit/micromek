import { BatteryCharging, Building2, MessagesSquare, ShoppingBag } from 'lucide-react';

/**
 * Sidebar section for the platform modules (franchise, EV fleet, commerce,
 * leads/WhatsApp). Spliced into ADMIN_SIDEBAR_SECTIONS, so the admin-account
 * permission picker lists these menus too. `permission` is the backend
 * permission each page's API calls need.
 */
export const PLATFORM_SIDEBAR_SECTION = {
  title: 'Business',
  items: [
    {
      icon: Building2,
      label: 'Franchises',
      subItems: [
        { label: 'All Franchises', path: '/admin/franchises', permission: 'franchises.view' },
        { label: 'Settlements', path: '/admin/franchise-settlements', permission: 'franchises.view' },
        { label: 'Leaderboard', path: '/admin/franchises/leaderboard', permission: 'franchises.view' },
      ],
    },
    {
      icon: BatteryCharging,
      label: 'EV Fleet',
      subItems: [
        { label: 'Dashboard', path: '/admin/ev/dashboard', permission: 'ev_fleet.view' },
        { label: 'Vehicles', path: '/admin/ev/vehicles', permission: 'ev_fleet.view' },
        { label: 'Alerts', path: '/admin/ev/alerts', permission: 'ev_fleet.view' },
        { label: 'Trips', path: '/admin/ev/trips', permission: 'ev_fleet.view' },
        { label: 'Utilisation', path: '/admin/ev/utilisation', permission: 'ev_fleet.view' },
      ],
    },
    {
      icon: ShoppingBag,
      label: 'E-commerce',
      subItems: [
        { label: 'Orders', path: '/admin/commerce/orders', permission: 'commerce.view' },
        { label: 'Stores', path: '/admin/commerce/stores', permission: 'commerce.view' },
        { label: 'Catalogue', path: '/admin/commerce/catalog', permission: 'commerce.view' },
        { label: 'Inventory', path: '/admin/commerce/inventory', permission: 'commerce.view' },
        { label: 'Customers', path: '/admin/commerce/customers', permission: 'commerce.view' },
        { label: 'Shipments', path: '/admin/commerce/shipments', permission: 'commerce.view' },
        { label: 'Staff', path: '/admin/commerce/staff', permission: 'commerce.view' },
        { label: 'Reports', path: '/admin/commerce/reports', permission: 'commerce.view' },
      ],
    },
    {
      icon: MessagesSquare,
      label: 'Leads & WhatsApp',
      subItems: [
        { label: 'Lead Dashboard', path: '/admin/leads/dashboard', permission: 'leads.view' },
        { label: 'Leads', path: '/admin/leads', permission: 'leads.view' },
        { label: 'Follow-ups', path: '/admin/leads/follow-ups', permission: 'leads.view' },
        { label: 'WhatsApp Inbox', path: '/admin/whatsapp/inbox', permission: 'leads.view' },
        { label: 'Broadcasts', path: '/admin/whatsapp/broadcasts', permission: 'leads.view' },
        { label: 'Templates', path: '/admin/whatsapp/templates', permission: 'leads.view' },
      ],
    },
  ],
};
