# Contrato e assinatura opcionais

Decisão humana direta de 16/10/2026: o contrato é opcional por enquanto. Sua
ausência, falta de assinatura ou desatualização não bloqueia as etapas posteriores
da locação. Esta decisão substitui apenas os gates documentais dos planos
handover-return-v2/contracts-v2, não suas demais regras comerciais e operacionais.

- Retirada continua exigindo reserva confirmada, sinal validado, estoque fresco,
  quantidades integrais e saldo pago ou exceção financeira explicitamente registrada.
- Devolução, ocorrências, acordos manuais e encerramento não exigem contrato.
  Acordos continuam explícitos, auditados e sem cobranças/recebimentos automáticos.
- Contratos e assinaturas continuam disponíveis voluntariamente; não são apagados
  nem marcados como assinados para permitir operações. Emissão voluntária mantém
  suas validações de dados/documento. Isso não certifica validade jurídica.
- Eventos operacionais sem documento gravam referência nula. Havendo contrato,
  preservam o vínculo real e a checagem de versão concorrente, sem exigir assinatura.
- Migração 0016 torna essas referências opcionais, mantendo FKs e o par consistente
  id/versão. Downgrade recusa registros sem contrato, sem inventar documentos.

A indicação técnica `ready_for_pickup` nos DTOs de contrato continua descrevendo
o estado documental assinado/vigente; não é mais uma autorização da retirada.
Prévias de alteração retornam `requires_new_signature=false` nesta política.
