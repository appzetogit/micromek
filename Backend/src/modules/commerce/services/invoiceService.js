import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { ApiError } from '../../../utils/ApiError.js';
import { nextSequence } from '../models/Counter.js';
import { CommerceInvoice } from '../models/Invoice.js';
import { CommerceOrder } from '../models/Order.js';
import { CommerceStore } from '../models/Store.js';
import { actorOf } from './accessService.js';
import { financialYear, stateCode } from './pricing.js';

/// GST tax invoices for commerce orders (retail and wholesale alike). The invoice
/// is a frozen copy of the order; the PDF is rendered from that copy on demand.

const ISSUABLE = ['placed', 'confirmed', 'packed', 'shipped', 'delivered'];

export const issueInvoice = async (req, order) => {
  if (order.invoice_id) {
    const existing = await CommerceInvoice.findById(order.invoice_id).lean();
    if (existing) return existing;
  }
  const already = await CommerceInvoice.findOne({ order_id: order._id }).lean();
  if (already) return already;
  if (!ISSUABLE.includes(order.status)) throw new ApiError(409, `Cannot invoice a ${order.status} order`);
  if (order.payment.method === 'online' && order.payment.status !== 'paid') throw new ApiError(409, 'Online payment not received yet');

  const store = await CommerceStore.findById(order.store_id).lean();
  const fy = financialYear();
  // Stores whose codes share a 5-char prefix share one series, so numbers stay unique.
  const prefix = store.code.slice(0, 5);
  const seq = await nextSequence(`invoice:${prefix}:${fy}`);
  const legalName = process.env.COMMERCE_LEGAL_NAME || store.name;
  const doc = {
    // GST rule 46: <= 16 chars, unique per financial year.
    number: `${prefix}/${fy}/${String(seq).padStart(5, '0')}`,
    order_id: order._id,
    order_number: order.number,
    store_id: order.store_id,
    franchise_id: order.franchise_id || null,
    customer_id: order.customer_id,
    type: order.type,
    issued_at: new Date(),
    seller: {
      legal_name: legalName,
      store_name: store.name,
      address: store.address || {},
      gstin: store.gstin || '',
      state_code: stateCode(store.gstin || store.address?.state),
      phone: store.phone || '',
      email: store.email || '',
    },
    buyer: {
      ...order.customer_snapshot,
      state_code: stateCode(order.customer_snapshot?.gstin || order.ship_to?.state || ''),
    },
    ship_to: order.ship_to || null,
    items: order.items,
    totals: order.totals,
    payment: { method: order.payment.method, status: order.payment.status, paid_amount: order.payment.paid_amount },
    issued_by: actorOf(req),
  };
  let invoice;
  try {
    invoice = (await CommerceInvoice.create(doc)).toObject();
  } catch (error) {
    // Two concurrent issues for the same order: the unique order_id index lets one win.
    if (error?.code === 11000) invoice = await CommerceInvoice.findOne({ order_id: order._id }).lean();
    if (!invoice) throw error;
  }
  await CommerceOrder.updateOne({ _id: order._id, invoice_id: null }, { $set: { invoice_id: invoice._id } });
  return invoice;
};

// ---------- PDF ----------

const FONT_CANDIDATES = [
  ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
];
const FONTS = (() => {
  for (const [regular, bold] of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(regular) && fs.existsSync(bold)) return { regular, bold, symbol: '₹' };
    } catch {
      // try next
    }
  }
  return { regular: 'Helvetica', bold: 'Helvetica-Bold', symbol: 'Rs. ' };
})();

const INK = '#191713';
const MUTED = '#6B6660';
const RULE = '#DDD9D2';
const money = (n) => `${FONTS.symbol}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const addr = (a = {}) => [a.line1, a.line2, [a.city, a.state, a.pincode].filter(Boolean).join(', ')].filter(Boolean).join('\n');

export const renderInvoicePdf = (inv) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 40;
    const width = doc.page.width - 80;
    const intra = inv.totals.supply_type !== 'inter';

    doc.font(FONTS.bold).fontSize(18).fillColor(INK).text('TAX INVOICE', left, 40);
    doc.font(FONTS.regular).fontSize(9).fillColor(MUTED)
      .text(`Invoice No. ${inv.number}`, left, 40, { width, align: 'right' })
      .text(`Date ${fmtDate(inv.issued_at)}`, left, 52, { width, align: 'right' })
      .text(`Order ${inv.order_number}`, left, 64, { width, align: 'right' });

    const col = width / 2 - 10;
    let y = 90;
    doc.font(FONTS.bold).fontSize(10).fillColor(INK).text(inv.seller.legal_name, left, y, { width: col });
    doc.font(FONTS.regular).fontSize(9).fillColor(MUTED)
      .text(`${inv.seller.store_name}\n${addr(inv.seller.address)}\nGSTIN: ${inv.seller.gstin || '-'}  State code: ${inv.seller.state_code || '-'}`, left, y + 14, { width: col });
    const bx = left + col + 20;
    doc.font(FONTS.bold).fontSize(10).fillColor(INK).text('Bill to', bx, y);
    doc.font(FONTS.regular).fontSize(9).fillColor(MUTED).text(
      [inv.buyer.business_name || inv.buyer.name, inv.buyer.business_name ? inv.buyer.name : '', inv.buyer.phone,
        inv.buyer.gstin ? `GSTIN: ${inv.buyer.gstin}` : '', inv.ship_to ? `Ship to:\n${addr(inv.ship_to)}` : '']
        .filter(Boolean).join('\n'),
      bx, y + 14, { width: col },
    );

    y = Math.max(doc.y, 170) + 16;
    const cols = intra
      ? [['#', 18], ['Item', 150], ['HSN', 48], ['Qty', 34], ['Rate', 58], ['Taxable', 62], ['GST%', 34], ['CGST', 46], ['SGST', 46]]
      : [['#', 18], ['Item', 170], ['HSN', 50], ['Qty', 36], ['Rate', 62], ['Taxable', 66], ['GST%', 36], ['IGST', 58]];
    const drawRow = (cells, bold = false) => {
      let x = left;
      doc.font(bold ? FONTS.bold : FONTS.regular).fontSize(8).fillColor(INK);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i][1] - 4 })));
      if (y + h > doc.page.height - 140) {
        doc.addPage();
        y = 40;
      }
      cells.forEach((c, i) => {
        doc.text(String(c), x + 2, y, { width: cols[i][1] - 4, align: i > 1 ? 'right' : 'left' });
        x += cols[i][1];
      });
      y += h + 6;
      doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor(RULE).lineWidth(0.5).stroke();
    };
    drawRow(cols.map((c) => c[0]), true);
    inv.items.forEach((it, i) => {
      const base = [i + 1, `${it.name}\n${it.sku}`, it.hsn || '-', `${it.qty} ${it.unit || ''}`, money(it.unit_price), money(it.taxable_value), it.gst_rate];
      drawRow(intra ? [...base, money(it.cgst), money(it.sgst)] : [...base, money(it.igst)]);
    });

    y += 6;
    const t = inv.totals;
    const rows = [
      ['Taxable value', t.subtotal],
      ...(intra ? [['CGST', t.cgst], ['SGST', t.sgst]] : [['IGST', t.igst]]),
      ...(t.shipping ? [['Shipping', t.shipping]] : []),
      ...(t.round_off ? [['Round off', t.round_off]] : []),
    ];
    for (const [label, value] of rows) {
      doc.font(FONTS.regular).fontSize(9).fillColor(MUTED).text(label, left + width - 220, y, { width: 110 });
      doc.fillColor(INK).text(money(value), left + width - 110, y, { width: 110, align: 'right' });
      y += 14;
    }
    doc.font(FONTS.bold).fontSize(11).fillColor(INK).text('Total', left + width - 220, y + 4, { width: 110 });
    doc.text(money(t.grand_total), left + width - 110, y + 4, { width: 110, align: 'right' });
    y += 30;
    doc.font(FONTS.regular).fontSize(8).fillColor(MUTED)
      .text(`Payment: ${inv.payment.method} (${inv.payment.status}). Place of supply: ${intra ? 'intra-state' : 'inter-state'}.`, left, y, { width })
      .text('This is a computer-generated invoice.', left, y + 12, { width });
    doc.end();
  });
