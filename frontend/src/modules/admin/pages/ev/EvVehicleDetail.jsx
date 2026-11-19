import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, BatteryCharging, LineChart as ChartIcon, Pencil, Route, Trash2 } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, KeyValue, Modal, Notice, PageShell, Pager, Select, StatusBadge, Textarea, Toolbar,
  dateTime, errorMessage, isoDay, num, pct, timeAgo, useAction, useApi,
} from '../platform/kit';
import { deleteEvVehicle, getEvTelemetry, getEvVehicle, listEvAlerts, updateEvVehicle } from '../../services/evApi';
import { DateRange, FranchiseSelect, LineChart, LinkPicker, VEHICLE_STATUSES, linkLabel, rangeParams, refId } from './evShared';

const BUCKETS = [
  { value: 'auto', label: 'Auto' },
  { value: 'raw', label: 'Raw points' },
  { value: '5', label: '5 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: '1440', label: '1 day' },
];

const NotSupported = () => <span className="text-gray-400">not supported</span>;

const onError = (err) => toast.error(errorMessage(err));

const formOf = (v) => ({
  status: v.status,
  low_battery_threshold_pct: String(v.low_battery_threshold_pct ?? 20),
  make: v.make || '',
  model: v.model || '',
  battery_capacity_kwh: v.battery_capacity_kwh ?? '',
  franchise_id: refId(v.franchise_id),
  driver_id: refId(v.driver_id),
  fleet_vehicle_id: refId(v.fleet_vehicle_id),
  service_location_id: refId(v.service_location_id),
  notes: v.notes || '',
});

const LINK_TYPES = [['driver', 'driver_id'], ['fleet_vehicle', 'fleet_vehicle_id'], ['service_location', 'service_location_id']];

const EditModal = ({ vehicle, onClose, onSaved }) => {
  const [form, setForm] = useState(() => formOf(vehicle));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [save, saving] = useAction(
    () => updateEvVehicle(vehicle._id, {
      ...form,
      low_battery_threshold_pct: Number(form.low_battery_threshold_pct),
      battery_capacity_kwh: form.battery_capacity_kwh === '' ? null : Number(form.battery_capacity_kwh),
      make: form.make.trim(),
      model: form.model.trim(),
      // Empty link ids (picker cleared) clear the link on the backend.
      driver_id: form.driver_id || null,
      fleet_vehicle_id: form.fleet_vehicle_id || null,
      service_location_id: form.service_location_id || null,
    }),
    { onSuccess: () => { toast.success('Vehicle updated'); onSaved(); }, onError },
  );
  return (
    <Modal
      open
      wide
      title={`Edit ${vehicle.registration_no}`}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={saving} onClick={() => save()}>Save changes</Button></>}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Status"><Select value={form.status} onChange={set('status')} options={VEHICLE_STATUSES} /></Field>
        <Field label="Low battery threshold (%)" hint="1–99"><Input type="number" min="1" max="99" value={form.low_battery_threshold_pct} onChange={set('low_battery_threshold_pct')} /></Field>
        <Field label="Make"><Input value={form.make} onChange={set('make')} /></Field>
        <Field label="Model"><Input value={form.model} onChange={set('model')} /></Field>
        <Field label="Battery capacity (kWh)"><Input type="number" min="0" step="0.1" value={form.battery_capacity_kwh} onChange={set('battery_capacity_kwh')} /></Field>
        <Field label="Franchise"><FranchiseSelect value={form.franchise_id} onChange={(v) => setForm((f) => ({ ...f, franchise_id: v }))} /></Field>
        {LINK_TYPES.map(([type, key]) => (
          <LinkPicker
            key={key}
            type={type}
            value={form[key]}
            initialLabel={linkLabel(type, vehicle[key])}
            onChange={(id) => setForm((f) => ({ ...f, [key]: id }))}
          />
        ))}
      </div>
      <Field label="Notes"><Textarea value={form.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
};

const TelemetryCard = ({ id, capabilities }) => {
  const [range, setRange] = useState({ from: isoDay(1), to: isoDay(0) });
  const [bucket, setBucket] = useState('auto');
  const { data, loading, error } = useApi(
    () => getEvTelemetry(id, { ...rangeParams(range.from, range.to), bucket }),
    [id, range, bucket],
  );
  const points = data?.points || [];
  return (
    <Card
      title="Telemetry history"
      subtitle={data ? `${num(points.length)} points${data.bucket_minutes ? ` · ${data.bucket_minutes}-minute averages` : ' · raw'}` : 'SOC and speed over time'}
      icon={ChartIcon}
      bodyClassName=""
    >
      <Toolbar>
        <DateRange from={range.from} to={range.to} onChange={setRange} />
        <Field label="Bucket" className="w-40"><Select value={bucket} onChange={(e) => setBucket(e.target.value)} options={BUCKETS} /></Field>
      </Toolbar>
      <div className="p-5 space-y-6">
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {loading && !data ? <p className="text-sm text-gray-400">Loading…</p> : null}
        {data?.truncated ? <Notice>Only the first 5,000 points are shown; pick a larger bucket or a shorter range.</Notice> : null}
        {data && !error ? (
          <>
            {capabilities.soc === false ? <p className="text-sm text-gray-400">SOC is not supported by this provider.</p> : (
              <LineChart points={points} field="soc_pct" label="State of charge" unit="%" color="#059669" yMax={100} />
            )}
            {capabilities.gps === false ? <p className="text-sm text-gray-400">Speed is not supported by this provider.</p> : (
              <LineChart points={points} field="speed_kmh" label="Speed" unit=" km/h" color="#2563eb" />
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
};

const AlertsCard = ({ id }) => {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi(() => listEvAlerts({ vehicle_id: id, page, limit: 10 }), [id, page]);
  const columns = [
    { key: 'type', label: 'Type', render: (a) => <span className="capitalize">{a.type.replace(/_/g, ' ')}</span> },
    { key: 'severity', label: 'Severity', render: (a) => <StatusBadge status={a.severity} /> },
    { key: 'message', label: 'Message', render: (a) => <span className="text-xs">{a.message || '—'}</span> },
    { key: 'status', label: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'raised_at', label: 'Raised', render: (a) => dateTime(a.raised_at) },
  ];
  return (
    <Card title="Alerts" subtitle="All alerts for this vehicle, live first" icon={AlertTriangle} bodyClassName="">
      <DataTable columns={columns} rows={data?.items || []} loading={loading} error={error} empty="No alerts for this vehicle" />
      <Pager data={data} onPage={setPage} />
    </Card>
  );
};

const tripColumns = [
  { key: 'started_at', label: 'Started', render: (t) => dateTime(t.started_at) },
  { key: 'ended_at', label: 'Ended', render: (t) => dateTime(t.ended_at) },
  { key: 'distance_km', label: 'Distance', align: 'right', render: (t) => `${num(t.distance_km, 2)} km` },
  { key: 'duration_minutes', label: 'Duration', align: 'right', render: (t) => `${num(t.duration_minutes)} min` },
  { key: 'energy_used_pct', label: 'SOC used', align: 'right', render: (t) => pct(t.energy_used_pct, 1) },
  { key: 'max_speed_kmh', label: 'Max speed', align: 'right', render: (t) => `${num(t.max_speed_kmh)} km/h` },
];

const EvVehicleDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(() => getEvVehicle(id), [id]);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remove, removing] = useAction(() => deleteEvVehicle(id), {
    onSuccess: () => { toast.success('Vehicle deleted'); navigate('/admin/ev/vehicles'); },
    onError,
  });

  if (!data) {
    return (
      <PageShell module="EV Fleet" page="Vehicle" title="EV Vehicle" backTo="/admin/ev/vehicles">
        {error ? <Notice tone="red">{error}</Notice> : <p className="text-sm text-gray-400">{loading ? 'Loading…' : 'Vehicle not found'}</p>}
      </PageShell>
    );
  }

  const { vehicle, online, capabilities = {}, open_trip: openTrip, recent_trips: recentTrips = [] } = data;
  const t = vehicle.last_telemetry || {};
  const gated = (cap, value) => (capabilities[cap] === false ? <NotSupported /> : value);
  const loc = t.location;

  return (
    <PageShell
      module="EV Fleet"
      page="Vehicle"
      title={vehicle.registration_no}
      backTo="/admin/ev/vehicles"
      right={
        <>
          <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete</Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-6 text-sm text-gray-500">
        <StatusBadge status={vehicle.status} />
        <StatusBadge status={online ? 'online' : 'offline'} />
        {openTrip ? <StatusBadge tone="blue" label="on a trip" /> : null}
        <span>{[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}</span>
        <span>· {vehicle.provider} / {vehicle.external_id}</span>
        {vehicle.franchise_id?.name ? <span>· {vehicle.franchise_id.name}</span> : null}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <Card title="Last telemetry" subtitle={t.recorded_at ? `Recorded ${timeAgo(t.recorded_at)}` : 'No telemetry received yet'} icon={BatteryCharging} className="xl:col-span-2">
          <KeyValue
            items={[
              ['State of charge', gated('soc', pct(t.soc_pct, 1))],
              ['State of health', gated('soh', pct(t.soh_pct, 1))],
              ['Charging', gated('charging', <StatusBadge key="c" status={t.charging_state || 'unknown'} />)],
              ['Range', gated('range', t.range_km === null || t.range_km === undefined ? '—' : `${num(t.range_km)} km`)],
              ['Speed', gated('gps', t.speed_kmh === null || t.speed_kmh === undefined ? '—' : `${num(t.speed_kmh, 1)} km/h`)],
              ['Location', gated('gps', loc?.lat !== null && loc?.lat !== undefined ? `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}` : '—')],
              ['Odometer', gated('odometer', t.odometer_km === null || t.odometer_km === undefined ? '—' : `${num(t.odometer_km, 1)} km`)],
              ['Ignition', gated('ignition', t.ignition === null || t.ignition === undefined ? '—' : t.ignition ? 'On' : 'Off')],
              ['Vendor status', t.status || '—'],
              ['Recorded at', dateTime(t.recorded_at)],
            ]}
          />
        </Card>
        <Card title="Vehicle" subtitle="Registry details">
          <KeyValue
            items={[
              ['Battery capacity', vehicle.battery_capacity_kwh ? `${num(vehicle.battery_capacity_kwh, 1)} kWh` : '—'],
              ['Low battery threshold', pct(vehicle.low_battery_threshold_pct)],
              ['VIN', vehicle.vin || '—'],
              ['Driver', linkLabel('driver', vehicle.driver_id) || '—'],
              ['Fleet vehicle', linkLabel('fleet_vehicle', vehicle.fleet_vehicle_id) || '—'],
              ['Service location', linkLabel('service_location', vehicle.service_location_id) || '—'],
              ['Franchise', vehicle.franchise_id?.name || '—'],
              ['Notes', vehicle.notes || '—'],
            ]}
          />
        </Card>
      </div>

      <div className="space-y-6">
        <TelemetryCard id={id} capabilities={capabilities} />
        <Card title="Recent trips" subtitle={openTrip ? `Trip in progress since ${dateTime(openTrip.started_at)} · ${num(openTrip.distance_km, 2)} km so far` : 'Last 5 completed trips'} icon={Route} bodyClassName="">
          <DataTable columns={tripColumns} rows={recentTrips} empty="No completed trips yet" />
        </Card>
        <AlertsCard id={id} />
      </div>

      {editing ? (
        <EditModal vehicle={vehicle} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      ) : null}

      <Modal
        open={confirmDelete}
        title="Delete vehicle?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} busy={removing} onClick={() => remove()}>Delete vehicle</Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {vehicle.registration_no} will be removed from the fleet. Any open trip is closed, its live alerts are resolved and it
          stops being polled. This cannot be undone from the admin panel.
        </p>
      </Modal>
    </PageShell>
  );
};

export default EvVehicleDetail;
