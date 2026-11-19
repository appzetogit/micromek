import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FilePlus2, Receipt } from 'lucide-react';
import {
  Button, Card, DataTable, Field, Modal, Notice, PageShell, Pager, Select, StatusBadge, Textarea, Toolbar,
  errorMessage, inr, isoDay, num, useAction, useApi,
} from '../platform/kit';
import { generateSettlement, listFranchises, listSettlements } from '../../services/franchiseApi';
import { MODULE, SETTLEMENT_STATUSES, periodText, toIsoRange } from './franchiseHelpers';
import { DateRange } from './FranchiseParts';

const columns = [
  {
    key: 'franchise',
    label: 'Franchise',
    render: (s) => (
      <div>
        <p className="font-medium text-gray-900">{s.franchise_id?.name || '—'}</p>
        <p className="text-xs text-gray-400">{s.franchise_id?.code}</p>
      </div>
    ),
  },
  { key: 'period', label: 'Period', render: periodText },
  { key: 'rides', label: 'Rides', align: 'right', render: (s) => num(s.rides) },
  { key: 'gross_fare', label: 'Gross fare', align: 'right', render: (s) => inr(s.gross_fare) },
  { key: 'franchise_share', label: 'Share', align: 'right', render: (s) => inr(s.franchise_share) },
  { key: 'payable', label: 'Payable', align: 'right', render: (s) => <span className="font-medium text-gray-900">{inr(s.payable)}</span> },
  { key: 'status', label: 'Status', render: (s) => <StatusBadge status={s.status} /> },
];

const blankDraft = () => ({ franchise_id: '', from: isoDay(7), to: isoDay(1), notes: '' });

const FranchiseSettlements = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const franchiseId = params.get('franchise_id') || '';
  const status = params.get('status') || '';
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(null);
  const [genError, setGenError] = useState(null);

  const franchises = useApi(() => listFranchises({ limit: 100 }), []);
  const franchiseOptions = (franchises.data?.items || []).map((f) => ({ value: f._id, label: `${f.name} (${f.code})` }));
  const { data, loading, error } = useApi(
    () => listSettlements({ franchise_id: franchiseId, status, page }),
    [franchiseId, status, page],
  );

  const setFilter = (key) => (e) => {
    const next = new URLSearchParams(params);
    if (e.target.value) next.set(key, e.target.value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
  };

  const openGenerate = () => {
    setGenError(null);
    setDraft({ ...blankDraft(), franchise_id: franchiseId });
  };

  const [generate, generating] = useAction(
    () => generateSettlement({ franchise_id: draft.franchise_id, notes: draft.notes.trim(), ...toIsoRange(draft.from, draft.to) }),
    {
      onSuccess: (res) => {
        toast.success('Settlement generated');
        navigate(`/admin/franchise-settlements/${res.data._id}`);
      },
      onError: (err) => setGenError(err),
    },
  );

  const submitGenerate = () => {
    if (!draft.franchise_id) setGenError({ message: 'Choose a franchise' });
    else if (!draft.from || !draft.to || draft.from > draft.to) setGenError({ message: 'Choose a valid period' });
    else {
      setGenError(null);
      generate();
    }
  };

  return (
    <PageShell
      module={MODULE}
      page="Settlements"
      title="Franchise settlements"
      right={<Button icon={FilePlus2} onClick={openGenerate}>Generate settlement</Button>}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Franchise" className="w-full sm:w-64">
            <Select value={franchiseId} onChange={setFilter('franchise_id')} options={franchiseOptions} placeholder="All franchises" />
          </Field>
          <Field label="Status" className="w-full sm:w-40">
            <Select value={status} onChange={setFilter('status')} options={SETTLEMENT_STATUSES} placeholder="All" />
          </Field>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No settlements yet"
          onRowClick={(s) => navigate(`/admin/franchise-settlements/${s._id}`)}
        />
        <Pager data={data} onPage={setPage} />
      </Card>

      <Modal
        open={Boolean(draft)}
        title="Generate settlement"
        onClose={() => setDraft(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button icon={Receipt} busy={generating} onClick={submitGenerate}>Generate</Button>
          </>
        )}
      >
        {draft ? (
          <>
            {genError ? (
              <Notice tone="red">
                {errorMessage(genError)}
                {genError.details?.code === 'SETTLEMENT_OVERLAP' && genError.details.settlement_id ? (
                  <> — <Link className="underline font-medium" to={`/admin/franchise-settlements/${genError.details.settlement_id}`}>open it</Link></>
                ) : null}
              </Notice>
            ) : null}
            <Field label="Franchise *">
              <Select
                value={draft.franchise_id}
                onChange={(e) => setDraft((d) => ({ ...d, franchise_id: e.target.value }))}
                options={franchiseOptions}
                placeholder={franchises.loading ? 'Loading…' : 'Choose a franchise'}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DateRange from={draft.from} to={draft.to} onChange={(r) => setDraft((d) => ({ ...d, ...r }))} />
            </div>
            <p className="text-xs text-gray-400 -mt-2">Both days are included. The period cannot end in the future.</p>
            <Field label="Notes"><Textarea value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} /></Field>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
};

export default FranchiseSettlements;
