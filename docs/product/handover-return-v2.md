# Custódia, recebimento real e ocorrências — handover-return-v2

Escopo implementado da ROP-014. Base humana: plano consolidado v1 de 2026-10-08 e
complemento explicitamente aprovado em 2026-10-11. Issue #14 atualizada em
2026-10-11T19:10:48Z, body UTF-8 SHA-256
`c6c18e56dc9abb0ba4ffd54e58eed040094adbb3097b88a2d237f06616730225`.
Este documento não altera o template jurídico v0.4 aprovado na #15 nem cria
política nova. As notas históricas de pendência foram resolvidas pelo plano v1/v2.

## Regras impactadas

- Saída integral de produtos efetivos/quantidades, não peças internas de kits.
  Composição divergente exige alteração comercial antes da saída. O snapshot de
  saída é imutável; não há retirada parcial ou substituição informal.
- Contrato vigente assinado/conferido é gate absoluto. Sinal validado continua
  obrigatório. Exceção de saldo registra motivo/ator e mantém dívida; nunca dispensa
  assinatura nem confirma sinal insuficiente. Terceiro: nome e autorização privada,
  sem CPF/RG adicional ou dados pessoais em logs.
- Recebimento parcial aceita apenas produto enviado, quantidade inteira positiva,
  data ISO não futura/nem anterior à saída e acumulado dentro da quantidade enviada.
  Registra apto/higienização/avaria, relato privado, autoria e instante UTC.
- Aptos tornam-se disponíveis em recebimento real +1 dia São Paulo, inclusive
  antecipado, sábado, domingo, feriado e virada de mês/ano. Demais compromissos
  continuam contando. Faltantes de recebimento parcial e atrasados ficam bloqueados
  até recebimento real/perda formalizada; nova previsão é somente informativa.
- Higienização/avaria cria a manutenção de estoque #8 na mesma transação, vinculada
  à ocorrência. Custódia, alocação e manutenção não descontam a mesma unidade duas
  vezes. Liberação/reparo explícito respeita mínimo recebimento real +1 e não remove
  compromissos confirmados.
- Perda formal exige decisão, quantidade, motivo e ator. Baixa física e resolução
  da origem são atômicas. Não fabrica retorno, não libera unidade perdida, não cobra
  automaticamente e reavalia compromissos. Perdas após recebimento também constam
  no total de perdas, sem reduzir novamente o saldo faltante já recebido.
- Acordos extras têm tipo, valor decimal exato, quantidade, motivo/ator, versões
  financeira/contrato e vínculo à ocorrência. Exigem termos aplicáveis v0.4 assinados.
  São obrigações separadas, não recibos/refunds ou alteração do preço original.
  Reparo e reposição não podem cobrar a mesma quantidade/dano. Referência R$100/dia
  por locação não cria job/multa; parcial depende de acordo humano explícito.
- RN046 (complemento humano v2): todos os itens contabilizados e decisões explícitas
  permitem encerramento operacional com dívida. `maintenance` resolve somente a
  pendência de encerramento de quantidade recebida e vinculada à manutenção, com
  motivo/ator; não é reparo/liberação, baixa, perdão ou cobrança. Faltantes bloqueiam
  close até retorno real/perda. Manutenção persiste após `completed`; posterior
  `repaired/released` permanece disponível. Encerramento nunca libera fisicamente.
- Reservas afetadas continuam confirmadas, com conflitos visíveis para decisão
  humana. Não dependemos de cron para detectar atraso/capacidade na consulta e na
  confirmação. Cancelamento pós-saída é recusado; extensão usa estoque fresco e
  demanda física restante; referência de concluída cria proposta nova sem pagamentos.

## Persistência e contrato técnico

`Handover` único/locação, `ReturnEvent`, `Incident`, `IncidentResolution`,
`FinancialAgreement` e `ReturnForecast` são imutáveis no PostgreSQL. Origem de
ocorrência é única inclusive com NULL; manutenção recebida exige vínculo/data.
Contratos preservam chave composta de série/versão. Migration `0011_handovers`
amplia estados `out/completed`; downgrade com custódia existente falha sem descartar
dados. Rollback de comandos preserva estoque, versão, dívida e histórico.

Serviço compartilhável `HandoverService`: transações curtas e locks
quotation → rental → financial/contract → produtos em UUID crescente. Sem rede,
modelo ou PDF sob locks. Request canônico por ator/operação/chave e resultado
persistido junto da auditoria. Replay retorna exatamente o resultado original;
payload diferente usa 409. Browser envia precondições, não autoridade de negócio.
Comandos operacionais avançam a revisão da locação; acordo também avança a revisão
financeira preservando as aplicações anteriores, sem inventar dinheiro recebido.

| Rota sob `/rentals/{rental_id}` | Contrato |
| --- | --- |
| GET `/operations` | DTO tipado de linhas, ocorrências, eventos, assinatura, dívida, atraso e possibilidade de close |
| POST `/handover-preview` | Versões esperadas; somente leitura, assinatura/financeiro/capacidade atuais |
| POST `/handover` | Conferência integral, condição por produto, terceiro opcional, exceção financeira opcional |
| POST `/returns` | Data real, linhas product/quantity/condition, observação privada opcional |
| POST `/return-forecast` | Nova data/motivo; não altera capacidade |
| POST `/incidents/{id}/resolutions` | `maintenance/repaired/released/lost`, quantidade, `agreed: true` |
| POST `/incidents/{id}/financial-agreements` | `repair/replacement/delay`, quantidade, valor string 2 casas, `agreed: true` |
| POST `/close` | Motivo e versões; todos os faltantes/ocorrências contabilizados |

Todos os POSTs de escrita recebem `request_id`, motivo e versões esperadas de
locação, proposta, financeiro e contrato. Sessão privada, Origin/CSRF, no-store,
atores derivados da sessão, sem campos comerciais extras. Erros tipados
401/403/404/409/422/503; anexos e downloads permanecem no contrato #15.

Capacidade usa intervalos de custódia real e manutenção de origem. Alocações
originais não são somadas novamente para locações com saída. Não recebidos após
retorno parcial ou atraso vão até recebimento/perda, independentemente de forecast.
Manutenção de origem substitui sua dedução global por intervalo datado; manutenção
cadastral sem origem continua como baseline. Extensão não copia quantidades já
recebidas. O snapshot comercial e preços históricos continuam imutáveis.

## Interface e limites

Checklist integral sem limite artificial de linhas, assinatura/saldo, terceiro e
exceção; retorno por condição/saldo; decisões por ocorrência, acordo manual e close
separados. Confirmação usa o corpo imutável preparado e mostra motivo, versões,
produtos/quantidades/condições, terceiro/nome/autorização e justificativa da exceção
de saldo; acordo mostra tipo exato (reparo/reposição/atraso), valor, quantidade e
ocorrência vinculada antes de gravar. Quantidades recebidas já encaminhadas não
oferecem novo encaminhamento à manutenção, mas mantêm reparo/liberação elegível.
Histórico financeiro do acordo preserva o contrato completo de snapshots antes e
depois, incluindo recibos e dívida, na mesma transação; não cria dinheiro recebido.
Após
ACK de retorno, campos zeram para a próxima conferência; falha de versão preserva
campos. Resultado desconhecido congela chave/corpo e permite repetir a mesma
tentativa. Histórico privado mostra condição/quantidade, autorização, exceção,
relato, motivo/ator/data. Consulta do cliente mantém dívida mesmo após close.

RN-049 continua válida após o encerramento: o sinal confirmado é histórico,
inclusive quando o total foi aumentado durante a saída. `completed` não recalcula
50% do total atual nem invalida uma conciliação existente; termos, recibos, dívida,
quitação, versões e histórico financeiro permanecem inalterados pelo close.

Não há papéis novos, produção/deploy, contrato real, cobrança automática, transporte
ou canal externo, reparo fictício, quitação automática, event sourcing ou filas.
