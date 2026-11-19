import api from '../../../shared/api/axiosInstance';
import { qs } from '../pages/platform/kit';

/** Admin E-commerce API (/admin/commerce). Every call resolves to the body { success, data }. */
const B = '/admin/commerce';

// ---------- stores ----------
export const listStores = (params) => api.get(`${B}/stores${qs(params)}`);
export const getStore = (id) => api.get(`${B}/stores/${id}`);
export const createStore = (body) => api.post(`${B}/stores`, body);
export const updateStore = (id, body) => api.patch(`${B}/stores/${id}`, body);
/** franchise_id null takes the store back. */
export const allocateStore = (id, franchiseId) => api.post(`${B}/stores/${id}/franchise`, { franchise_id: franchiseId });
/** Soft delete: sets active=false. */
export const deactivateStore = (id) => api.delete(`${B}/stores/${id}`);

/** Franchises for allocation (franchise module). */
export const listFranchises = (params) => api.get(`/admin/franchises${qs(params)}`);

// ---------- categories ----------
export const listCategories = () => api.get(`${B}/categories`);
export const createCategory = (body) => api.post(`${B}/categories`, body);
export const updateCategory = (id, body) => api.patch(`${B}/categories/${id}`, body);
/** Soft delete; 409 while the category has active products. */
export const deactivateCategory = (id) => api.delete(`${B}/categories/${id}`);

// ---------- products ----------
export const listProducts = (params) => api.get(`${B}/products${qs(params)}`);
/** Includes `stock`: inventory rows per store. */
export const getProduct = (id) => api.get(`${B}/products/${id}`);
export const createProduct = (body) => api.post(`${B}/products`, body);
export const updateProduct = (id, body) => api.patch(`${B}/products/${id}`, body);
export const deactivateProduct = (id) => api.delete(`${B}/products/${id}`);

// ---------- inventory ----------
export const listInventory = (params) => api.get(`${B}/inventory${qs(params)}`);
export const listMovements = (params) => api.get(`${B}/inventory/movements${qs(params)}`);
/** { store_id, product_id, delta, reason } */
export const adjustStock = (body) => api.post(`${B}/inventory/adjust`, body);
/** { from_store_id, to_store_id, product_id, qty, reason } */
export const transferStock = (body) => api.post(`${B}/inventory/transfer`, body);
/** { store_id, product_id, reorder_level } */
export const setReorderLevel = (body) => api.post(`${B}/inventory/reorder-level`, body);

// ---------- staff ----------
export const listStaff = (params) => api.get(`${B}/staff${qs(params)}`);
export const createStaff = (body) => api.post(`${B}/staff`, body);
export const updateStaff = (id, body) => api.patch(`${B}/staff/${id}`, body);
export const deactivateStaff = (id) => api.delete(`${B}/staff/${id}`);
export const listActivity = (params) => api.get(`${B}/activity${qs(params)}`);

// ---------- customers ----------
export const listCustomers = (params) => api.get(`${B}/customers${qs(params)}`);
/** Customer plus `summary` ({ orders, billed, paid, outstanding, credit_due, refund_due, refunded, last_order_at, credit_limit }) and `recent_orders`. */
export const getCustomer = (id, params) => api.get(`${B}/customers/${id}${qs(params)}`);
/** Paged orders of one customer, plus `summary`. */
export const listCustomerOrders = (id, params) => api.get(`${B}/customers/${id}/orders${qs(params)}`);
export const createCustomer = (body) => api.post(`${B}/customers`, body);
export const updateCustomer = (id, body) => api.patch(`${B}/customers/${id}`, body);

// ---------- orders ----------
export const listOrders = (params) => api.get(`${B}/orders${qs(params)}`);
/** Includes `shipments` and `invoice` ({ number, issued_at }). */
export const getOrder = (id) => api.get(`${B}/orders/${id}`);
/** Manual order; starts as confirmed. */
export const createOrder = (body) => api.post(`${B}/orders`, body);
export const setOrderStatus = (id, status, note) => api.post(`${B}/orders/${id}/status`, { status, note });
/** { amount, method, reference } */
export const addPayment = (id, body) => api.post(`${B}/orders/${id}/payments`, body);
export const issueInvoice = (id) => api.post(`${B}/orders/${id}/invoice`);
/** { provider?, package? } → { package, cod_amount, providers: [{ provider, rates, error? }] } */
export const shippingRates = (id, body) => api.post(`${B}/orders/${id}/shipping-rates`, body);
/** { provider, courier_id?, package? } */
export const bookShipment = (id, body) => api.post(`${B}/orders/${id}/shipments`, body);

// ---------- refunds (records only; no gateway call) ----------
/** { status, store_id, order_id, from, to, search, page, limit } → paged + `summary` ({ [status]: { count, amount } }). */
export const listRefunds = (params) => api.get(`${B}/refunds${qs(params)}`);
export const getRefund = (id) => api.get(`${B}/refunds/${id}`);
/** { amount? (defaults to the refundable balance), reason, method, notes } */
export const createRefund = (orderId, body) => api.post(`${B}/orders/${orderId}/refunds`, body);
export const approveRefund = (id, body) => api.post(`${B}/refunds/${id}/approve`, body || {});
/** { reason } */
export const rejectRefund = (id, reason) => api.post(`${B}/refunds/${id}/reject`, { reason });
/** { reference, method?, notes? } */
export const payRefund = (id, body) => api.post(`${B}/refunds/${id}/pay`, body);

// ---------- invoices ----------
export const listInvoices = (params) => api.get(`${B}/invoices${qs(params)}`);
export const invoicePdfUrl = (id) => `${B}/invoices/${id}/pdf`;

// ---------- shipments ----------
export const listShipments = (params) => api.get(`${B}/shipments${qs(params)}`);
export const getShipment = (id) => api.get(`${B}/shipments/${id}`);
export const refreshShipment = (id) => api.post(`${B}/shipments/${id}/refresh`);
export const cancelShipment = (id) => api.post(`${B}/shipments/${id}/cancel`);
/** local_porter only: { status, note?, location? } */
export const setShipmentStatus = (id, body) => api.post(`${B}/shipments/${id}/status`, body);

// ---------- reports ----------
/** { group: day|store|franchise|channel|type, from, to, store_id, franchise_id } */
export const reportSales = (params) => api.get(`${B}/reports/sales${qs(params)}`);
export const reportTopProducts = (params) => api.get(`${B}/reports/top-products${qs(params)}`);
export const reportLowStock = (params) => api.get(`${B}/reports/low-stock${qs(params)}`);
/** { from, to, store_id, franchise_id } - franchise_id matches the order's franchise at placement. */
export const reportStaff = (params) => api.get(`${B}/reports/staff${qs(params)}`);
