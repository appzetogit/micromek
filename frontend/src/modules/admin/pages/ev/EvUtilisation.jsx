import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Activity, Clock, Download, Gauge, Route } from 'lucide-react';
import {
  Button, Card, DataTable, PageShell, StatCard, StatGrid, Toolbar,
  downloadFile, errorMessage, isoDay, num, pct, useAction, useApi,
} from '../platform/kit';
import { evUtilisationCsvPath, getEvUtilisation } from '../../services/evApi';
import { DateRange, rangeParams } from './evShared';

const TOTAL_ID = '__totals';

const EvUtilisation = () => {
  const [range, setRange] = useState({ from: isoDay(30), to: isoDay(0) });
  const params = rangeParams(range.from, range.to);
  const { data, loading, error } = useApi(() => getEvUtilisation(params), [range]);
  const [download, downloading] = useAction(
    () => downloadFile(evUtilisationCsvPath(params), `ev-utilisation-${range.from}-${range.to}.csv`),
    { onSuccess: () => toast.success('CSV downloaded'), onError: (err) => toast.error(errorMessage(err, 'Download failed')) },
  );

  const totals = data?.totals;
  const items = data?.items || [];
  const rows = items.length && totals
    ? [...items, { ...totals, vehicle_id: TOTAL_ID, registration_no: 'Total', utilisation_pct: totals.avg_utilisation_pct }]
    : items;
  const isTotal = (r) => r.vehicle_id === TOTAL_ID;
  const bold = (r, v) => (isTotal(r) ? <span className="font-semibold text-gray-900">{v}</span> : v);

  const columns = [
    { key: 'registration_no', label: 'Vehicle', render: (r) => (isTotal(r) ? bold(r, `Total (${num(r.vehicles)} vehicles)`) : (
      <div>
        <Link to={`/admin/ev/vehicles/${r.vehicle_id}`} className="font-medium text-indigo-600 hover:underline">{r.registration_no}</Link>
        <p className="text-xs text-gray-400">{[r.make, r.model].filter(Boolean).join(' ')}</p>
      </div>
    )) },
    { key: 'trips', label: 'Trips', align: 'right', render: (r) => bold(r, num(r.trips)) },
    { key: 'distance_km', label: 'Distance', align: 'right', render: (r) => bold(r, `${num(r.distance_km, 1)} km`) },
    { key: 'active_hours', label: 'Active hours', align: 'right', render: (r) => bold(r, num(r.active_hours, 1)) },
    { key: 'utilisation_pct', label: 'Utilisation', align: 'right', render: (r) => bold(r, isTotal(r) ? `${pct(r.utilisation_pct, 1)} avg` : pct(r.utilisation_pct, 1)) },
    { key: 'avg_speed_kmh', label: 'Avg speed', align: 'right', render: (r) => (isTotal(r) ? '' : `${num(r.avg_speed_kmh, 1)} km/h`) },
    { key: 'energy_used_pct', label: 'Energy (SOC %)', align: 'right', render: (r) => bold(r, pct(r.energy_used_pct, 1)) },
    { key: 'energy_used_kwh', label: 'Energy (kWh)', align: 'right', render: (r) => bold(r, r.energy_used_kwh ? num(r.energy_used_kwh, 2) : '—') },
    { key: 'km_per_soc_pct', label: 'km per % SOC', align: 'right', render: (r) => bold(r, num(r.km_per_soc_pct, 2)) },
  ];

  return (
    <PageShell
      module="EV Fleet"
      page="Utilisation"
      title="EV Utilisation"
      right={<Button variant="secondary" icon={Download} busy={downloading} disabled={!items.length} onClick={() => download()}>Download CSV</Button>}
    >
      <StatGrid>
        <StatCard label="Trips" value={totals ? num(totals.trips) : '…'} icon={Route} />
        <StatCard label="Distance" value={totals ? `${num(totals.distance_km, 1)} km` : '…'} icon={Activity} tone="blue" />
        <StatCard label="Active hours" value={totals ? num(totals.active_hours, 1) : '…'} hint={totals ? `${pct(totals.avg_utilisation_pct, 1)} average utilisation` : null} icon={Clock} tone="green" />
        <StatCard label="km per % SOC" value={totals ? num(totals.km_per_soc_pct, 2) : '…'} hint={totals ? `${pct(totals.energy_used_pct, 1)} SOC used in total` : null} icon={Gauge} tone="amber" />
      </StatGrid>
      <Card title="Per vehicle" subtitle="Completed trips that started in the period" bodyClassName="">
        <Toolbar>
          <DateRange from={range.from} to={range.to} onChange={setRange} />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          empty="No EV vehicles"
          rowKey={(r) => r.vehicle_id}
        />
      </Card>
    </PageShell>
  );
};

export default EvUtilisation;
