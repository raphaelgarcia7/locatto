import type { Checklist } from './ChecklistSection';

export function checklistComplete(data: Checklist) {
  return (
    data.version > 0 &&
    !data.needs_recheck &&
    data.products.length > 0 &&
    [...data.products, ...data.extras].every((item) => item.checked)
  );
}
