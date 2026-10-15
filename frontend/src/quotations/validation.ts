import type { Draft } from './api';

export type FieldErrors = Record<string, string>;

export function dateErrors(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (
    draft.pickup_date &&
    draft.event_date &&
    draft.pickup_date > draft.event_date
  )
    errors.event_date = 'O evento não pode ser anterior à retirada.';
  if (
    draft.event_date &&
    draft.return_date &&
    draft.event_date > draft.return_date
  )
    errors.return_date = 'A devolução não pode ser anterior ao evento.';
  if (
    draft.pickup_date === draft.return_date &&
    draft.pickup_time &&
    draft.return_time &&
    draft.pickup_time > draft.return_time
  )
    errors.return_time =
      'No mesmo dia, a devolução não pode ter horário anterior à retirada.';
  return errors;
}

export function formErrors(form: HTMLFormElement): FieldErrors {
  const errors: FieldErrors = {};
  for (const input of form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >(
    'input[data-validation-field], select[data-validation-field], textarea[data-validation-field]',
  )) {
    const blankRequired = input.required && !input.value.trim();
    if (input.disabled || (input.validity.valid && !blankRequired)) continue;
    const key = input.dataset.validationField!;
    errors[key] =
      input.validity.valueMissing || blankRequired
        ? input instanceof HTMLSelectElement
          ? 'Selecione uma opção.'
          : 'Preencha este campo.'
        : input.validity.rangeUnderflow ||
            input.validity.rangeOverflow ||
            input.validity.stepMismatch
          ? `Informe uma quantidade inteira entre ${input.getAttribute('min')} e ${input.getAttribute('max')}.`
          : input.validity.patternMismatch
            ? 'Informe um valor válido, como 100,00 (até duas casas decimais).'
            : 'Confira o formato e o tamanho deste campo.';
  }
  return errors;
}
