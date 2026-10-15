import type { Payments } from './api';
export type PaymentGoal = 'deposit' | 'balance';
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = (value: bigint) =>
  `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

export function newPaymentApplication(data: Payments, value: string) {
  if (!/^[0-9]+\.[0-9]{2}$/.test(value) || cents(value) <= 0n)
    throw new Error(
      'Informe um valor maior que zero, com duas casas decimais.',
    );
  if (
    data.commercial_version_pending ||
    (data.requires_reconciliation && data.pending === '0.00')
  )
    throw new Error('Confira o pagamento existente antes de registrar outro.');
  const paid = cents(value);
  const due = cents(data.estimated_deposit);
  const existingDeposit = data.receipts.some(
    (item) => cents(item.applied_deposit) > 0n,
  );
  const deposit = !existingDeposit && paid >= due ? due : 0n;
  const available = paid - deposit;
  const balance =
    data.deposit_validated || deposit > 0n
      ? available < cents(data.balance_remaining)
        ? available
        : cents(data.balance_remaining)
      : 0n;
  return {
    deposit: money(deposit),
    balance: money(balance),
    pending: money(paid - deposit - balance),
  };
}

export function existingPaymentApplication(data: Payments) {
  if (data.commercial_version_pending) return null;
  const pending = data.receipts.filter((item) => cents(item.pending) > 0n);
  if (pending.length !== 1) return null;
  const receipt = pending[0];
  let deposit = cents(receipt.applied_deposit);
  if (!data.deposit_validated) {
    if (
      data.receipts.some(
        (item) => item.id !== receipt.id && cents(item.applied_deposit) > 0n,
      )
    )
      return null;
    deposit = cents(data.estimated_deposit);
    if (cents(receipt.net) - cents(receipt.applied_balance) < deposit)
      return null;
  }
  const free = cents(receipt.net) - deposit - cents(receipt.applied_balance);
  const extra =
    free < cents(data.balance_remaining) ? free : cents(data.balance_remaining);
  return data.receipts.map((item) => ({
    receipt_id: item.id,
    deposit: item.id === receipt.id ? money(deposit) : item.applied_deposit,
    balance:
      item.id === receipt.id
        ? money(cents(item.applied_balance) + extra)
        : item.applied_balance,
  }));
}
