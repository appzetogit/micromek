import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import {
  Button, Card, DataTable, Field, PageShell, Select, StatusBadge, Toolbar, dateTime, errorMessage, useAction, useApi,
} from '../platform/kit';
import { listTemplates, syncTemplates } from '../../services/leadsApi';
import { TEMPLATE_STATUSES, templateBodyText, templateParamCount } from './leadsShared';

/** Body text with {{n}} placeholders highlighted. */
const BodyPreview = ({ text }) => (
  <p className="max-w-md text-xs text-gray-600 whitespace-pre-wrap line-clamp-3">
    {text
      ? text.split(/(\{\{\s*\d+\s*\}\})/g).map((part, i) => (/^\{\{/.test(part)
        ? <span key={i} className="px-1 rounded bg-indigo-50 text-indigo-700 font-medium">{part}</span>
        : <span key={i}>{part}</span>))
      : '—'}
  </p>
);

const WhatsAppTemplates = () => {
  const [status, setStatus] = useState('all');
  const { data, loading, error, reload } = useApi(() => listTemplates({ status }), [status]);
  const [sync, syncing] = useAction(() => syncTemplates(), {
    onSuccess: (body) => {
      const r = body?.data || {};
      toast.success(`Synced ${r.total ?? 0} templates (${r.approved ?? 0} approved${r.marked_deleted ? `, ${r.marked_deleted} removed` : ''})`);
      reload();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: 'language', label: 'Language' },
    { key: 'category', label: 'Category', render: (r) => <span className="capitalize">{String(r.category || '—').toLowerCase()}</span> },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <div>
          <StatusBadge status={String(r.status || '').toLowerCase()} />
          {r.rejected_reason && r.rejected_reason !== 'NONE' ? <p className="text-[11px] text-red-600 mt-0.5">{r.rejected_reason}</p> : null}
        </div>
      ),
    },
    { key: 'body', label: 'Body', render: (r) => <BodyPreview text={templateBodyText(r)} /> },
    { key: 'params', label: 'Params', align: 'center', render: (r) => templateParamCount(r) },
  ];

  return (
    <PageShell
      module="WhatsApp"
      page="Templates"
      title="Message templates"
      right={<Button icon={RefreshCw} busy={syncing} onClick={() => sync()}>Sync from WhatsApp</Button>}
    >
      <Card bodyClassName="">
        <Toolbar>
          <Field label="Status" className="w-44">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'all', label: 'All' }, ...TEMPLATE_STATUSES.map((s) => ({ value: s, label: s.toLowerCase() }))]} />
          </Field>
          <p className="text-xs text-gray-400 pb-2.5">Last synced {data?.last_synced_at ? dateTime(data.last_synced_at) : 'never'}</p>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items || []}
          loading={loading}
          error={error}
          empty="No templates. Use “Sync from WhatsApp” to fetch them."
        />
      </Card>
    </PageShell>
  );
};

export default WhatsAppTemplates;
