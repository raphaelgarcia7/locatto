import { expect, it } from 'vitest';
import { dateErrors } from './validation';
import { draftOf } from './api';

it('validates same-day return times and permits overnight returns without changing values', () => {
  const draft = {
    ...draftOf(),
    pickup_date: '2026-10-10',
    event_date: '2026-10-10',
    return_date: '2026-10-10',
    valid_until: '2026-10-09',
    pickup_time: '18:00',
    return_time: '09:00',
  };
  expect(dateErrors(draft)).toEqual({
    return_time:
      'No mesmo dia, a devolução não pode ter horário anterior à retirada.',
  });
  expect(dateErrors({ ...draft, return_date: '2026-10-11' })).toEqual({});
  expect(draft.return_time).toBe('09:00');
});
