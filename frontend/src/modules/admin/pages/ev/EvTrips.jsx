import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, DataTable, Field, KeyValue, Modal, PageShell, Pager, Select, StatusBadge, Toolbar,
  dateTime, isoDay, num, pct, useApi,
} from '../platform/kit';
import { getEvTrip, listEvTrips, listEvVehicles } from '../../services/evApi';
import { DateRange, RouteMap, rangeParams } from './evShared';

const TRIP_STATUSES = [{ value: 'completed', label: 'Completed' }, { value: 'open', label: 'In progress' }];

const km = (v, digits = 2) => (v === null || v === undefined ? '—' : `${num(v, digits)} km`);
const kmh = (v) => (v === null || v === undefined ? '—' : `${num(v, 1)} km/h`);

const TripModal = ({ id, onClose }) => {
  const { data, loading, error } = useApi(() => getEvTrip(id), [id]);
  const trip = data?.trip;
  return (
    <Modal open wide title={data?.vehicle ? `Trip · ${data.vehicle.registration_no}` : 'Trip'} onClose={onClose}>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading && !data ? <p className="text-sm text-gray-400">Loading…</p> : null}
      {trip ? (
        <>
          <KeyValue
            items={[
              ['Vehicle', <Link key="v" to={`/admin/ev/vehicles/${data.vehicle.id}`} className="text-indigo-600 hover:underline">{data.vehicle.registration_no}</Link>],
              ['Status', <StatusBadge key="s" status={trip.status} label={trip.status === 'open' ? 'in progress' : trip.status} />],
              ['Started', dateTime(trip.started_at)],
              ['Ended', dateTime(trip.ended_at)],
              ['Distance', km(trip.distance_km)],
              ['Duration', `${num(trip.duration_minutes)} min`],
              ['SOC', `${pct(trip.start_soc_pct, 1)} → ${pct(trip.end_soc_pct, 1)}`],
              ['SOC used', pct(trip.energy_used_pct, 1)],
              ['Energy used', trip.energy_used_kwh === null ? '—' : `${num(trip.energy_used_kwh, 2)} kWh`],
              ['Avg / max speed', `${kmh(trip.avg_speed_kmh)} / ${kmh(trip.max_speed_kmh)}`],
              ['Odometer', trip.start_odometer_km === null ? '—' : `${km(trip.start_odometer_km, 1)} → ${km(trip.end_odometer_km, 1)}`],
              ['Driver', trip.driver_id?.name || '—'],
            ]}
          />
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2">
              Route{data.route?.bucket_minutes ? ` (${data.route.bucket_minutes}-minute samples)` : ''}
            </p>
            <RouteMap points={data.route?.points} />
          </div>
        </>
      ) : null}
    </Modal>
  );
};

const EvTrips = () => {
  const [filters, setFilters] = useState({ vehicle_id: '', status: '', from: isoDay(7), to: isoDay(0) });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const update = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };

  const vehicles = useApi(() => listEvVehicles({ limit: 100 }), []);
  const { data, loading, error } = useApi(
    () => listEvTrips({
      vehicle_id: filters.vehicle_id,
      status: filters.status,
      ...rangeParams(filters.from, filters.to),
      page,
      limit: 20,
    }),
    [filters, page],
  );

  const columns = [
    { key: 'vehicle', label: 'Vehicle', render: (t) => (
      <div><p className="font-medium text-gray-900">{t.vehicle_id?.registration_no || '—'}</p><p className="text-xs text-gray-400">{[t.vehicle_id?.make, t.vehicle_id?.model].filter(Boolean).join(' ')}</p></div>
    ) },
    { key: 'started_at', label: 'Start', render: (t) => dateTime(t.started_at) },
    { key: 'ended_at', label: 'End', render: (t) => (t.status === 'open' ? <StatusBadge tone="blue" label="in progress" /> : dateTime(t.ended_at)) },
    { key: 'distance_km', label: 'Distance', align: 'right', render: (t) => km(t.distance_km) },
    { key: 'duration_minutes', label: 'Duration', align: 'right', render: (t) => `${num(t.duration_minutes)} min` },
    { key: 'energy_used_pct', label: 'SOC used', align: 'right', render: (t) => pct(t.energy_used_pct, 1) },
    { key: 'avg_speed_kmh', label: 'Avg speed', align: 'right', render: (t) => kmh(t.avg_speed_kmh) },
    { key: 'max_speed_kmh', label: 'Max speed', align: 'right', render: (t) => kmh(t.max_speed_kmh) },
  ];

  const vehicleOptions = (vehicles.data?.items || []).map((v) => ({ value: v._id, label: v.registration_no }));

  return (
    <PageShell module="EV Fleet" page="Trips" title="EV Trips">
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Vehicle" className="w-full sm:w-52">
            <Select
              value={filters.vehicle_id}
              onChange={(e) => update({ vehicle_id: e.target.value })}
              placeholder={vehicles.loading ? 'Loading…' : 'All vehicles'}
              options={vehicleOptions}
            />
          </Field>
          <Field label="Status" className="w-full sm:w-40">
            <Select value={filters.status} onChange={(e) => update({ status: e.target.value })} placeholder="All" options={TRIP_STATUSES} />
          </Field>
          <DateRange from={filters.from} to={filters.to} onChange={update} />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No trips in this period"
          onRowClick={(t) => setOpenId(t._id)}
        />
        <Pager data={data} onPage={setPage} />
      </Card>
      {openId ? <TripModal id={openId} onClose={() => setOpenId(null)} /> : null}
    </PageShell>
  );
};

export default EvTrips;
