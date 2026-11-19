import React from 'react';
import { Field, Input, Notice } from '../platform/kit';

/** Two date inputs (yyyy-mm-dd) for a reporting window. */
export const DateRange = ({ from, to, onChange }) => (
  <>
    <Field label="From">
      <Input type="date" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} />
    </Field>
    <Field label="To">
      <Input type="date" value={to} min={from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => onChange({ from, to: e.target.value })} />
    </Field>
  </>
);

/** Explains a 409 TERRITORY_TAKEN response. */
export const TerritoryConflict = ({ franchises }) => (
  <Notice tone="red">
    <p className="font-medium">This territory is already allocated to another franchise.</p>
    {franchises.length ? (
      <p className="mt-1">
        Held by:{' '}
        {franchises.map((f, i) => (
          <span key={f.id || i}>
            {i ? ', ' : ''}
            <strong>{f.name}</strong>{f.code ? ` (${f.code})` : ''}
          </span>
        ))}
        . Remove the overlapping cities or zones, or change that franchise first.
      </p>
    ) : null}
  </Notice>
);
