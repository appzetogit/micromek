import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus, Search } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, Modal, PageShell, Pager, Select, StatusBadge, Toolbar,
  errorMessage, timeAgo, useAction, useApi, useDebounced,
} from '../platform/kit';
import { createEvVehicle, listEvVehicles } from '../../services/evApi';
import { FranchiseSelect, SocBar, VEHICLE_STATUSES } from './evShared';

const CONDITIONS = [
  { value: 'charging', label: 'Charging' },
  { value: 'low_battery', label: 'Low battery' },
];

const EMPTY = {
  registration_no: '', provider: '', external_id: '', make: '', model: '',
  battery_capacity_kwh: '', low_battery_threshold_pct: '20', franchise_id: '',
};

const AddVehicleModal = ({ open, onClose, onCreated }) => {
  const [form, setForm] = useState(EMPTY);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [save, saving] = useAction(
    () => {
      const body = {
        registration_no: form.registration_no.trim(),
        external_id: form.external_id.trim(),
        make: form.make.trim(),
        model: form.model.trim(),
        low_battery_threshold_pct: Number(form.low_battery_threshold_pct),
      };
      if (form.provider.trim()) body.provider = form.provider.trim();
      if (form.battery_capacity_kwh !== '') body.battery_capacity_kwh = Number(form.battery_capacity_kwh);
      if (form.franchise_id) body.franchise_id = form.franchise_id;
      return createEvVehicle(body);
    },
    {
      onSuccess: (res) => {
        toast.success(`Vehicle ${res?.data?.registration_no || ''} added`);
        setForm(EMPTY);
        onCreated(res?.data);
      },
      onError: (err) => toast.error(errorMessage(err)),
    },
  );
  const valid = form.registration_no.trim() && form.external_id.trim();

  return (
    <Modal
      open={open}
      title="Add EV vehicle"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={saving} disabled={!valid} onClick={() => save()}>Add vehicle</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Registration no *"><Input value={form.registration_no} onChange={set('registration_no')} placeholder="KA01AB1234" /></Field>
        <Field label="Provider id (external_id) *" hint="The vehicle's id at the telematics vendor"><Input value={form.external_id} onChange={set('external_id')} /></Field>
        <Field label="Provider" hint="Leave empty to use the active provider"><Input value={form.provider} onChange={set('provider')} placeholder="mock" /></Field>
        <Field label="Battery capacity (kWh)"><Input type="number" min="0" step="0.1" value={form.battery_capacity_kwh} onChange={set('battery_capacity_kwh')} /></Field>
        <Field label="Make"><Input value={form.make} onChange={set('make')} /></Field>
        <Field label="Model"><Input value={form.model} onChange={set('model')} /></Field>
        <Field label="Low battery threshold (%)" hint="1–99"><Input type="number" min="1" max="99" value={form.low_battery_threshold_pct} onChange={set('low_battery_threshold_pct')} /></Field>
        <Field label="Franchise"><FranchiseSelect value={form.franchise_id} onChange={(v) => setForm((f) => ({ ...f, franchise_id: v }))} /></Field>
      </div>
    </Modal>
  );
};

const EvVehicles = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: '', condition: '', franchise_id: '' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(search);
  const setFilter = (key) => (value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };

  const { data, loading, error, reload } = useApi(
    () => listEvVehicles({
      page,
      limit: 20,
      search: q,
      status: filters.status,
      franchise_id: filters.franchise_id,
      charging: filters.condition === 'charging' ? 'true' : undefined,
      low_battery: filters.condition === 'low_battery' ? 'true' : undefined,
    }),
    [page, q, filters],
  );

  const columns = [
    { key: 'registration_no', label: 'Vehicle', render: (v) => (
      <div>
        <Link to={`/admin/ev/vehicles/${v._id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-indigo-600 hover:underline">{v.registration_no}</Link>
        <p className="text-xs text-gray-400">{[v.make, v.model].filter(Boolean).join(' ') || '—'}</p>
      </div>
    ) },
    { key: 'provider', label: 'Provider', render: (v) => <div><p>{v.provider}</p><p className="text-xs text-gray-400">{v.external_id}</p></div> },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v.status} /> },
    { key: 'online', label: 'Link', render: (v) => <StatusBadge status={v.online ? 'online' : 'offline'} /> },
    { key: 'soc', label: 'SOC', render: (v) => <SocBar value={v.last_telemetry?.soc_pct} threshold={v.low_battery_threshold_pct} /> },
    { key: 'charging', label: 'Charging', render: (v) => <StatusBadge status={v.last_telemetry?.charging_state || 'unknown'} /> },
    { key: 'franchise', label: 'Franchise', render: (v) => v.franchise_id?.name || '—' },
    { key: 'last_seen', label: 'Last seen', render: (v) => timeAgo(v.last_telemetry?.recorded_at) },
  ];

  return (
    <PageShell
      module="EV Fleet"
      page="Vehicles"
      title="EV Vehicles"
      right={<Button icon={Plus} onClick={() => setAdding(true)}>Add vehicle</Button>}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-64">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Registration, VIN, make…" className="pl-8" />
            </div>
          </Field>
          <Field label="Status" className="w-full sm:w-40">
            <Select value={filters.status} onChange={(e) => setFilter('status')(e.target.value)} placeholder="All statuses" options={VEHICLE_STATUSES} />
          </Field>
          <Field label="Battery" className="w-full sm:w-40">
            <Select value={filters.condition} onChange={(e) => setFilter('condition')(e.target.value)} placeholder="Any" options={CONDITIONS} />
          </Field>
          <Field label="Franchise" className="w-full sm:w-56">
            <FranchiseSelect value={filters.franchise_id} onChange={setFilter('franchise_id')} placeholder="All franchises" />
          </Field>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No EV vehicles match these filters"
          onRowClick={(v) => navigate(`/admin/ev/vehicles/${v._id}`)}
        />
        <Pager data={data} onPage={setPage} />
      </Card>

      <AddVehicleModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(v) => { setAdding(false); if (v?._id) navigate(`/admin/ev/vehicles/${v._id}`); else reload(); }}
      />
    </PageShell>
  );
};

export default EvVehicles;
