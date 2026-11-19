import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, Landmark, Loader2, MapPin, Percent, Save, Search } from 'lucide-react';
import {
  Button, Card, Field, Input, Notice, PageShell, Select, Textarea, errorMessage, inputClass, useAction, useApi,
} from '../platform/kit';
import {
  createFranchise, getFranchise, listServiceLocations, listZones, updateFranchise,
} from '../../services/franchiseApi';
import {
  BUSINESS_TYPES, MODULE, SETTLEMENT_CYCLES, SHARE_TYPES, TRANSPORT_TYPES, refId, territoryConflict,
} from './franchiseHelpers';
import { TerritoryConflict } from './FranchiseParts';

const emptyRule = () => ({ type: 'percent_of_commission', value: 0 });

const blankForm = () => ({
  name: '', code: '', business_type: 'mobility', contact_name: '', mobile: '', email: '', password: '',
  address: '', city: '', state: '', pincode: '', gst_number: '', pan_number: '',
  bank: { account_name: '', account_number: '', ifsc: '', bank_name: '', upi_id: '' },
  service_location_ids: [], zone_ids: [],
  commission: {
    default: emptyRule(),
    overrides: Object.fromEntries(TRANSPORT_TYPES.map((t) => [t, { enabled: false, ...emptyRule() }])),
  },
  settlement_cycle: 'monthly', contract_start: '', contract_end: '', status: 'approved',
});

const day = (d) => (d ? String(d).slice(0, 10) : '');

/** Franchise document from the API → form state. */
const toForm = (f) => {
  const base = blankForm();
  const byType = f.commission?.by_transport_type || {};
  return {
    ...base,
    ...Object.fromEntries(Object.keys(base).filter((k) => typeof base[k] === 'string' && f[k] != null).map((k) => [k, f[k]])),
    password: '',
    bank: { ...base.bank, ...(f.bank || {}) },
    service_location_ids: (f.service_location_ids || []).map((x) => String(refId(x))),
    zone_ids: (f.zone_ids || []).map((x) => String(refId(x))),
    commission: {
      default: { ...emptyRule(), ...(f.commission?.default || {}) },
      overrides: Object.fromEntries(TRANSPORT_TYPES.map((t) => [
        t, byType[t] ? { enabled: true, ...byType[t] } : { enabled: false, ...emptyRule() },
      ])),
    },
    contract_start: day(f.contract_start),
    contract_end: day(f.contract_end),
  };
};

/** Form state → request body. */
const toBody = (form, isEdit) => {
  const { commission, password, code, status, contract_start: cs, contract_end: ce, ...rest } = form;
  const body = {
    ...rest,
    contract_start: cs || null,
    contract_end: ce || null,
    commission: {
      default: { type: commission.default.type, value: Number(commission.default.value) },
      by_transport_type: Object.fromEntries(
        Object.entries(commission.overrides)
          .filter(([, r]) => r.enabled)
          .map(([t, r]) => [t, { type: r.type, value: Number(r.value) }]),
      ),
    },
  };
  if (password) body.password = password;
  if (!isEdit) {
    if (code.trim()) body.code = code.trim();
    body.status = status;
  }
  return body;
};

const validate = (form, isEdit) => {
  for (const [key, label] of [['name', 'Name'], ['contact_name', 'Contact name'], ['mobile', 'Mobile'], ['email', 'Email']]) {
    if (!String(form[key]).trim()) return `${label} is required`;
  }
  if (!isEdit && !form.password) return 'Password is required';
  if (form.password && form.password.length < 8) return 'Password must be at least 8 characters';
  const rules = [form.commission.default, ...Object.values(form.commission.overrides).filter((r) => r.enabled)];
  if (rules.some((r) => r.value === '' || Number(r.value) < 0 || Number(r.value) > 100)) {
    return 'Commission values must be between 0 and 100';
  }
  if (form.contract_start && form.contract_end && form.contract_end < form.contract_start) {
    return 'Contract end must be after contract start';
  }
  return null;
};

/** Searchable checkbox list for multi-select. */
const CheckList = ({ items, selected, onChange, loading, error, empty }) => {
  const [query, setQuery] = useState('');
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="relative border-b border-gray-100">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className="w-full pl-8 pr-3 py-2 text-sm outline-none rounded-t-lg" />
      </div>
      <div className="max-h-52 overflow-y-auto p-2 space-y-0.5">
        {loading ? <p className="p-2 text-sm text-gray-400"><Loader2 size={14} className="inline animate-spin mr-2" />Loading…</p> : null}
        {error ? <p className="p-2 text-sm text-red-600">{error}</p> : null}
        {!loading && !error && !shown.length ? <p className="p-2 text-sm text-gray-400">{empty}</p> : null}
        {shown.map((i) => (
          <label key={i.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
            <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} className="accent-indigo-600" />
            <span className="text-gray-800 truncate">{i.label}</span>
            {i.hint ? <span className="text-xs text-gray-400 truncate">{i.hint}</span> : null}
          </label>
        ))}
      </div>
      <p className="px-3 py-1.5 border-t border-gray-100 text-[11px] text-gray-400">{selected.length} selected</p>
    </div>
  );
};

const RuleInputs = ({ rule, onChange, disabled }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
    <Select value={rule.type} options={SHARE_TYPES} disabled={disabled} onChange={(e) => onChange({ ...rule, type: e.target.value })} />
    <div className="relative">
      <Input type="number" min={0} max={100} step="0.01" value={rule.value} disabled={disabled} onChange={(e) => onChange({ ...rule, value: e.target.value })} className="pr-8" />
      <Percent size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
    </div>
  </div>
);

const FranchiseFormBody = ({ id, initial }) => {
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const [formError, setFormError] = useState(null);
  const [conflict, setConflict] = useState(null);

  const locations = useApi(listServiceLocations, []);
  const zones = useApi(listZones, []);

  const locationItems = useMemo(
    () => (Array.isArray(locations.data) ? locations.data : locations.data?.results || [])
      .map((l) => ({ id: String(l._id), label: l.name || l.service_location_name })),
    [locations.data],
  );
  const zoneItems = useMemo(() => {
    const cityName = Object.fromEntries(locationItems.map((l) => [l.id, l.label]));
    return (zones.data?.results || []).map((z) => ({
      id: String(z._id), label: z.name, hint: cityName[String(z.service_location_id)] || '',
    }));
  }, [zones.data, locationItems]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setBank = (key) => (e) => setForm((f) => ({ ...f, bank: { ...f.bank, [key]: e.target.value } }));
  const setDefaultRule = (rule) => setForm((f) => ({ ...f, commission: { ...f.commission, default: rule } }));
  const setOverride = (type, rule) => setForm((f) => ({
    ...f, commission: { ...f.commission, overrides: { ...f.commission.overrides, [type]: rule } },
  }));

  const [save, saving] = useAction(
    () => (isEdit ? updateFranchise(id, toBody(form, true)) : createFranchise(toBody(form, false))),
    {
      onSuccess: (res) => {
        toast.success(isEdit ? 'Franchise updated' : 'Franchise created');
        navigate(`/admin/franchises/${isEdit ? id : res.data._id}`);
      },
      onError: (err) => {
        const taken = territoryConflict(err);
        if (taken) setConflict(taken);
        else setFormError(errorMessage(err));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    },
  );

  const submit = (e) => {
    e.preventDefault();
    setConflict(null);
    const problem = validate(form, isEdit);
    setFormError(problem);
    if (problem) window.scrollTo({ top: 0, behavior: 'smooth' });
    else save();
  };

  const backTo = isEdit ? `/admin/franchises/${id}` : '/admin/franchises';

  return (
    <PageShell module={MODULE} page={isEdit ? 'Edit franchise' : 'New franchise'} backTo={backTo}>
      <form onSubmit={submit} className="space-y-6">
        {conflict ? <TerritoryConflict franchises={conflict} /> : null}
        {formError ? <Notice tone="red">{formError}</Notice> : null}

        <Card title="Profile" subtitle="Business and contact details" icon={Building2}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Franchise name *"><Input value={form.name} onChange={set('name')} /></Field>
            <Field label="Code" hint={isEdit ? 'Codes cannot be changed' : 'Leave blank to generate one'}>
              <Input value={form.code} onChange={set('code')} disabled={isEdit} className="uppercase" />
            </Field>
            <Field label="Business type"><Select value={form.business_type} onChange={set('business_type')} options={BUSINESS_TYPES} /></Field>
            <Field label="Contact name *"><Input value={form.contact_name} onChange={set('contact_name')} /></Field>
            <Field label="Mobile *"><Input value={form.mobile} onChange={set('mobile')} inputMode="tel" /></Field>
            <Field label="Email *"><Input type="email" value={form.email} onChange={set('email')} /></Field>
            <Field label={isEdit ? 'New password' : 'Password *'} hint={isEdit ? 'Leave blank to keep the current password' : 'At least 8 characters'}>
              <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </Field>
            {!isEdit ? (
              <Field label="Initial status">
                <Select value={form.status} onChange={set('status')} options={['approved', 'pending']} />
              </Field>
            ) : null}
            <Field label="Address" className="md:col-span-2"><Textarea rows={2} value={form.address} onChange={set('address')} /></Field>
            <Field label="City"><Input value={form.city} onChange={set('city')} /></Field>
            <Field label="State"><Input value={form.state} onChange={set('state')} /></Field>
            <Field label="Pincode"><Input value={form.pincode} onChange={set('pincode')} /></Field>
            <Field label="GST number"><Input value={form.gst_number} onChange={set('gst_number')} className="uppercase" /></Field>
            <Field label="PAN number"><Input value={form.pan_number} onChange={set('pan_number')} className="uppercase" /></Field>
          </div>
        </Card>

        <Card title="Territory" subtitle="A city, or individual zones. Each territory belongs to one franchise." icon={MapPin}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <span className="block text-xs font-semibold text-gray-500 mb-1.5">Service locations (cities)</span>
              <CheckList
                items={locationItems}
                selected={form.service_location_ids}
                onChange={(v) => setForm((f) => ({ ...f, service_location_ids: v }))}
                loading={locations.loading}
                error={locations.error}
                empty="No service locations"
              />
            </div>
            <div>
              <span className="block text-xs font-semibold text-gray-500 mb-1.5">Zones</span>
              <CheckList
                items={zoneItems}
                selected={form.zone_ids}
                onChange={(v) => setForm((f) => ({ ...f, zone_ids: v }))}
                loading={zones.loading}
                error={zones.error}
                empty="No zones"
              />
            </div>
          </div>
        </Card>

        <Card title="Commission & settlement" subtitle="Franchise share of each completed ride" icon={Percent}>
          <div className="space-y-5">
            <Field label="Default rule"><RuleInputs rule={form.commission.default} onChange={setDefaultRule} /></Field>
            <div className="space-y-3">
              <span className="block text-xs font-semibold text-gray-500">Per transport type (falls back to default)</span>
              {TRANSPORT_TYPES.map((t) => {
                const rule = form.commission.overrides[t];
                return (
                  <div key={t} className="grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-3 items-center">
                    <label className="flex items-center gap-2 text-sm text-gray-700 capitalize cursor-pointer">
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => setOverride(t, { ...rule, enabled: e.target.checked })} className="accent-indigo-600" />
                      {t}
                    </label>
                    <RuleInputs rule={rule} disabled={!rule.enabled} onChange={(r) => setOverride(t, r)} />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 border-t border-gray-100">
              <Field label="Settlement cycle"><Select value={form.settlement_cycle} onChange={set('settlement_cycle')} options={SETTLEMENT_CYCLES} /></Field>
              <Field label="Contract start"><input type="date" value={form.contract_start} onChange={set('contract_start')} className={inputClass} /></Field>
              <Field label="Contract end"><input type="date" value={form.contract_end} min={form.contract_start || undefined} onChange={set('contract_end')} className={inputClass} /></Field>
            </div>
          </div>
        </Card>

        <Card title="Bank details" subtitle="Used for settlement payouts" icon={Landmark}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Account name"><Input value={form.bank.account_name} onChange={setBank('account_name')} /></Field>
            <Field label="Account number"><Input value={form.bank.account_number} onChange={setBank('account_number')} /></Field>
            <Field label="IFSC"><Input value={form.bank.ifsc} onChange={setBank('ifsc')} className="uppercase" /></Field>
            <Field label="Bank name"><Input value={form.bank.bank_name} onChange={setBank('bank_name')} /></Field>
            <Field label="UPI ID"><Input value={form.bank.upi_id} onChange={setBank('upi_id')} /></Field>
          </div>
        </Card>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate(backTo)}>Cancel</Button>
          <Button type="submit" icon={Save} busy={saving}>{isEdit ? 'Save changes' : 'Create franchise'}</Button>
        </div>
      </form>
    </PageShell>
  );
};

/** Loads the franchise when editing, then mounts the form with it. */
const FranchiseForm = () => {
  const { id } = useParams();
  const existing = useApi(() => (id ? getFranchise(id) : Promise.resolve({ data: null })), [id]);
  if (!id) return <FranchiseFormBody key="new" initial={blankForm()} />;
  if (existing.data?.franchise) {
    return <FranchiseFormBody key={id} id={id} initial={toForm(existing.data.franchise)} />;
  }
  return (
    <PageShell module={MODULE} page="Edit franchise" backTo={`/admin/franchises/${id}`}>
      {existing.error
        ? <Notice tone="red">{existing.error}</Notice>
        : <p className="text-sm text-gray-400"><Loader2 size={16} className="inline animate-spin mr-2" />Loading…</p>}
    </PageShell>
  );
};

export default FranchiseForm;
