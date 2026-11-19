import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlarmClock, CheckCircle2, Percent, Sparkles, Timer, Users, XCircle } from 'lucide-react';
import { BarList, Card, Field, Input, Notice, PageShell, StatCard, StatGrid, inr, isoDay, num, pct, useApi } from '../platform/kit';
import { getLeadStats } from '../../services/leadsApi';
import { dayEndIso, dayStartIso, minutesLabel } from './leadsShared';

const LeadsDashboard = () => {
  const navigate = useNavigate();
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const { data, loading, error } = useApi(() => getLeadStats({ from: dayStartIso(from), to: dayEndIso(to) }), [from, to]);

  const s = data || {};
  const newCount = s.by_status?.find((x) => x.status === 'new')?.count;
  const value = (v) => (loading && !data ? '…' : v);

  return (
    <PageShell
      module="Leads"
      page="Dashboard"
      title="Leads dashboard"
      right={(
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
    >
      {error ? <Notice tone="red">{error}</Notice> : null}
      <StatGrid>
        <StatCard label="Total leads" value={value(num(s.total))} hint={`${num(s.open_now)} open right now`} icon={Users} onClick={() => navigate('/admin/leads')} />
        <StatCard label="New" value={value(num(newCount))} icon={Sparkles} tone="amber" />
        <StatCard label="Won" value={value(num(s.won))} hint={`${inr(s.won_value)} value`} icon={CheckCircle2} tone="green" />
        <StatCard label="Lost" value={value(num(s.lost))} icon={XCircle} tone="red" />
        <StatCard label="Conversion rate" value={value(pct(s.conversion_rate, 1))} hint={`${pct(s.win_rate_closed, 1)} of closed leads won`} icon={Percent} tone="blue" />
        <StatCard
          label="Avg first response"
          value={value(minutesLabel(s.response_time?.avg_minutes))}
          hint={`median ${minutesLabel(s.response_time?.median_minutes)} · ${num(s.response_time?.responded)} responded`}
          icon={Timer}
          tone="gray"
        />
        <StatCard
          label="Overdue follow-ups"
          value={value(num(s.follow_ups?.overdue))}
          hint={`${num(s.follow_ups?.due_today)} due today · ${num(s.follow_ups?.leads_overdue)} leads overdue`}
          icon={AlarmClock}
          tone="red"
          onClick={() => navigate('/admin/leads/follow-ups')}
        />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="By source" subtitle="Leads created in the period">
          <BarList items={(s.by_source || []).map((x) => ({ label: x.source || 'unknown', value: x.count }))} />
        </Card>
        <Card title="By status">
          <BarList items={(s.by_status || []).map((x) => ({ label: x.status, value: x.count }))} />
        </Card>
        <Card title="By assignee" subtitle="Count of leads (won / lost in brackets)">
          <BarList
            items={(s.by_assignee || []).map((x) => ({ label: `${x.name || 'Unassigned'} (${x.won}/${x.lost})`, value: x.count }))}
          />
        </Card>
        <Card title="By type">
          <BarList items={(s.by_type || []).map((x) => ({ label: x.type || 'unknown', value: x.count }))} />
        </Card>
      </div>
    </PageShell>
  );
};

export default LeadsDashboard;
