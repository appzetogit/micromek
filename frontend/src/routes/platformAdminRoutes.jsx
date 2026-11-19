import { lazy } from 'react';
import { Route } from 'react-router-dom';

/**
 * Admin pages for the platform modules. Rendered inside the /admin layout
 * route in adminRoutes.jsx, so paths are relative to /admin.
 */
const p = (loader) => lazy(loader);

// Franchise
const FranchiseList = p(() => import('../modules/admin/pages/franchise/FranchiseList'));
const FranchiseForm = p(() => import('../modules/admin/pages/franchise/FranchiseForm'));
const FranchiseDetail = p(() => import('../modules/admin/pages/franchise/FranchiseDetail'));
const FranchiseLeaderboard = p(() => import('../modules/admin/pages/franchise/FranchiseLeaderboard'));
const FranchiseSettlements = p(() => import('../modules/admin/pages/franchise/FranchiseSettlements'));
const SettlementDetail = p(() => import('../modules/admin/pages/franchise/SettlementDetail'));

// EV fleet
const EvDashboard = p(() => import('../modules/admin/pages/ev/EvDashboard'));
const EvVehicles = p(() => import('../modules/admin/pages/ev/EvVehicles'));
const EvVehicleDetail = p(() => import('../modules/admin/pages/ev/EvVehicleDetail'));
const EvAlerts = p(() => import('../modules/admin/pages/ev/EvAlerts'));
const EvTrips = p(() => import('../modules/admin/pages/ev/EvTrips'));
const EvUtilisation = p(() => import('../modules/admin/pages/ev/EvUtilisation'));

// Commerce
const CommerceOrders = p(() => import('../modules/admin/pages/commerce/CommerceOrders'));
const CommerceOrderDetail = p(() => import('../modules/admin/pages/commerce/CommerceOrderDetail'));
const CommerceStores = p(() => import('../modules/admin/pages/commerce/CommerceStores'));
const CommerceCatalog = p(() => import('../modules/admin/pages/commerce/CommerceCatalog'));
const CommerceProductForm = p(() => import('../modules/admin/pages/commerce/CommerceProductForm'));
const CommerceInventory = p(() => import('../modules/admin/pages/commerce/CommerceInventory'));
const CommerceCustomers = p(() => import('../modules/admin/pages/commerce/CommerceCustomers'));
const CommerceShipments = p(() => import('../modules/admin/pages/commerce/CommerceShipments'));
const CommerceStaff = p(() => import('../modules/admin/pages/commerce/CommerceStaff'));
const CommerceReports = p(() => import('../modules/admin/pages/commerce/CommerceReports'));

// Leads & WhatsApp
const LeadsDashboard = p(() => import('../modules/admin/pages/leads/LeadsDashboard'));
const LeadsList = p(() => import('../modules/admin/pages/leads/LeadsList'));
const LeadDetail = p(() => import('../modules/admin/pages/leads/LeadDetail'));
const LeadFollowUps = p(() => import('../modules/admin/pages/leads/LeadFollowUps'));
const WhatsAppInbox = p(() => import('../modules/admin/pages/leads/WhatsAppInbox'));
const WhatsAppBroadcasts = p(() => import('../modules/admin/pages/leads/WhatsAppBroadcasts'));
const WhatsAppTemplates = p(() => import('../modules/admin/pages/leads/WhatsAppTemplates'));

const platformAdminRoutes = (
  <>
    <Route path="franchises" element={<FranchiseList />} />
    <Route path="franchises/create" element={<FranchiseForm />} />
    <Route path="franchises/leaderboard" element={<FranchiseLeaderboard />} />
    <Route path="franchises/:id" element={<FranchiseDetail />} />
    <Route path="franchises/:id/edit" element={<FranchiseForm />} />
    <Route path="franchise-settlements" element={<FranchiseSettlements />} />
    <Route path="franchise-settlements/:id" element={<SettlementDetail />} />

    <Route path="ev/dashboard" element={<EvDashboard />} />
    <Route path="ev/vehicles" element={<EvVehicles />} />
    <Route path="ev/vehicles/:id" element={<EvVehicleDetail />} />
    <Route path="ev/alerts" element={<EvAlerts />} />
    <Route path="ev/trips" element={<EvTrips />} />
    <Route path="ev/utilisation" element={<EvUtilisation />} />

    <Route path="commerce/orders" element={<CommerceOrders />} />
    <Route path="commerce/orders/:id" element={<CommerceOrderDetail />} />
    <Route path="commerce/stores" element={<CommerceStores />} />
    <Route path="commerce/catalog" element={<CommerceCatalog />} />
    <Route path="commerce/products/new" element={<CommerceProductForm />} />
    <Route path="commerce/products/:id" element={<CommerceProductForm />} />
    <Route path="commerce/inventory" element={<CommerceInventory />} />
    <Route path="commerce/customers" element={<CommerceCustomers />} />
    <Route path="commerce/shipments" element={<CommerceShipments />} />
    <Route path="commerce/staff" element={<CommerceStaff />} />
    <Route path="commerce/reports" element={<CommerceReports />} />

    <Route path="leads/dashboard" element={<LeadsDashboard />} />
    <Route path="leads" element={<LeadsList />} />
    <Route path="leads/follow-ups" element={<LeadFollowUps />} />
    <Route path="leads/:id" element={<LeadDetail />} />
    <Route path="whatsapp/inbox" element={<WhatsAppInbox />} />
    <Route path="whatsapp/broadcasts" element={<WhatsAppBroadcasts />} />
    <Route path="whatsapp/templates" element={<WhatsAppTemplates />} />
  </>
);

export default platformAdminRoutes;
