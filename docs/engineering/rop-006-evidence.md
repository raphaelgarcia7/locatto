# ROP-006 — delivery-controls-v1

Issue [#6](https://github.com/raphaelgarcia7/rentalops/issues/6), plano manual
revalidado diretamente no Harness em 2026-10-10T22:39:34Z. Revisão aprovada:
`updated_at=2026-10-09T00:27:47Z`, SHA-256 UTF-8 do body
`62abe0cd9c7760230544acb0ebbbcd237b6ea62d8f6f67de57485c84bad4046d`.
Executor único `gpt-6.1-sol/high`, owner
`rop006-delivery-controls-20261011-62abe0cd-run1`; sem planner/substituição.
Base `2dc1033ee93a4c1851e77e9ecbd7bb77de7d1dbd` (`origin/develop`).
Código validado: `6603546df76cda11c6c09f581e09042ff6478988`.
O head completo que inclui este registro fica no journal/handoff e nos checks;
um arquivo não pode conter o SHA do próprio commit.

[PR #33](https://github.com/raphaelgarcia7/rentalops/pull/33) é a entrega.
[PR #34](https://github.com/raphaelgarcia7/rentalops/pull/34) é exclusivamente
o experimento negativo, identificado **never merge**. Ambas foram anexadas ao chat.
Não houve merge, deploy, push direto/force, bypass, alteração de main, grant novo,
criação/exportação de credencial, API paga ou implementação ROP-017+.

## AC → evidência

| AC | Evidência | Limite/gate restante |
| --- | --- | --- |
| CI-01 | `infra.automation.projects`: GraphQL autenticado, seis statuses, prioridade, issue.closed separado, revisão/hash, expected_previous_status, confirmação e replay. Escrita real issue6 In progress→Validating→In progress; API e UI do mesmo item confirmaram ambos os estados. | GitHub não oferece CAS do campo; lock único e reread não tornam a escrita atômica contra alteração humana concorrente. Divergência exige reconciliação. |
| CI-02 | Quality real, PostgreSQL17, Python/frontend/auditorias/build, Chromium/axe quatro larguras, Gitleaks histórico completo, gate explícito; matriz negativa abaixo. | Resultado remoto final exato no handoff, nunca inferido de execução anterior. |
| CI-03 | Contexto real e regras de develop registrados abaixo; PR obrigatório, strict, sem bypass/force/delete. | Revisão independente do head/base finais e merge protegido com expected_head_sha são do coordenador, ainda não Done. |
| CI-04 | 72 testes infra: SQLite `tmp_path`, concorrência de claim, owner incorreto, checkpoint/replay, lock antigo sem expiração, interrupções antes/depois PR/merge/Project, quota/model/access/approval/deps desconhecidos, gates completos de PR. | Ensaio puro/fake: não despacha agentes nem simula writes contra o journal compartilhado. |
| CI-05 | Pilotos #3/#7/#21/#8/#9/#10 preservados; documentação versionada e procedimento manual em `infra/automation/README.md`. Executor/revisor Sol/high registrados nos pilotos e coordenação. | Revisão atual continua obrigatória, não substituída pelo piloto. |
| CI-06 | Gates locais/remotos e UI abaixo; sem skips ou assertions enfraquecidas. | Revisor independente `gpt-6-sol/high` em contexto separado após executor parar; coordenador confirma merge/Project Done e só então libera owner. |

## API e UI Projects

Project `PVT_kwHOBfIWtc4BlfrW`, item6 `PVTI_lAHOBfIWtc4BlfrWzg-MbEE`.
Campo Status `PVTSSF_lAHOBfIWtc4BlfrWzhkMWd0`. Consulta real confirmou
`viewerCanUpdate=true`, paginação completa e issue aberta/P0/revisão exata:

| Status | Option ID |
| --- | --- |
| Planning | f75ad846 |
| Ready | c10634c9 |
| In progress | 47fc9ee4 |
| Validating | 81ae24f2 |
| Blocked | 61e4255c |
| Done | 98236657 |

A sessão existente de `gh` foi usada sem ler/exportar seu token. Adapter CLI
exige owner/workspace, revisão/hash e status esperado antes de mutar. Falha de
transporte, acesso, paginação ou confirmação é resultado desconhecido, não sucesso.
Testes demonstram closed sem Done, revisão divergente, target replay sem segundo
write, perda de resposta antes/depois write e recuperação manual. UTF-8 explícito
evita erro real de decodificação do CLI no Windows. Não imprimir stderr/body.

Capturas `project-validating.png` e `project-restored.png` preservam o rerender da
UI autenticada, não uma tabela local. Estado após ensaio: In progress.

## Proteção real develop

Depois de [Quality38142803805 SUCCESS](https://github.com/raphaelgarcia7/rentalops/actions/runs/38142803805)
no código6603546 e readback de todos os cinco check-runs, o contexto exato
`quality-gate`, app GitHub Actions15368, foi fixado no
[ruleset24880667](https://github.com/raphaelgarcia7/rentalops/rules/24880667).
Criado em2026-10-11T13:29:07Z; API confirmou active, apenas
`refs/heads/develop`, bypass_actors vazio e current_user_can_bypass=never.
Regras: PR obrigatório/squash, non_fast_forward e deletion proibidos;
required_status_checks context/app exatos, strict=true, do_not_enforce_on_create=false.
Discussões devem estar resolvidas; stale approvals são descartados em novo push.
Não se configurou exigência de aprovação nativa por outra conta GitHub:
required_approving_review_count=0. A revisão independente Sol/high é um gate
obrigatório do coordenador com evidência do head exato, não aprovação GitHub
inventada por uma segunda identidade. Nenhuma regra anterior foi reduzida
(rulesets e regras de develop eram listas vazias, leituras preservadas).

Prova negativa controlada: PR34 foi marcada ready, autoMergeRequest=null, head
12cd6568221270c6c2ad53a9f22a5be5b868d5f7; API retornou mergeStateStatus=BLOCKED.
UI autenticada mostrou `quality-gate Required / Expected — Waiting for status
to be reported` e `Squash and merge` desabilitado, isEnabled=false. O check
prefixado do workflow sintético não satisfaz o contexto requerido. Captura
`protected-pr34-required-context-visible.png` conserva razão e botão.
**Limite explícito:** prova de estado/UI de rejeição, não tentativa de push direto
ou requisição efetiva de merge. Não se tentou nenhum dos dois. PR34 foi fechada
depois da preservação: state=closed, merged=false, merged_at=null, branch/histórico
mantidos para auditoria. Não foi integrada como tarefa de negócio.

Readback confirmou main inalterada em
`9abc6d4039eb4d5525300d71d9c9e5597f7ec288`, sem regras novas; develop permaneceu
na base2dc1033. O positivo de CI-03 ainda requer o coordenador: revisão independente
do head final, checks atuais SUCCESS, squash protegido de PR33 com
expected_head_sha, confirmação remota e Project Done. Nunca usar admin/bypass.
[Esquema REST oficial](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)
foi consultado antes da configuração; a API real, não a documentação, comprova o estado.

## Matriz negativa remota — PR34, nunca integrar

O experimento usa o mesmo `quality_gate.py` da entrega, necessidades reais de
jobs e uma workflow reusable isolada. As outras três necessidades têm SUCCESS.
Não é execução substituta do pipeline de produto: a Quality completa roda na33.

| Caso | Run / head | Job necessário | Final gate |
| --- | --- | --- | --- |
| backend falha | [38129256236](https://github.com/raphaelgarcia7/rentalops/actions/runs/38129256236), 442cfb4fb676796c90fbc3622dfb7038d480b199 | backend FAILURE | FAILURE |
| frontend falha | mesmo run/head | frontend FAILURE | FAILURE |
| browser falha | mesmo run/head | browser FAILURE | FAILURE |
| secrets falha | mesmo run/head | secrets FAILURE | FAILURE |
| job omitido | mesmo run/head | backend SKIPPED | FAILURE |
| segredo deliberadamente inválido/sintético | [38141688672](https://github.com/raphaelgarcia7/rentalops/actions/runs/38141688672), 22ae81fc7309c8b389a34948a1cb03819d4f3de3 | FAILURE no scanner (Gitleaks8.30.1; 1 finding sintético; exit1) | FAILURE |
| cancelamento durante job | [38141796964](https://github.com/raphaelgarcia7/rentalops/actions/runs/38141796964), 12cd6568221270c6c2ad53a9f22a5be5b868d5f7 | backend CANCELLED; demais SUCCESS | FAILURE, recebeu cancelled |

Na primeira tentativa de segredo, o valor sintético não correspondia à regex
atual de AWS (`[A-Z2-7]`): scanner reportou zero e gate SUCCESS. **Prova inválida**,
preservada em run01/synthetic-secret-original.log, não contada como bloqueio.
A correção gerou outro valor deliberadamente não funcional apenas em RUNNER_TEMP,
sem credencial real e sem commit de segredo. O novo run acima comprovou bloqueio.
O cancelamento foi feito pela API enquanto backend estava em execução; não se
inferiu comportamento a partir apenas da conclusão geral cancelled.
Os testes locais também recusam valor ausente/vazio/desconhecido para cada job.

## Falhas originais e correções verificáveis

1. [38129113532](https://github.com/raphaelgarcia7/rentalops/actions/runs/38129113532),
   d012189c053222311428da7ff93643512220b53a: backend apt não encontrou client17;
   browser 134 PASS/2 FAIL no zoom200% mobile320; frontend/secrets SUCCESS;
   quality-gate FAILURE. Gitleaks action inspecionada só escaneava range da PR,
   portanto substituída por CLI checksum-verified `git --log-opts='--all'`.
2. [38141818333](https://github.com/raphaelgarcia7/rentalops/actions/runs/38141818333),
   4fb83c4fde6a012d8e15f01d91b6c0128ec903bd: backend 578 PASS/3 FAIL. nginx Debian
   usa `/etc/nginx/mime.types`, não `bin/conf/mime.types`; Docker PG retornou
   inet_server_addr172.18.0.2, contrariando corretamente o guard loopback; Compose
   do runner2.38.2 omitia env_file no `config --no-env-resolution`. Browser ainda
   134 PASS/2 FAIL: auth controls corrigidos, mas H1 Locações tinha scroll157/client128
   a200% (root345/client320). Log original detalha elementos/medidas, sem inferir
   que fosse a mesma causa inicial. Gate FAILURE.
3. fbd336d9615028fe1390cee2522eae63aec475c4,
   [38142712864](https://github.com/raphaelgarcia7/rentalops/actions/runs/38142712864):
   erro de configuração antes de jobs, contexto runner.temp não permitido em job.env.
   Anotação da UI preservada; movido para shell step/GITHUB_ENV em6603546.
   Isso não é prova negativa de execução e não é PASS.
4. Execução local adicional com quatro workers: 5 PASS/3 timeouts30s em reservas.
   Saída/traces/capturas preservados antes de rerun. Repetida com um worker, como
   a matriz oficial `e2e/run-matrix.ts`; nenhum limite/assertion foi ampliado.

Correções mecânicas, sem mudança de regra de negócio: cluster CI nativo privado
PG17 em loopback15446, cleanup próprio always; MIME da distribuição exigido
(ausência falha, não skip); Compose5.3.0 oficial isolado em RUNNER_TEMP; quebra de
palavras no H1 para zoom200%. Não mascarar overflow com overflow:hidden.

Fontes oficiais: [PostgreSQL Ubuntu/PGDG](https://www.postgresql.org/download/linux/ubuntu/),
[Compose5.3.0](https://github.com/docker/compose/releases/tag/v5.3.0),
[Gitleaks8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
Asset digests confirmados pela API GitHub e verificados no runner antes de executar:

| Asset | SHA-256 |
| --- | --- |
| docker-compose-linux-x86_64 v5.3.0 | fffb010206c952ee5e45d0cd05dc88d3ca063c4634d40eaad6b72677c4c7bbf0 |
| gitleaks_8.30.1_linux_x64.tar.gz | 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb |

## Qualidade local e remota

Local Windows: Python3.14.7, uv0.12.12, Node24.18.0; PostgreSQL17 real em fixture
Linux nativa privada. Alterações finais do código validadas, sem skips:

| Check | Resultado |
| --- | --- |
| Ruff backend/infra | PASS; 112 arquivos formatados |
| mypy estrito | PASS; 51 fontes |
| pytest backend+infra real PG | 587 PASS, 2 warnings, 190.27s |
| infra isolado Windows | 72 PASS, 3.68s |
| ESLint/Prettier | PASS |
| Vitest | 84 PASS, 10 arquivos |
| build produção | PASS; 132 módulos |
| matriz browser completa anterior | 136 PASS local, 34 em cada largura; logs preservados |
| regressão final produção/zoom/axe | 8 PASS, um worker, quatro larguras, 2.0min |

Quality remota do código6603546:
[run38142803805](https://github.com/raphaelgarcia7/rentalops/actions/runs/38142803805),
**backend/frontend/browser/secrets/quality-gate todos SUCCESS**. Backend587 PASS,
2 warnings69.46s; runner PG17.11 PGDG, Compose5.3.0 checksum OK; pip-audit sem
vulnerabilidade. Frontend84 PASS/build/lint/formato/npm audit sem vulnerabilidade.
Browser34 PASS por largura,136total, zero skips; Gitleaks8.30.1 checksum OK,
62 commits/~4.60MB, zero leaks. Esse run existiu ANTES da proteção. O commit
documental posterior precisa ter seus próprios checks finais, registrados no handoff.

Os dois warnings Python são Starlette/httpx e alias AnyIO BlockingPortal,
mantidos visíveis, não silenciados. Avisos NO_COLOR/FORCE_COLOR do Playwright e
url.parse da action setup-uv não são testes ignorados. Auditorias locked e Gitleaks
finais são registrados com o run exato abaixo/handoff.
O scan staged da evidência apontou generic-api-key na frase que unia o nome do
job, FAILURE, dois-pontos e a versão do scanner; conteúdo inspecionado era só
texto documental. A frase foi reescrita, sem allowlist/supressão do detector.
Relatório redacted original preservado em run03/gitleaks-final-staged.json.

## Inspeção de navegador e limitações

Chromium contra `vite preview` de produção, API real e namespaces PostgreSQL
descartáveis. Matriz oficial executa 34 casos por largura320/390/768/1440, um worker
e harness novo por viewport para respeitar o rate limit real, não limpar contadores.
Inclui teclado/foco, empty/loading/error/retry, unknown replay, reduced motion,
zoom200%, axe e screenshots sintéticos. Nenhuma asserção foi reduzida para CI.

Inspeção manual adicional pelo executor no browser integrado: login do build
atual em320×740,390×844,768×1024,1440×1000; texto/controles legíveis, sem corte,
Tab do título chegou ao E-mail com contorno visível. Capturas manual-* registram
essas quatro inspeções, não apenas um screenshot ampliado. Inspeção das capturas
de pagamentos/zoom mostra quebra vertical de palavras em320 a200%; não houve
ocultação de conteúdo/overflow. Capturas das telas funcionais/estados e checks
do teste continuam parte da evidência; login manual não comprova sozinho todo UX.
Também foram inspecionadas as capturas de reserva/foco320, erro390 e vazio1440;
carregamento/reduced motion foram verificados pelas assertions da suíte e
capturas completas. Screenshots viewport podem mostrar só parte do estado,
portanto não substituem a leitura das assertions nem certificam o restante da página.

Capturas selecionadas versionadas em [evidence/rop006](evidence/rop006), com
fingerprints no manifesto. Originais completos, relatórios e traces ficam nos
diretórios locais preservados e artifacts remotos. A ferramenta computer-use
guiou a inspeção real/UI, sem usar o browser como substituto da API Projects.

Automação/axe não certificam usabilidade, leitores de tela, dispositivos físicos
ou outros navegadores. Não se afirma validação de todos os dispositivos.

## Recursos, interrupção e handoff

Checkout isolado `C:/Users/Raphael/.codex/worktrees/rentalops-customers/rmg-chatbot`.
Raiz compartilhada suja preservada; somente políticas necessárias foram publicadas,
sem adição em massa de arquivos acumulados. Ensaio SQLite usa tmp_path, nunca o
journal real. Owner permanece ocupado até o coordenador confirmar agentes parados.

Fixture exclusiva `/home/rop004-rehearsal/rop006-DDg4pzHR`, banco sintético
`rentalops_delivery_test`, PG loopback15446. Configuração privada não versionada,
sem impressão/cópia de senha. Sources/source-final/source-verified preservados
para reprodutibilidade; novos outputs em run01/run02/run03 antes de reruns.
Ferramentas já existentes da fixture11 foram usadas somente para leitura/execução,
sem alterar11/12/13/15. MinIO preservado:
`f419de217de93134b0933add2efcf516f22a5fbf2565e23ac669b75eb45b50c6`,
StartedAt `2026-10-09T02:04:38.643313867Z`.

Erro real de quota interrompeu o executor inicial; humano pediu continue. Retomada
do MESMO agente/owner/round0/PR33 após confirmação real ordinaryUsageAllowed=true,
primary3/secondary16 em2026-10-11T12:59:32UTC. Nenhum reset/crédito/API/fallback.
Reconciliação encontrou resultados completos e falhas; não se repetiu teste só
pela interrupção. Logs originais e backups ficam na raiz, fora de Git:
`.rentalops/rop006-evidence/run01`, `run02`, `run03`. URLs remotas acima tornam
falhas/provas auditáveis; retenção do artifact é7dias, cópia local preservada.

Revisão independente exata, merge protegido develop, Project Done e liberação do
owner ainda são gates do coordenador; esta evidência não anuncia conclusão deles.
