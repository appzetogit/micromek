/// Pure pricing / GST / status logic. No database access - unit-testable on its own.
/// Money is rupees as Numbers, rounded with round2 at every stored step.
import { ApiError } from '../../../utils/ApiError.js';
import { round2 as baseRound2 } from '../../franchise/services/franchiseService.js';

/// Half-up to paise without binary-float drift (4.975 -> 4.98, where Math.round(x*100) gives 4.97).
/// Falls back to franchiseService.round2 for values exponent notation cannot express.
export const round2 = (n) => {
  const v = Number(n) || 0;
  const r = Math.sign(v) * Number(`${Math.round(Number(`${Math.abs(v)}e2`))}e-2`);
  return Number.isFinite(r) ? r : baseRound2(v);
};

// ---------- order status flow ----------

export const ORDER_STATUSES = Object.freeze(['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned']);

export const ORDER_TRANSITIONS = Object.freeze({
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  // packed -> delivered covers counter pickup and POS hand-over without a shipment.
  packed: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
});

export const canTransition = (from, to) => Boolean(ORDER_TRANSITIONS[from]?.includes(to));

// ---------- GST place of supply ----------

const STATE_CODES = {
  '01': 'jammu and kashmir', '02': 'himachal pradesh', '03': 'punjab', '04': 'chandigarh', '05': 'uttarakhand',
  '06': 'haryana', '07': 'delhi', '08': 'rajasthan', '09': 'uttar pradesh', 10: 'bihar', 11: 'sikkim',
  12: 'arunachal pradesh', 13: 'nagaland', 14: 'manipur', 15: 'mizoram', 16: 'tripura', 17: 'meghalaya',
  18: 'assam', 19: 'west bengal', 20: 'jharkhand', 21: 'odisha', 22: 'chhattisgarh', 23: 'madhya pradesh',
  24: 'gujarat', 26: 'dadra and nagar haveli and daman and diu', 27: 'maharashtra', 29: 'karnataka', 30: 'goa',
  31: 'lakshadweep', 32: 'kerala', 33: 'tamil nadu', 34: 'puducherry', 35: 'andaman and nicobar islands',
  36: 'telangana', 37: 'andhra pradesh', 38: 'ladakh',
};
const STATE_ALIASES = {
  orissa: '21', pondicherry: '34', 'new delhi': '07', 'nct of delhi': '07', 'j&k': '01', 'jammu & kashmir': '01',
  uttaranchal: '05', 'daman and diu': '26', 'dadra and nagar haveli': '26', 'andaman & nicobar islands': '35',
};
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATE_CODES).map(([code, name]) => [name, String(code).padStart(2, '0')]));

/// Two-digit GST state code from a state name, a code, or a GSTIN. '' when unknown.
export const stateCode = (value = '') => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (/^\d{2}[a-z0-9]{13}$/i.test(raw)) return raw.slice(0, 2); // GSTIN
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, '0');
  const name = raw.replace(/\s+/g, ' ');
  return NAME_TO_CODE[name] || STATE_ALIASES[name] || '';
};

/// Intra-state (CGST+SGST) when the store's state equals the place of supply, else IGST.
/// Unknown destination state defaults to intra (sale at the counter).
export const supplyType = (storeState, placeOfSupply) => {
  const a = stateCode(storeState);
  const b = stateCode(placeOfSupply);
  if (!b || !a) return 'intra';
  return a === b ? 'intra' : 'inter';
};

// ---------- prices ----------

/// Retail: product.price. Wholesale: highest tier whose min_qty <= qty, else retail price.
export const unitPriceFor = (product, qty, type = 'retail') => {
  if (type === 'wholesale' && Array.isArray(product.wholesale_tiers) && product.wholesale_tiers.length) {
    const tier = [...product.wholesale_tiers]
      .filter((t) => Number(qty) >= Number(t.min_qty))
      .sort((x, y) => y.min_qty - x.min_qty)[0];
    if (tier) return round2(tier.price);
  }
  return round2(product.price);
};

/// One order line, with the tax split for the given supply type.
export const computeLine = ({ product, qty, unitPrice, discount = 0, supply = 'intra' }) => {
  const quantity = Number(qty);
  if (!Number.isInteger(quantity) || quantity < 1) throw new ApiError(400, `Invalid quantity for ${product.sku || product.name}`);
  const price = round2(unitPrice ?? product.price);
  const rate = Number(product.gst_rate) || 0;
  const gross = round2(price * quantity - (Number(discount) || 0));
  if (gross < 0) throw new ApiError(400, `Discount exceeds line value for ${product.sku || product.name}`);
  const inclusive = product.tax_inclusive !== false;
  const taxable = inclusive ? round2((gross * 100) / (100 + rate)) : gross;
  const tax = inclusive ? round2(gross - taxable) : round2((taxable * rate) / 100);
  const cgst = supply === 'intra' ? round2(tax / 2) : 0;
  const sgst = supply === 'intra' ? round2(tax - cgst) : 0;
  const igst = supply === 'intra' ? 0 : tax;
  return {
    product_id: product._id,
    sku: product.sku,
    name: product.variant_label ? `${product.name} (${product.variant_label})` : product.name,
    hsn: product.hsn || '',
    unit: product.unit || 'pcs',
    qty: quantity,
    unit_price: price,
    tax_inclusive: inclusive,
    mrp: round2(product.mrp || 0),
    discount: round2(discount),
    gst_rate: rate,
    taxable_value: taxable,
    cgst,
    sgst,
    igst,
    total: round2(taxable + tax),
    weight_kg: round2((Number(product.weight_kg) || 0) * quantity),
  };
};

/// Order totals; grand total is rounded to the rupee with an explicit round_off line.
export const computeTotals = (lines, { shipping = 0, supply = 'intra' } = {}) => {
  const sum = (key) => round2(lines.reduce((acc, l) => acc + (Number(l[key]) || 0), 0));
  const subtotal = sum('taxable_value');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  const tax = round2(cgst + sgst + igst);
  const ship = round2(shipping);
  const pre = round2(subtotal + tax + ship);
  const grand = Math.round(pre);
  return {
    supply_type: supply,
    subtotal,
    discount: sum('discount'),
    cgst,
    sgst,
    igst,
    tax,
    shipping: ship,
    round_off: round2(grand - pre),
    grand_total: grand,
  };
};

/// Prices a basket. items: [{ product_id, qty, unit_price?, discount? }]; productsById: Map<string, product>.
/// unit_price overrides are honoured only when allowOverride (staff-entered orders).
export const priceOrder = ({ items, productsById, type = 'retail', storeState, placeOfSupply, shipping = 0, allowOverride = false }) => {
  const supply = supplyType(storeState, placeOfSupply);
  const lines = items.map((item) => {
    const product = productsById.get(String(item.product_id));
    if (!product) throw new ApiError(400, `Unknown product ${item.product_id}`);
    const override = allowOverride && item.unit_price !== undefined && item.unit_price !== null && item.unit_price !== '';
    const unitPrice = override ? Number(item.unit_price) : unitPriceFor(product, item.qty, type);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError(400, `Invalid price for ${product.sku}`);
    return computeLine({ product, qty: item.qty, unitPrice, discount: allowOverride ? item.discount : 0, supply });
  });
  return { lines, totals: computeTotals(lines, { shipping, supply }) };
};

/// Indian financial year label for a date, e.g. 2025-11-19 -> "2526" (Apr-Mar, IST).
export const financialYear = (date = new Date()) => {
  const ist = new Date(new Date(date).getTime() + 330 * 60000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
};
