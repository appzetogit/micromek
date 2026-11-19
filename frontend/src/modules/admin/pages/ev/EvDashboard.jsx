import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity, AlertTriangle, BatteryCharging, BatteryLow, BatteryMedium, Car, HeartPulse, Map as MapIcon,
  Navigation, RefreshCw, Server, Wifi, WifiOff,
} from 'lucide-react';
import {
  Button, Card, DataTable, KeyValue, Notice, PageShell, StatCard, StatGrid, StatusBadge,
  dateTime, errorMessage, num, pct, timeAgo, useAction, useApi,
} from '../platform/kit';
import { getEvDashboard, getEvProvider, pollEvNow, syncEvVehicles } from '../../services/evApi';
import { FleetMap, MAP_AVAILABLE, STATE_STYLE, SocBar, StateLegend, vehicleState } from './evShared';

const REFRESH_MS = 30000;

const ProviderCard = ({ data, loading, error, onChanged }) => {
  const [poll, polling] = useAction(pollEvNow, {
    onSuccess: (body) => {
      const s = body?.data || {};
      if (s.skipped) toast.error(`Poll skipped: ${s.reason}`);
      else toast.success(`Polled ${num(s.vehicles)} vehicles · ${num(s.written)} points written`);
      onChanged();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const [sync, syncing] = useAction(() => syncEvVehicles(), {
    onSuccess: (body) => {
      const s = body?.data || {};
      toast.success(`Sync: ${num(s.created)} created, ${num(s.updated)} updated, ${num(s.unchanged)} unchanged`);
      if (s.errors?.length) toast.error(`${s.errors.length} vehicles failed to sync`);
      onChanged();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const provider = data?.provider;
  const ingest = data?.ingest || {};
  const last = ingest.last_run;
  const caps = Object.entries(provider?.capabilities || {});

  return (
    <Card
      title="Telematics provider"
      subtitle={provider ? provider.name : 'Status'}
      icon={Server}
      right={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={RefreshCw} busy={polling} disabled={!provider?.enabled} onClick={() => poll()}>Poll now</Button>
          <Button variant="secondary" icon={Car} busy={syncing} disabled={!provider?.enabled} onClick={() => sync()}>Sync vehicles</Button>
        </div>
      }
    >
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!provider && loading ? <p className="text-sm text-gray-400">Loading…</p> : null}
      {provider ? (
        <div className="space-y-4">
          {!provider.enabled ? (
            <Notice tone="red">Provider disabled: {provider.disabled_reason || 'no reason given'}</Notice>
          ) : null}
          <KeyValue
            items={[
              ['Provider', <span key="p" className="inline-flex items-center gap-2">{provider.name}<StatusBadge status={provider.enabled ? 'active' : 'inactive'} label={provider.enabled ? 'enabled' : 'disabled'} /></span>],
              ['Vehicles on provider', num(data.vehicles_on_provider)],
              ['Background poller', ingest.loop_running ? (ingest.poll_in_progress ? 'Running · polling now' : 'Running') : 'Stopped'],
              ['Webhook', data.webhook?.supported ? (data.webhook.secret_configured ? `Ready at ${data.webhook.path}` : 'Supported, secret not set') : 'Not supported'],
              ['Last poll', last ? `${dateTime(last.started_at)} (${num(last.duration_ms)} ms)` : 'Never'],
              ['Last poll result', last ? `${num(last.vehicles)} vehicles · ${num(last.received)} received · ${num(last.written)} written · ${num(last.alerts_raised)} alerts raised · ${num(last.trips_started)} trips started` : '—'],
              ingest.last_error ? ['Last error', <span key="e" className="text-red-600">{ingest.last_error.message} ({timeAgo(ingest.last_error.at)})</span>] : null,
            ]}
          />
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Capabilities</p>
            <div className="flex flex-wrap gap-1.5">
              {caps.map(([k, on]) => <StatusBadge key={k} tone={on ? 'green' : 'gray'} label={`${k}${on ? '' : ' (no)'}`} />)}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
};

const EvDashboard = () => {
  const navigate = useNavigate();
  const dash = useApi(() => getEvDashboard(), []);
  const prov = useApi(() => getEvProvider(), []);
  const { reload: reloadDash } = dash;
  const { reload: reloadProv } = prov;

  useEffect(() => {
    const t = setInterval(() => { reloadDash(); reloadProv(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reloadDash, reloadProv]);

  const d = dash.data;
  const minSpeed = prov.data?.rules?.tripMinSpeedKmh ?? 3;
  const sev = d?.open_alerts?.by_severity || {};
  const points = d?.map || [];
  const refresh = () => { reloadDash(); reloadProv(); };

  const columns = [
    { key: 'registration_no', label: 'Vehicle', render: (p) => (
      <div><p className="font-medium text-gray-900">{p.registration_no}</p><p className="text-xs text-gray-400">{[p.make, p.model].filter(Boolean).join(' ')}</p></div>
    ) },
    { key: 'state', label: 'State', render: (p) => {
      const s = vehicleState(p, minSpeed);
      return <StatusBadge tone={STATE_STYLE[s].tone} label={STATE_STYLE[s].label} />;
    } },
    { key: 'soc_pct', label: 'SOC', render: (p) => <SocBar value={p.soc_pct} /> },
    { key: 'speed_kmh', label: 'Speed', align: 'right', render: (p) => `${num(p.speed_kmh)} km/h` },
    { key: 'range_km', label: 'Range', align: 'right', render: (p) => (p.range_km === null ? '—' : `${num(p.range_km)} km`) },
    { key: 'location', label: 'Location', render: (p) => <span className="text-xs text-gray-500">{Number(p.lat).toFixed(4)}, {Number(p.lng).toFixed(4)}</span> },
    { key: 'recorded_at', label: 'Last seen', render: (p) => timeAgo(p.recorded_at) },
  ];

  return (
    <PageShell
      module="EV Fleet"
      page="Dashboard"
      title="EV Fleet Dashboard"
      right={<Button variant="secondary" icon={RefreshCw} busy={dash.loading && !!d} onClick={refresh}>Refresh</Button>}
    >
      {dash.error ? <Notice tone="red">{dash.error}</Notice> : null}

      <StatGrid>
        <StatCard label="Total vehicles" value={d ? num(d.total) : '…'} hint={d ? `${num(d.by_status?.maintenance)} maintenance · ${num(d.by_status?.inactive)} inactive` : null} icon={Car} onClick={() => navigate('/admin/ev/vehicles')} />
        <StatCard label="Online" value={d ? num(d.online) : '…'} hint={d ? `reported in last ${num(d.offline_after_minutes)} min` : null} icon={Wifi} tone="green" />
        <StatCard label="Offline" value={d ? num(d.offline) : '…'} hint={d?.never_reported ? `${num(d.never_reported)} never reported` : null} icon={WifiOff} tone="red" />
        <StatCard label="Charging" value={d ? num(d.charging) : '…'} icon={BatteryCharging} tone="green" />
        <StatCard label="Moving" value={d ? num(d.moving) : '…'} icon={Navigation} tone="blue" />
        <StatCard label="Low battery" value={d ? num(d.low_battery) : '…'} icon={BatteryLow} tone="amber" />
        <StatCard label="Average SOC" value={d ? pct(d.avg_soc_pct, 1) : '…'} icon={BatteryMedium} tone="indigo" />
        <StatCard label="Average SOH" value={d ? pct(d.avg_soh_pct, 1) : '…'} icon={HeartPulse} tone="indigo" />
        <StatCard
          label="Open alerts"
          value={d ? num(d.open_alerts?.total) : '…'}
          hint={d ? `${num(sev.critical || 0)} critical · ${num(sev.warning || 0)} warning · ${num(sev.info || 0)} info` : null}
          icon={AlertTriangle}
          tone={sev.critical ? 'red' : 'amber'}
          onClick={() => navigate('/admin/ev/alerts')}
        />
      </StatGrid>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6 min-w-0">
          <Card
            title="Fleet map"
            subtitle={d ? `${num(points.length)} vehicles with a location · updated ${timeAgo(d.generated_at)} · auto-refresh 30s` : 'Live positions'}
            icon={MapIcon}
            right={<StateLegend />}
          >
            {MAP_AVAILABLE ? (
              points.length ? <FleetMap points={points} minSpeedKmh={minSpeed} /> : (
                <p className="text-sm text-gray-400">{dash.loading ? 'Loading…' : 'No vehicle has reported a location yet.'}</p>
              )
            ) : (
              <p className="text-sm text-gray-500">Google Maps key not configured, so positions are listed below.</p>
            )}
          </Card>
          <Card title="Vehicles on the map" icon={Activity} bodyClassName="">
            <DataTable
              columns={columns}
              rows={points}
              loading={dash.loading}
              error={dash.error}
              empty="No vehicle locations yet"
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/admin/ev/vehicles/${p.id}`)}
            />
          </Card>
        </div>
        <div className="min-w-0">
          <ProviderCard data={prov.data} loading={prov.loading} error={prov.error} onChanged={refresh} />
        </div>
      </div>
    </PageShell>
  );
};

export default EvDashboard;
