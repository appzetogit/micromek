import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Receipt, Search, Trophy } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Input, PageShell, Pager, Select, StatusBadge, Toolbar,
  dateOnly, useApi, useDebounced,
} from '../platform/kit';
import { listFranchises } from '../../services/franchiseApi';
import { BUSINESS_TYPES, FRANCHISE_STATUSES, MODULE, refName } from './franchiseHelpers';

const territoryText = (f) => {
  const names = [...(f.service_location_ids || []), ...(f.zone_ids || [])].map(refName);
  if (!names.length) return <span className="text-gray-400">None</span>;
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
};

const columns = [
  {
    key: 'name',
    label: 'Franchise',
    render: (f) => (
      <div className="min-w-0">
        <p className="font-medium text-gray-900 truncate">{f.name}</p>
        <p className="text-xs text-gray-400">{f.code}</p>
      </div>
    ),
  },
  {
    key: 'contact',
    label: 'Contact',
    render: (f) => (
      <div className="min-w-0">
        <p className="truncate">{f.contact_name}</p>
        <p className="text-xs text-gray-400 truncate">{f.mobile} · {f.email}</p>
      </div>
    ),
  },
  { key: 'business_type', label: 'Type', render: (f) => <span className="capitalize">{f.business_type}</span> },
  { key: 'territory', label: 'Territory', render: territoryText },
  { key: 'settlement_cycle', label: 'Cycle', render: (f) => <span className="capitalize">{f.settlement_cycle}</span> },
  { key: 'status', label: 'Status', render: (f) => <StatusBadge status={f.status} /> },
  { key: 'createdAt', label: 'Created', render: (f) => dateOnly(f.createdAt) },
];

const FranchiseList = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: '', business_type: '', search: '' });
  const [page, setPage] = useState(1);
  const search = useDebounced(filters.search);

  const { data, loading, error } = useApi(
    () => listFranchises({ status: filters.status, business_type: filters.business_type, search, page }),
    [filters.status, filters.business_type, search, page],
  );

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  return (
    <PageShell
      module={MODULE}
      page="Franchises"
      title="Franchises"
      right={(
        <>
          <Button variant="secondary" icon={Trophy} onClick={() => navigate('/admin/franchises/leaderboard')} className="hidden sm:inline-flex">Leaderboard</Button>
          <Button variant="secondary" icon={Receipt} onClick={() => navigate('/admin/franchise-settlements')} className="hidden sm:inline-flex">Settlements</Button>
          <Button icon={Plus} onClick={() => navigate('/admin/franchises/create')}>New franchise</Button>
        </>
      )}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Search" className="w-full sm:w-64">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input value={filters.search} onChange={setFilter('search')} placeholder="Name, code, contact, mobile…" className="pl-8" />
            </div>
          </Field>
          <Field label="Status" className="w-full sm:w-40">
            <Select value={filters.status} onChange={setFilter('status')} options={FRANCHISE_STATUSES} placeholder="All" />
          </Field>
          <Field label="Business type" className="w-full sm:w-40">
            <Select value={filters.business_type} onChange={setFilter('business_type')} options={BUSINESS_TYPES} placeholder="All" />
          </Field>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No franchises match these filters"
          onRowClick={(f) => navigate(`/admin/franchises/${f._id}`)}
        />
        <Pager data={data} onPage={setPage} />
      </Card>
    </PageShell>
  );
};

export default FranchiseList;
