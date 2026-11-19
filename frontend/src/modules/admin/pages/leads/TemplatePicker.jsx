import React from 'react';
import { Field, Input, Select } from '../platform/kit';
import { fillTemplate, templateBodyText, templateParamCount } from './leadsShared';

/**
 * Approved-template picker with inputs for the body's {{n}} placeholders.
 * value: { name, language, params: string[] }
 */
const TemplatePicker = ({ templates = [], value, onChange, paramHint }) => {
  const selected = templates.find((t) => t.name === value.name && t.language === value.language);
  const count = templateParamCount(selected);
  const body = templateBodyText(selected);

  const pick = (key) => {
    const t = templates.find((x) => `${x.name}|${x.language}` === key);
    onChange({ name: t?.name || '', language: t?.language || '', params: Array(templateParamCount(t)).fill('') });
  };
  const setParam = (i, v) => {
    const params = Array.from({ length: count }, (_, j) => value.params?.[j] || '');
    params[i] = v;
    onChange({ ...value, params });
  };

  return (
    <div className="space-y-3">
      <Field label="Template">
        <Select
          value={selected ? `${selected.name}|${selected.language}` : ''}
          onChange={(e) => pick(e.target.value)}
          placeholder={templates.length ? 'Choose an approved template' : 'No approved templates - sync them first'}
          options={templates.map((t) => ({ value: `${t.name}|${t.language}`, label: `${t.name} (${t.language})` }))}
        />
      </Field>
      {count > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: count }, (_, i) => (
            <Field key={i} label={`Parameter {{${i + 1}}}`}>
              <Input value={value.params?.[i] || ''} onChange={(e) => setParam(i, e.target.value)} />
            </Field>
          ))}
        </div>
      ) : null}
      {paramHint && count > 0 ? <p className="text-[11px] text-gray-400">{paramHint}</p> : null}
      {body ? (
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 whitespace-pre-wrap">
          {fillTemplate(body, value.params)}
        </div>
      ) : null}
    </div>
  );
};

export default TemplatePicker;
