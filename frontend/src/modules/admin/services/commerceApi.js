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
export const getCustomer = (id) => api.get(`${B}/customers/${id}`);
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
export const reportStaff = (params) => api.get(`${B}/reports/staff${qs(params)}`);
