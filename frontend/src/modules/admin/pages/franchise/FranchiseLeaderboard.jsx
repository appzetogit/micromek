import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Trophy } from 'lucide-react';
import { BarList, Card, DataTable, PageShell, Toolbar, dateOnly, inr, isoDay, num, useApi } from '../platform/kit';
import { getFranchiseLeaderboard } from '../../services/franchiseApi';
import { MODULE, toIsoRange } from './franchiseHelpers';
import { DateRange } from './FranchiseParts';

const columns = [
  {
    key: 'rank',
    label: '#',
    render: (r) => (
      <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold ${r.rank <= 3 ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
        {r.rank}
      </span>
    ),
  },
  {
    key: 'name',
    label: 'Franchise',
    render: (r) => (
      <div>
        <p className="font-medium text-gray-900">{r.name}</p>
        <p className="text-xs text-gray-400">{r.code}</p>
      </div>
    ),
  },
  { key: 'rides', label: 'Rides', align: 'right', render: (r) => num(r.rides) },
  { key: 'gross_fare', label: 'Gross fare', align: 'right', render: (r) => inr(r.gross_fare) },
  { key: 'platform_commission', label: 'Platform commission', align: 'right', render: (r) => inr(r.platform_commission) },
  { key: 'franchise_share', label: 'Franchise share', align: 'right', render: (r) => inr(r.franchise_share) },
];

const FranchiseLeaderboard = () => {
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: isoDay(29), to: isoDay(0) });
  const { data, loading, error } = useApi(
    () => getFranchiseLeaderboard(toIsoRange(range.from, range.to)),
    [range.from, range.to],
  );
  const rows = (data?.items || []).map((r, i) => ({ ...r, rank: i + 1 }));

  return (
    <PageShell module={MODULE} page="Leaderboard" title="Franchise leaderboard" backTo="/admin/franchises">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card
          className="xl:col-span-2"
          title="Ranking by gross fare"
          subtitle={data?.period ? `${dateOnly(data.period.from)} – ${dateOnly(data.period.to)} · approved franchises` : 'Approved franchises'}
          icon={Trophy}
          bodyClassName=""
        >
          <Toolbar><DateRange from={range.from} to={range.to} onChange={setRange} /></Toolbar>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            error={error}
            rowKey={(r) => r.id}
            empty="No approved franchises"
            onRowClick={(r) => navigate(`/admin/franchises/${r.id}`)}
          />
        </Card>
        <Card title="Gross fare" subtitle="Top 10" icon={BarChart3}>
          {loading && !data ? <p className="text-sm text-gray-400">Loading…</p> : (
            <BarList items={rows.slice(0, 10).map((r) => ({ label: r.name, value: r.gross_fare }))} format={inr} />
          )}
        </Card>
      </div>
    </PageShell>
  );
};

export default FranchiseLeaderboard;
