import { useId, useState } from 'react';

export function ValidityHelp() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="quotation-help">
      <button
        type="button"
        className="quotation-help-button"
        aria-label="Entender a validade comercial"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span id={id} className="quotation-help-text" role="note">
          É a data limite para confirmar os preços e condições da proposta.
          Depois dela, revise a proposta antes de confirmar. Deve ser até o dia
          da retirada. Não é a data de devolução e não reserva estoque.
        </span>
      )}
    </span>
  );
}
