import { addressLabels } from './api';
import type { Address } from './api';

export function AddressFields({
  value,
  onChange,
  disabled = false,
  prefix,
}: {
  value: Address;
  onChange: (value: Address) => void;
  disabled?: boolean;
  prefix: string;
}) {
  return (
    <fieldset disabled={disabled} className="contract-address">
      <legend>{prefix}</legend>
      <div className="contract-grid">
        {(Object.keys(addressLabels) as (keyof Address)[]).map((key) => (
          <label key={key}>
            {addressLabels[key]}
            <input
              value={value[key] ?? ''}
              autoComplete="off"
              maxLength={
                key === 'state'
                  ? 2
                  : key === 'postal_code'
                    ? 9
                    : key === 'number'
                      ? 30
                      : 100
              }
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value || null })
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
