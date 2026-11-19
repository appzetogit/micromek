/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import { GoogleMap, InfoWindowF, MarkerF, PolylineF } from '@react-google-maps/api';
import { Loader2, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HAS_VALID_GOOGLE_MAPS_KEY, INDIA_CENTER, useBaseGoogleMapsLoader } from '../../utils/googleMaps';
import { evLookup, listFranchiseOptions } from '../../services/evApi';
import { Field, Input, Select, labelClass, num, pct, timeAgo, useApi, useDebounced } from '../platform/kit';

/// Shared bits for the EV fleet pages: vehicle state colours, SOC bar, date
/// ranges, maps (Google Maps when a key is configured) and a tiny SVG chart.

export const MAP_AVAILABLE = HAS_VALID_GOOGLE_MAPS_KEY;

export const VEHICLE_STATUSES = ['active', 'inactive', 'maintenance'];
export const ALERT_TYPES = ['low_battery', 'critical_battery', 'offline', 'charging_fault', 'overspeed'];
export const ALERT_SEVERITIES = ['critical', 'warning', 'info'];
export const ALERT_STATUSES = [
  { value: 'live', label: 'Live (open + acknowledged)' },
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
];

export const isCharging = (state) => state === 'charging' || state === 'fast_charging';

export const STATE_STYLE = {
  moving: { label: 'Moving', color: '#2563eb', tone: 'blue' },
  charging: { label: 'Charging', color: '#059669', tone: 'green' },
  parked: { label: 'Parked', color: '#6b7280', tone: 'gray' },
  low_battery: { label: 'Low battery', color: '#d97706', tone: 'amber' },
  offline: { label: 'Offline', color: '#dc2626', tone: 'red' },
};

/** Map state of a dashboard map point (offline wins, then charging, low battery, moving). */
export const vehicleState = (p, minSpeedKmh = 3) => {
  if (!p.online) return 'offline';
  if (isCharging(p.charging_state)) return 'charging';
  if (p.low_battery) return 'low_battery';
  if ((p.speed_kmh || 0) >= minSpeedKmh) return 'moving';
  return 'parked';
};

export const StateLegend = () => (
  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
    {Object.entries(STATE_STYLE).map(([key, s]) => (
      <span key={key} className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
        {s.label}
      </span>
    ))}
  </div>
);

export const SocBar = ({ value, threshold = 20 }) => {
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>;
  const v = Math.max(0, Math.min(100, Number(value)));
  const color = v < threshold ? 'bg-red-500' : v < threshold + 20 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-10 text-right">{pct(v)}</span>
    </div>
  );
};

/** Dates from <input type="date"> as an inclusive local-day range in ISO. */
export const rangeParams = (from, to) => ({
  from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
  to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400000).toISOString() : undefined,
});

export const DateRange = ({ from, to, onChange }) => (
  <>
    <Field label="From">
      <Input type="date" value={from} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} />
    </Field>
    <Field label="To">
      <Input type="date" value={to} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} />
    </Field>
  </>
);

/** Franchise picker; fetches the first 100 franchises when mounted. */
export const FranchiseSelect = ({ value, onChange, placeholder = 'No franchise' }) => {
  const { data, loading, error } = useApi(() => listFranchiseOptions(), []);
  const options = (data?.items || []).map((f) => ({ value: f._id, label: f.code ? `${f.name} (${f.code})` : f.name }));
  return (
    <Select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={loading ? 'Loading…' : error ? 'Could not load franchises' : placeholder}
      options={options}
    />
  );
};

/** Id of a populated ref or a raw id. */
export const refId = (v) => (v && typeof v === 'object' ? v._id : v) || '';

/** Display label of a populated link, matching GET /admin/ev/lookups. */
export const linkLabel = (type, v) => {
  if (!v || typeof v !== 'object') return '';
  if (type === 'driver') return [v.name, v.phone, v.vehicleNumber].filter(Boolean).join(' · ');
  if (type === 'fleet_vehicle') return [v.license_plate_number, [v.car_brand, v.car_model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return v.name || v.service_location_name || '';
};

const LINK_TITLES = {
  driver: { label: 'Driver', placeholder: 'Search name, phone or vehicle number' },
  fleet_vehicle: { label: 'Fleet vehicle', placeholder: 'Search plate, brand or model' },
  service_location: { label: 'Service location', placeholder: 'Search location name' },
};

/**
 * Searchable picker for a taxi-module link (GET /admin/ev/lookups). `value` is the id ('' = none),
 * `initialLabel` the label of the saved link if already known; onChange(id, label). Clearing
 * sends '' which unlinks on save.
 */
export const LinkPicker = ({ type, value, initialLabel = '', onChange }) => {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState(initialLabel);
  const q = useDebounced(term);
  const titles = LINK_TITLES[type];
  // Label a saved id that came without a populated object.
  const saved = useApi(
    () => (value && !picked ? evLookup(type, { id: value }) : Promise.resolve({ data: [] })),
    [type, value, Boolean(picked)],
  );
  const results = useApi(
    () => (!value && q ? evLookup(type, { search: q }) : Promise.resolve({ data: [] })),
    [type, q, Boolean(value)],
  );
  const shown = picked || saved.data?.[0]?.label || (saved.loading ? 'Loading…' : value);
  const pick = (item) => { setPicked(item.label); setTerm(''); onChange(item.id, item.label); };
  const clear = () => { setPicked(''); onChange('', ''); };

  return (
    <div>
      <span className={labelClass}>{titles.label}</span>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-sm text-gray-800 truncate" title={value}>{shown}</span>
          <button type="button" onClick={clear} className="text-xs text-red-600 hover:underline shrink-0">Clear</button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="pl-8" placeholder={titles.placeholder} value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          {q ? (
            <div className="mt-1 rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {results.loading ? <p className="px-3 py-2 text-xs text-gray-400">Searching…</p> : null}
              {results.error ? <p className="px-3 py-2 text-xs text-red-600">{results.error}</p> : null}
              {!results.loading && !results.error && !(results.data || []).length ? <p className="px-3 py-2 text-xs text-gray-400">No matches</p> : null}
              {(results.data || []).map((item) => (
                <button key={item.id} type="button" onClick={() => pick(item)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 truncate">
                  {item.label}
                </button>
              ))}
            </div>
          ) : <span className="block mt-1 text-[11px] text-gray-400">Not linked</span>}
        </>
      )}
    </div>
  );
};

// ---------- maps ----------

const MAP_STYLE = { width: '100%', height: '100%' };
const MAP_OPTIONS = { streetViewControl: false, mapTypeControl: false, fullscreenControl: true };

const fitTo = (map, coords) => {
  if (!coords.length) {
    map.setCenter(INDIA_CENTER);
    map.setZoom(5);
  } else if (coords.length === 1) {
    map.setCenter(coords[0]);
    map.setZoom(14);
  } else {
    const bounds = new window.google.maps.LatLngBounds();
    coords.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, 40);
  }
};

const MapLoading = ({ error }) => (
  <div className="h-full flex items-center justify-center text-sm text-gray-400 bg-gray-50">
    {error ? 'Google Maps failed to load' : <><Loader2 size={16} className="animate-spin mr-2" />Loading map…</>}
  </div>
);

const markerIcon = (state, heading) => {
  const { SymbolPath } = window.google.maps;
  const arrow = state === 'moving' && heading !== null && heading !== undefined;
  return {
    path: arrow ? SymbolPath.FORWARD_CLOSED_ARROW : SymbolPath.CIRCLE,
    rotation: arrow ? Number(heading) : 0,
    scale: arrow ? 5 : 8,
    fillColor: STATE_STYLE[state].color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
};

/** Only mounted with a valid key, so the Maps script is never requested without one. */
const FleetMapInner = ({ points, minSpeedKmh }) => {
  const { isLoaded, loadError } = useBaseGoogleMapsLoader();
  const [selected, setSelected] = useState(null);
  if (loadError || !isLoaded) return <MapLoading error={loadError} />;
  const coords = points.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  const current = selected && points.find((p) => String(p.id) === String(selected));
  return (
    <GoogleMap mapContainerStyle={MAP_STYLE} options={MAP_OPTIONS} onLoad={(map) => fitTo(map, coords)}>
      {points.map((p, i) => (
        <MarkerF
          key={p.id}
          position={coords[i]}
          title={p.registration_no}
          icon={markerIcon(vehicleState(p, minSpeedKmh), p.heading)}
          onClick={() => setSelected(p.id)}
        />
      ))}
      {current ? (
        <InfoWindowF position={{ lat: Number(current.lat), lng: Number(current.lng) }} onCloseClick={() => setSelected(null)}>
          <div className="text-xs space-y-0.5 min-w-[160px]">
            <p className="font-semibold text-gray-900">{current.registration_no}</p>
            <p className="text-gray-500">{[current.make, current.model].filter(Boolean).join(' ')}</p>
            <p>{STATE_STYLE[vehicleState(current, minSpeedKmh)].label} · SOC {pct(current.soc_pct)}</p>
            <p>Speed {num(current.speed_kmh)} km/h · Range {num(current.range_km)} km</p>
            <p className="text-gray-400">Seen {timeAgo(current.recorded_at)}</p>
            <Link to={`/admin/ev/vehicles/${current.id}`} className="text-indigo-600 font-medium">Open vehicle</Link>
          </div>
        </InfoWindowF>
      ) : null}
    </GoogleMap>
  );
};

/** Dashboard fleet map. Renders nothing without a Maps key; callers show a table instead. */
export const FleetMap = ({ points, minSpeedKmh, className = 'h-[420px]' }) =>
  MAP_AVAILABLE ? (
    <div className={`rounded-lg overflow-hidden border border-gray-100 ${className}`}>
      <FleetMapInner points={points} minSpeedKmh={minSpeedKmh} />
    </div>
  ) : null;

const RouteMapInner = ({ path }) => {
  const { isLoaded, loadError } = useBaseGoogleMapsLoader();
  if (loadError || !isLoaded) return <MapLoading error={loadError} />;
  const start = path[0];
  const end = path[path.length - 1];
  const dot = (color) => ({
    path: window.google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2,
  });
  return (
    <GoogleMap mapContainerStyle={MAP_STYLE} options={MAP_OPTIONS} onLoad={(map) => fitTo(map, path)}>
      <PolylineF path={path} options={{ strokeColor: '#4f46e5', strokeOpacity: 0.9, strokeWeight: 4 }} />
      <MarkerF position={start} title="Start" icon={dot('#059669')} />
      {path.length > 1 ? <MarkerF position={end} title="End" icon={dot('#dc2626')} /> : null}
    </GoogleMap>
  );
};

/** Trip route from telemetry points; null when there is no key or no GPS fixes. */
export const RouteMap = ({ points = [] }) => {
  const path = points
    .map((p) => ({ lat: Number(p.location?.lat), lng: Number(p.location?.lng) }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  if (!path.length) return <p className="text-sm text-gray-400">No GPS points recorded for this trip.</p>;
  if (!MAP_AVAILABLE) {
    return <p className="text-sm text-gray-400">{num(path.length)} GPS points recorded. Configure a Google Maps key to see the route.</p>;
  }
  return (
    <div className="h-72 rounded-lg overflow-hidden border border-gray-100">
      <RouteMapInner path={path} />
    </div>
  );
};

// ---------- chart ----------

const W = 640;
const H = 180;
const PAD = { l: 40, r: 12, t: 12, b: 26 };

const niceMax = (v) => {
  if (v <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
};

const tickLabel = (t, span) =>
  new Date(t).toLocaleString('en-IN', span > 86400000
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });

/** Time series line for one numeric field of telemetry points; gaps (null) break the line. */
export const LineChart = ({ points = [], field, label, unit = '', color = '#4f46e5', yMax }) => {
  const data = points
    .map((p) => ({ t: new Date(p.recorded_at).getTime(), v: p[field] === null || p[field] === undefined ? null : Number(p[field]) }))
    .filter((d) => Number.isFinite(d.t));
  const values = data.filter((d) => Number.isFinite(d.v));
  if (!values.length) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
        No {label.toLowerCase()} data for this range
      </div>
    );
  }
  const t0 = data[0].t;
  const span = Math.max(1, data[data.length - 1].t - t0);
  const max = yMax ?? niceMax(Math.max(...values.map((d) => d.v)));
  const x = (t) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - Math.min(v, max) / max) * (H - PAD.t - PAD.b);

  let d = '';
  let pen = false;
  for (const p of data) {
    if (!Number.isFinite(p.v)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  const last = values[values.length - 1];

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="font-semibold text-gray-600">{label}</span>
        <span className="text-gray-400">latest {num(last.v, 1)}{unit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${label} over time`}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeDasharray={v ? '3 3' : undefined} />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{num(v)}{unit}</text>
          </g>
        ))}
        {[t0, t0 + span / 2, t0 + span].map((t, i) => (
          <text key={t} x={x(t)} y={H - 8} fontSize="10" fill="#9ca3af" textAnchor={['start', 'middle', 'end'][i]}>
            {tickLabel(t, span)}
          </text>
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {values.length === 1 ? <circle cx={x(last.t)} cy={y(last.v)} r="3" fill={color} /> : null}
      </svg>
    </div>
  );
};
