# ROP-015 — contracts-v2

## Revisão e escopo

Plano humano issue15, `updated_at=2026-10-10T22:13:33Z`, body UTF-8 SHA-256
`9a1104344f2ffc028b80c00b8834f478a961b9458b10c3956bf21474da199262`.
Base `acff9c377cd8ff9caa9708ff2e7194281ae43cfd`, branch `codex/15-contracts`;
SHA final no journal/handoff e revisão independente, sem hash autorreferencial.
Owner `rop015-contracts-20261010-9a110434-run1`, executor único gpt-6.1-sol/high,
sem planner/auxiliares. Dependências diretas10/12 e transitivas8/9/3/7/21
Done/merged ancestrais foram reconciliadas pelo coordenador antes do despacho.

Aplicadas as políticas humanas compartilhadas sem publicar mudanças alheias.
Escopo limitado a15; nenhuma retirada/devolução14, IA, vitrine ou integração17+.
ROP006 revalidada pelo humano não executa em paralelo. #21 é dependência histórica.
Regras impactadas: [contracts-v2](../product/contracts-v2.md), README e APIs.
Fonte v0.4 byte-exata SHA-256
`c036ecf76d780e5a2068867710d3d089aa62d5e7c1d42e2dab0fb059145731f0`;
PDF de referência privado
`1afe14fd31c363e16e092053f62265a8a8257ad7996f7ce49b0aca23021cb7ad`.
Aprovação jurídica é informada pelo responsável, não certificada pelo agente.
Referências originais não foram modificadas. A skill PDF orientou a marcação da
operação e renderização/inspeção de todas as páginas dos três espécimes sintéticos.

## Matriz de aceite e substituições explícitas

| Critério vigente | Implementação / prova |
| --- | --- |
| CTR-01: progressivo, PF/CPF/endereço, RG opcional, empresa, condição/foto/template | Parâmetros autenticados e versionados; `test_ctr01_progressive_optional_fields_before_signal_no_allocation` e API/logo; preview lista pendências por campo/produto; final revalida. Contato/identidade sintéticos runtime, RG/logo ausentes permitidos; dados reais não são pré-requisito do desenvolvimento |
| Antes do sinal, sem reserva/estoque/dinheiro automáticos | CTR01 verifica pagamento/alocação inalterados. Serviço contratos não escreve recibos, financeiro, locação ou estoque; UI não oferece transferência/cobrança |
| CTR-02: todos itens, kits personalizados/avulsos, quantidades e preços individuais | `test_ctr02_negotiated_custom_kit_and_loose_items_are_frozen` cobre composição personalizada com agregação2/5, total230.02 e catálogo intacto; PDF inclui composição negociada e relação fotográfica consolidada |
| Nove cláusulas/termo exatos, sem marca sistema/reposição/teto/proibições antigas | Template empacotado byte-exato, pin e revisão fixos; unidade verifica títulos1–9, trechos restaurados/termo e ausência de notas internas/marca/cola quente/perfuração/coluna de reposição. Cadastro preserva valores de catálogo; não exige reposição nem logo |
| Muitos itens, fotos vertical/horizontal, falta/corrupção/renderer | Unidade renderiza30 itens, conta31 ocorrências desenhadas incluindo logo, razões0.5/2.0, dois nomes por item nos anexos; integração recusa foto ausente/corrompida e erro do renderer/template. Sem teto de páginas/omissão; três espécimes6/7/21 páginas inspecionados |
| CTR-03: determinismo/snapshots/novas versões/diff | Mesmos snapshot/clock/versão produzem bytes idênticos. `test_ctr03_*` altera catálogo e empresa/logo, verifica bytes antigos e assinatura nova pendente. Snapshots/version/event/request/revisão de empresa imutáveis, triggers PostgreSQL |
| Valores atuais autoritativos e assinatura após alteração13 | Regressão locação400/sinal200→500 mantém entrada200/saldo300, recebido200/pendente300; não usa50% novo. Contrato anterior fica incompatível com versões comercial/locação atuais; novo documento não herda assinatura |
| CTR-04: emissão/entrega/upload/conferência diferentes | Serviço/eventos e Chromium exercem entrega sem assinatura, upload awaiting_review, conferência manual explícita; substituir anexo exige nova conferência e preserva anterior. Datas ISO/São Paulo, auditoria UTC, ator/session do servidor |
| Assinatura vigente para14 | `signature_state` compara última versão assinada com quotation/rental atuais, não somente flag signed. #14 consumirá contrato técnico; retirada em si não é implementada nem alegada testada |
| Acesso/vínculo/privacidade/filelimits | API cobre401/403/404/strict422, no-store/nosniff/attachment, ausência de paths/pixels em metadados, logo validado/normalizado e remoção futura. Assinaturas PDF/JPEG/PNG até10.000.000; magic/mime, ativo/criptografado/truncado/excessivo recusados. Sem filenames pessoais persistidos, paths arbitrários ou expurgo |
| CTR-05: concorrência/replay/rollback/compensação | PostgreSQL real: mesma chave simultânea/efeito único, chaves distintas/409, payload diferente, versão stale, atualização durante renderer; rollback e ACK perdido em emissão/logo; arquivo novo compensado apenas após confirmação de não referência, commit desconhecido preservado/reconciliado. Histórico anterior nunca apagado |
| Locks/transações/armazenamento | request→quotation→rental→financial→series, configuração independente; captura/render fora da transação, versões rechecadas antes de commit. Armazenamento privado existente, somente imagens normalizadas e provas validadas, sem rede/LLM |
| CTR-06: UI/UX produção4 larguras e PDFs | Chromium/axe320/390/768/1440, teclado/foco visível e sucesso focado, fonte200%, reduced motion, empty/loading/error/success/unknown; logo opcional/upload/remoção, foto pendente, emissão/replay/entrega/conferência/nova versão. Capturas mascaradas privadas, não certificam todos dispositivos/usabilidade |
| CTR-07: ACs históricos e gates | Matriz preserva requisitos históricos não superados. Substituições v2: aprovação jurídica humana v0.4; dados/fotos reais somente na emissão; logo/reposição opcionais/omitidos; cláusulas somente aprovadas; final sem minuta/notas internas. Pipeline abaixo; revisão independente/remote checks/merge/Done ainda são do coordenador |

Redação restaurada sobre não reembolso, seis meses/30 dias, cartão, adesão pelo
pagamento e R$100/dia não cria cálculo por calendário, multa/cobrança/estorno,
remarcação ou dispensa de assinatura. Devolução parcial e aplicação comercial
continuam humanas. Exigências históricas divergentes de reposição, cola quente,
perfuração, teto novo e bloqueio do desenvolvimento foram explicitamente
substituídas, não silenciosamente omitidas.

## Ambiente e comandos

Fixture NOVA privada Ubuntu24.04/ext4 UID1000,
`/home/rop004-rehearsal/rop015-k26pdXqy`, PostgreSQL17.11 loopback15445, somente
dados sintéticos. Credenciais aleatórias config0600 não publicadas. Helper privado
`C:/Users/Raphael/.codex/tmp/rop015-environment.py`; `sync-final` copia o checkout
e somente inputs infraautomation/tests compartilhados para validar coordenação,
sem adicioná-los ao commit. Ferramentas nginx/age anteriores usadas só leitura.
MinIO do usuário e fixtures11/12/13 preservados; nenhum serviço anterior reiniciado.

Logs/capturas/PDFs brutos privados: raiz compartilhada
`.locatto/rop015-evidence/run01`; browser novo exclusivo em
`frontend/test-results/executor-rop015/run13/source/frontend`. Antes de reruns,
todos os reports/capturas anteriores foram copiados para diretórios de backup
novos; não sobrescritos. Traces de contratos explicitamente desativados para
evitar payloads de CPF/endereço/documento, mantendo assertions e capturas
mascaradas. Não há dados reais nem PDFs/assinaturas versionados.

| Gate / comando | Resultado |
| --- | --- |
| `quality-final pytest backend/tests infra/tests -q` Linux/PG real |497 passed,2 warnings,121.18s, exit0; backend487 + infra10, nenhum skip, incluindo regressão de fuso |
| Ruff `check backend ...infra/automation ...infra/tests` / `format --check` | exit0,97 arquivos formatados; unidade final revalidada após assert de privacidade |
| `mypy --config-file backend/pyproject.toml` | exit0,46 fontes sem problemas, modo estrito |
| Windows `pytest infra/tests` com inputs compartilhados |10 passed,4.43s, exit0 |
| `npm run lint` / `npm run format:check` | exit0, sem desabilitar regras |
| `npm test` |84 passed,10 files,15.56s, exit0, incluindo fronteiras da data automática de upload; ajustes posteriores apenas no locator E2E, não no código/unit tests |
| `npm run build` produção |exit0,132 módulos, JS `index-DnxO0yF8.js`, CSS `index-CO2VOkxz.css`; clone browser mesmos artefatos |
| `npm audit --audit-level=high` |exit0,0 vulnerabilidades de todas severidades |
| pip-audit Linux e Windows, export `uv --locked --all-groups` |exit0,0 vulnerabilidades conhecidas; hashes obrigatórios, projeto local omitido |
| Playwright/axe produção `npm run test:e2e` |136 passed,34 por largura320/390/768/1440;2.8/2.8/2.8/3.0m, exit0, run13 final; zero retries |
| Gitleaks histórico e diff completo base→código |exit0,51 commits e1 commit do diff completo,0 leaks; staged código0. Relatório recebe scan staged próprio e histórico/diff completos do HEAD final registrados no journal/handoff |
| `uv build --project backend --wheel` |exit0; template incluído no wheel com SHA c036ecf7 byte-exato |

Auditorias de dependência correspondem ao lock deste checkout, que não mudou
desde as duas auditorias. Warnings mantidos: Starlette/TestClient depreca httpx;
anyio depreca alias BlockingPortal; pip-audit avisa genericamente sobre no-deps
com hashes. Não foram silenciados. Nenhum skip, mudança de timeout, retry,
limite de autenticação ou orçamento foi aplicado para obter verde.

Comandos exatos adicionais (na raiz do checkout, salvo frontend):

```powershell
wsl -d Ubuntu-24.04 -u rop004-rehearsal -- python3 /mnt/c/Users/Raphael/.codex/tmp/rop015-environment.py quality-final pytest backend/tests infra/tests -q
uv run --project backend ruff check backend C:/Projects/praxis/rmg-chatbot/infra/automation C:/Projects/praxis/rmg-chatbot/infra/tests
uv run --project backend ruff format --check backend C:/Projects/praxis/rmg-chatbot/infra/automation C:/Projects/praxis/rmg-chatbot/infra/tests
uv run --project backend mypy --config-file backend/pyproject.toml
uv run --project backend pytest C:/Projects/praxis/rmg-chatbot/infra/tests -q
uv export --locked --project backend --all-groups --format requirements-txt --no-emit-project --output-file C:/Users/Raphael/.codex/tmp/rop015-audit-windows.txt
uv run --project backend pip-audit --requirement C:/Users/Raphael/.codex/tmp/rop015-audit-windows.txt --require-hashes --disable-pip --no-deps
```

Linux usa export equivalente no diretório config privado da fixture e
`quality pip-audit --requirement /home/rop004-rehearsal/rop015-k26pdXqy/config/audit-linux.txt --require-hashes --disable-pip --no-deps`.
Frontend: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`,
`npm audit --audit-level=high`. No clone run13, comando browser configurado para
`wsl -d Ubuntu-24.04 -u rop004-rehearsal -- python3 /mnt/c/Users/Raphael/.codex/tmp/rop015-environment.py browser-final`,
seguido de `npm run test:e2e`; runner existente usa1 worker/retries0 e harness novo
por largura, sem zerar budgets da aplicação.

Logs finais privados por gate: full-pytest-timezone-final, infra-windows-first,
ruff-timezone-final, ruff-format-timezone-final, mypy-timezone-final,
eslint-summary-final, prettier-summary-final, vitest-locator-final,
build-event-date-final, browser-build-summary-final, browser-matrix-summary-final,
pip-audit-linux-first, pip-audit-windows-first, npm-audit-first e source-fingerprints-summary-final
(`.log`). Todos os resultados
PASS acima têm exit0; resultados anteriores permanecem em seus arquivos originais.

Scans: Gitleaks8.30.1 `git --pre-commit --staged`, `git --log-opts='--all'`
e `git --log-opts='acff9c377cd8ff9caa9708ff2e7194281ae43cfd..HEAD'`, todos com
`--redact --no-banner --no-color --report-format json --report-path` privado.
Logs gitleaks-code-staged-final/code-history-final/code-diff-final; para o HEAD
com relatório, gitleaks-evidence-staged-final/history-completed/diff-completed.

## Falhas originais preservadas

- Primeiro PG focado:9 FAIL/2 PASS, erro de configuração minRowHeights do
  ReportLab corrigido. Teste de imagem passou a contar ocorrências desenhadas,
  não recursos PDF deduplicados, mantendo todas31 imagens e suas proporções.
- Full-first:490 PASS/2 FAIL; nova fixture de armazenamento privado não criada e
  comparação histórica0005 incluindo tabelas futuras0010. Fixture corrigida;
  filtro da etapa histórica exclui somente company/contract, mantendo comparação
  das tabelas pertinentes e assertions de rollback/preservação. Full-second492 PASS.
- JSDOM FileList não participa da validade nativa como Chromium: unit testa
  handler/payload via submit explícito; Chromium mantém checkValidity required.
  Corrida de autenticação no novo módulo corrigida com guard authenticated,
  regressão unitária e browser real. Primeira rodada browser2 FAIL, seguinte2 PASS.
- Full-third494 PASS/1 FAIL: comparava PNG bruto com normalizado RGBA. Assert agora
  compara normalize_image, mantendo rollback, replay e preservação de anteriores.
- Full-final485 PASS/1 FAIL: substring content confundia content_type com chave de
  pixels. Assert usa chaves exatas/sentinel privado e exige digest alterado no diff;
  não remove metadados seguros nem enfraquece privacidade.
- Matriz inicial135 PASS/1 FAIL: desktop rental-changes recebeu503 ao consultar
  locação; trace e PostgreSQL registraram timeout no lock de users durante
  autenticação. Causa raiz não comprovada. Evidência preservada; matriz final
  será serializada após pytest, sem relaxar assertions, budgets ou retries0.
- Matriz run04 interrompida após33 PASS/1 FAIL em320 e13 PASS em390: captura
  loading nova revelou corrida no harness ao retirar a interceptação antes do
  handler gated terminar (`route already handled`). Sincronização aguarda estado
  carregado antes de unroute, sem remover assertions de loading/empty. Regressão
  focada2 PASS/23.5s; matriz integral nova run06. Essa corrida não explica nem é
  apresentada como causa da falha503 anterior.

Auto-revisão corrigiu a data de emissão exibida no cabeçalho para São Paulo;
timestamp de auditoria continua UTC. Regressão exige UTC00:30 ser o dia anterior
na apresentação. Run06 foi interrompido sem falha adicional (320:34 PASS,
390:18 PASS), para não alegar matriz final sobre código anterior. Nova matrizrun07
foi executada após pytest final. Os três espécimes já inspecionados permanecem
byte-idênticos com o renderer final (comparação completa, não só texto).

Fingerprints:99 arquivos backend coincidem com source-final;
82 frontend e4 artefatos de produção coincidem com clone final. Nenhuma
divergência; template no índice Git e no wheel conserva SHA aprovado completo.

## PDFs e inspeção

Referência7 páginas renderizadas/abertas, bytes preservados. Três espécimes
sintéticos privados, todas34 páginas renderizadas com Poppler e inspecionadas:

| Espécime | Páginas / SHA-256 |
| --- | --- |
| blank-draft |6 / `9dc8383d4425553ddb7fd9369b45b04bee8e2c9e50f8d7be1d434178ab2508aa` |
| filled-final |7 / `4cf47cedc4698b3e433081b5f75f2b373a6217951121c9d886b9fd3a0bdcb34c` |
| many-items-final |21 / `bd38693129458a75caaad388de9e49588435d70e49a2db03a508b5243dbd67b6` |

Campos/assinaturas amplos, cláusulas e termo completos, paginação e fotos sem
distorção/omissão; draft em todas páginas, finais sem marca/minuta/notas internas.
Poppler avisou fontes fallback Symbol/ArialUnicode; texto Helvetica/acentos e
imagens foram inspecionados, sem clipping observado. Não é certificação jurídica,
assinatura criptográfica ou prova com fotos/dados reais. Retenção/backups/restore
de documentos e validação operacional da equipe permanecem gates de produção.

Limitação identificada pela revisão independente: `filled-final` e
`many-items-final` acima usam snapshot de unidade com CPF/endereços vazios.
Provam sua composição/paginação/fotos, não a renderização desses campos
preenchidos. A evidência adicional completa da correção1 está abaixo.

## Inspeção UI real e correção visual (run07)

Capturas são do Chromium real sobre produção, com campos privados mascarados;
recortes somente para leitura, sem modificar originais, em ui-inspection-run07.

| Largura | Capturas abertas / observações |
| --- | --- |
|320 | contracts-photo-pending e contract-history (recortes legíveis): condição/foto pendente desabilita final, cards v2/v1 separados e anexo anterior consultável; parameters-loading e parameters-unknown: loading distinto de empty, mensagem unknown e replay explícito com campos bloqueados. Quebra de linhas sem corte horizontal, rolagem vertical longa necessária |
|390 | parameters-logo: imagem opcional e remoção somente futura com controles legíveis; contract-awaiting-review: entrega e anexo não são assinatura conferida; contract-zoom200 e viewport: controles/textos novos refluem em coluna, sem corte horizontal, com rolagem vertical ampliada |
|768 | parameters-empty/error: campos em duas colunas, logo explicitamente opcional, erro distinto de vazio; contract-history: v2 pendente e v1 conferida, anexos preservados. contract-signed revelou aviso antigo de emissão dizendo que entrega/assinatura ainda faltavam, embora estado vigente estivesse conferido |

O achado visual acima foi corrigido: aviso da emissão agora remete à entrega e
assinatura atuais, sem afirmar pendência após transições. Chromium exige a
mensagem correta após assinatura e ausência da frase antiga. Run07 interrompido
sem nova falha automática (102 PASS em três larguras e15 PASS desktop), preservado;
ESLint/Prettier/Vitest/build revalidados e matriz integral run08 no build corrigido.
Backend497 não mudou; fingerprints confirmam reutilização exata dessa evidência.

## Inspeção final run08

| Largura | Capturas efetivamente abertas / observações |
| --- | --- |
|320 | contract-signed: aviso corrigido coerente com assinatura vigente conferida; contract-history: v2 pendente/v1 conferida e download de anexo antigo, sem corte horizontal; parameters-unknown: campos bloqueados e replay destacado |
|390 | contract-signed: aviso e estado concordam; parameters-error: retry e erro distintos de empty; contract-zoom200: texto/controles novos ampliados refluem sem corte horizontal e conservam ações, exigindo rolagem vertical |
|768 | contract-signed: mensagem da emissão sem contradição com assinatura vigente; parameters-empty/loading: formulário progressivo em duas colunas, logo opcional e loading explícito separado de vazio; rótulos e controles legíveis |
|1440 | contract-signed/history: aviso e estado conferido coerentes, versão nova pendente e antiga/anexo preservados; parameters-logo/zoom200: marca opcional, remoção futura, campos/ações amplos sem corte horizontal |

Run08 concluiu136 PASS (34 por largura;2.6/2.9/3.9/4.2m), exit0. A inspeção
desktop encontrou a data automática do upload mostrando dia UTC em vez de São
Paulo após21h. Somente esse resumo foi corrigido; timestamps UTC de auditoria e
datas ISO declaradas de entrega/conferência não foram alterados. Revisão focada
de todas as conversões/avisos novos confirmou emissão PDF/defaults/validação
futura já em São Paulo, datas de retirada/evento/devolução preservadas da oferta.
Regressão unitária cobre00:30Z/03:00Z, datas declaradas e timestamp original;
Chromium exige resumo do upload correspondente ao instante retornado pelo
servidor. Run08 e backups permanecem íntegros; nova matriz integral run09.

Run09 interrompido com33 PASS/1 FAIL em320 e15 PASS em390: novo locator exact
incluía texto dos details/link; error-context mostra data correta presente. Duas
regressões focadas seguintes falharam por selecionar também o li ancestral e
por incluir o separador posterior do link, respectivamente. Todas preservadas
em browser-date-locator-regression/browser-date-nested-locator-regression e
backups próprios. Locator final seleciona o evento de upload pelo prefixo/link
e compara com igualdade exata somente o resumo anterior a details. Nenhuma
alteração extra da aplicação, filtro de data, timeout ou retry para esse ajuste.
Regressão focada final run12:1 PASS/18.8s, exit0, antes da matriz integral run13.

Preparação dos recortes desktop pelo Python do projeto compartilhado não tinha
PIL e retornou ModuleNotFoundError, sem gerar/sobrescrever arquivos. Executada
com o Python bundled da skill PDF, que já contém Pillow, exit0. Nenhum pacote
adicionado ao projeto compartilhado por causa da inspeção.

## Inspeção do candidate final run13

Capturas originais mascaradas e recortes legíveis privados ui-inspection-run13,
sem substituir qualquer conjunto anterior.

| Largura | Capturas efetivamente abertas / observações |
| --- | --- |
|320 | contract-awaiting-review: data automática do anexo coerente com São Paulo, entrega não dispensa conferência; parameters-unknown: campos bloqueados, replay explícito e logo opcional. Cards/ações refluem sem corte horizontal, com rolagem vertical longa |
|390 | contract-awaiting-review: data automática correta e estado aguardando conferência distinto da entrega; contract-zoom200: ações/texto ampliados refluem em coluna, acessíveis por rolagem vertical sem corte horizontal |
|768 | contract-signed: entrega/upload/conferência com datas coerentes e estado conferido, ações separadas; parameters-error: falha de leitura/retry explícitos, não apresenta erro como formulário vazio |
|1440 | contract-signed: aviso corrigido, assinatura vigente conferida e datas consistentes, entrega/upload/conferência distintos; parameters-logo: imagem opcional e remoção somente futura, campos e ações legíveis |

## Encerramento do executor

Matriz final run13 concluída136 PASS, exit0. Fingerprints finais em
source-fingerprints-completed.log:99 backend/82 frontend/4 artefatos de produção/
2 inputs infra privados byte-idênticos aos arquivos testados. Commit de código
`c891b4c91b963cf11f362c04861cf1e4e2f04445`; depois dele somente este relatório
é adicionado, sem alterar fontes/tests/build. Base permanece acff9c3 completo
registrado acima; SHA final do relatório no journal/handoff.

Cleanup: sessão10621 e todas as anteriores encerradas; harness gerenciado parou
frontend/backend. Verificação Windows/Linux confirma portas4173/8000/15445
fechadas; postmaster.pid próprio ausente. Somente PG de ROP015 parado, fixture
/home/rop004-rehearsal/rop015-k26pdXqy e config privada retidas, sem expurgo de
imagens/PDFs/reports/backups. MinIO do usuário permanece running, mesmo ID
f419de217de93134b0933add2efcf516f22a5fbf2565e23ac669b75eb45b50c6 e StartedAt
2026-10-09T02:04:38.643313867Z; fixtures11/12/13 preservadas.

Nenhuma falha aberta no pipeline final local. A causa-raiz do503 histórico
continua não demonstrada; não foi ocultado nem associado indevidamente às
corridas de locator. Warnings de bibliotecas e NO_COLOR/FORCE_COLOR preservados.
Sem certificação jurídica/usabilidade universal/produção. Dados/fotos reais
continuam gates de emissão final; retenção/backups/restore e validação da equipe
antes de produção. Revisão independente, CI/proteções remotas, PR/merge/Project
Done/release continuam pendentes do coordenador, não alegados PASS.

Revisão independente do SHA final, publicação/PR/checks remotos/merge/Project
Done/release não foram executados nem declarados aprovados por este executor.

## Correção1 — revisão independente do HEAD5f9427d

Mesmo owner/modelo/esforço, rodada1 de no máximo2. O revisor parou seus recursos
e registrou FAIL no HEAD `5f9427dbfea77f9361abb5d30cf4e0ab11451a29`, base
inalterada. Sem publicação/PR/merge/Done/release ou tarefa paralela.

### CTR-05/07: overflow no multipart da logo

`expected_version=2147483648` atravessava `Form(ge=0)` e falhava no limite
superior do `LogoCommand`, produzindo503 em vez de422. Regressão RED na app,
rota e middleware reais, substituindo somente serviços auth/storage sem DB/PII:
2FAIL/3PASS (overflow imediato e inteiro muito maior). Original `logo-red.log`
preservado. Fix produtivo: mesmo teto2_147_483_647 no Form da logo.

GREEN22PASS em `test_contract_multipart.py`: versões logo0/MAX aceitas;
negativas/overflow/não inteiras recusadas antes do serviço; assinatura1/MAX
chega ao serviço e versões inválidas retornam422; duplicate/extra/query/missing
recusados em ambas rotas. Não substitui provas PG de validação de arquivo.
Sem enfraquecer assertions, timeout, retries, limites ou orçamento de autenticação.

### CTR-06: PDF completo, campos longos e rodapé

Novo espécime privado com empresa/cliente completos, CPF gerado somente em
runtime/checksum válido, telefone normalizado, três endereços longos distintos,
RG opcional preenchido, agenda e4fotos. Campos manuais de local/data, forma de
pagamento e assinaturas continuam em branco por desenho, não são pendências
de identificação. É espécime de layout final (`draft=False`), não contrato real
emitido ou assinado. Nenhum dado real foi usado.

O primeiro candidato8p revelou colisão do nome empresarial extenso no rodapé
com a página. Regressão RED1FAIL/1PASS; fix limita somente essa repetição à
largura disponível com reticências, reservando24pt para paginação. Nome principal
e metadado completos, snapshots anteriores não são reescritos. GREEN29PASS
combinados PDF/multipart, incluindo nome200 caracteres e nome curto inalterado.
O pipeline519/84 inicial e browser run01 interrompido após9PASS não são gates
finais do renderer corrigido. Todos permanecem preservados.

Final privado `correction1/pdf-final/complete-long-fields-final.pdf`:8p,
13691bytes, SHA-256
`51f13d966b76584f63b6a088ca091783b03b235d6969c70f0f963391362f2170`.
Skill PDF: marcação imediatamente antes de cada novo espécime; Poppler renderizou
as8p e todas foram abertas/inspecionadas. Valores de identidade/contato/endereço
mascarados por glifo, mantendo geometria de linhas/campos; presença exata dos
valores completos e limites de caracteres verificados sem imprimir valores.
Nome completo refluindo no topo, três endereços completos, fotos verticais e
horizontais preservadas, cláusulas1–9/termo e espaços de assinatura presentes,
rodapé final sem colisão. Página8 contém o último campo de assinatura devido
à paginação dos campos longos; não há omissão. Sem marca de rascunho/revisão
interna. Os três PDFs antigos continuam byte-idênticos com o renderer final;
template no índice/wheel e PDF aprovado conservam os SHA completos acima.

Limitação de privacidade do candidato inicial: máscara não abrangia campos
repetidos no termo, e uma captura exclusivamente sintética foi exibida com
valores gerados. Sem PII real, arquivo público ou payload em logs; originais
privados preservados e falha registrada, sem repetir valores. Conjunto final
mascara todas essas ocorrências. PDFs/snapshots/capturas não são versionados.

### Pipeline do renderer antes do ajuste temporal da fixture

Logs privados novos em `.locatto/rop015-evidence/correction1`; fontes Linux
novas `source-correction1-final` na mesma fixture própria; browser clone exclusivo
`frontend/test-results/executor-rop015/correction1/run02/source/frontend`.
Reports/capturas anteriores preservados e copiados antes dos reruns, inclusive
run13 e run01 da correção. Este último foi interrompido antes de produzir HTML;
Copy-Item registrou ausência desse diretório, não perda de relatório existente.
Export Linux inicial falhou por falta de `--project backend`; log preservado,
segundo export locked/hash com parâmetro explícito e audit passaram.

Resultados finais, fingerprints, inspeção4larguras e cleanup registrados na
continuação desta seção e no handoff/checkpoint do SHA final.

| Gate / comando | Resultado antes do ajuste temporal |
| --- | --- |
| `quality-final pytest backend/tests infra/tests -q`, helper correction1 |521 passed (511backend+10infra),2 warnings,356.02s, exit0, nenhum skip |
| Ruff check / format check backend+inputs infra |exit0;98 arquivos formatados |
| `mypy --config-file backend/pyproject.toml` |46 fontes, exit0, estrito |
| Windows `pytest C:/Projects/praxis/rmg-chatbot/infra/tests -q` |10 passed,3.32s, exit0 |
| ESLint / Prettier |exit0 no frontend final |
| Vitest final |84 passed,10 arquivos,36.55s, exit0 |
| Build produção checkout/clone run02 |exit0,132 módulos, mesmos JS/CSS registrados acima |
| pip-audit Windows/Linux final e npm audit final |exit0,0 vulnerabilidades, exports locked/all-groups/hashes; locks byte-idênticos |
| `uv build --project backend --wheel` |exit0, template byte-exato no pacote |
| PDFs antigos, comparação completa com renderer final |3 byte-idênticos, exit0, não prova campos vazios preenchidos |
| Fingerprints fontes/build/inputs realmente testados |100backend/82frontend/4artefatos/2infra, nenhuma divergência |

Manifesto privado de hashes por arquivo `source-digests.json`, SHA-256
`903dd1e783f5516889c496676396fd016f66d031e41f05620fbb174e77ea8bce`.
Não contém dados de negócio. Fontes/testes/build foram congelados antes da matriz
final. Nos comandos do pipeline acima, helper novo é
`C:/Users/Raphael/.codex/tmp/rop015-correction1-environment.py`, operação
`quality-final`; Playwright usa `browser-final` com o mesmo helper e
`npm run test:e2e` no clone run02. Scripts/parametrizações completos privados
preservados; não houve alteração nos asserts/timeouts/retries do E2E.

### Fixture temporal de browser — reconciliação explícita

Run02:320 terminou29PASS/5FAIL e390 foi interrompido após9PASS. Três traces
de confirmação retornaram409 `code=expired`; as duas reservas exibiam orçamento
vencido. Seeds anteriores tinham `valid_until=2026-10-10`, mas a data real em
São Paulo já era2026-10-11. Isso demonstra a causa destas cinco falhas, não a
do503 histórico, que continua desconhecida. Traces/reports/capturas e backup
`browser-before-final2` preservados, sem rerun no mesmo conjunto.

Coordenador reconciliou explicitamente o ajuste técnico dentro da correção1:
somente `backend/tests/browser_server.py`, wrapper loopback já existente,
injeta o clock suportado2026-10-10T12:00:00Z em QuotationService e
RentalChangeService. Preserva cenários fixos valid10/11 e expired09, sem mudar
asserts, intervalos, status esperados, timeout, retry ou orçamento. Datas
relativas em vários specs seriam alternativa, mas alterariam diversos cenários
e poderiam oscilar à meia-noite. Nenhum relógio global, endpoint de produção,
serviço/default/config produtivo ou regra comercial foi alterado.

Como o clock existente também alimenta created_at/checked_at, os timestamps
SINTÉTICOS de orçamento/locação (e pagamentos internos do serviço de locação)
ficam determinísticos; não são alegados medidos em relógio real. AuthService,
ContractService e PaymentService standalone do wrapper continuam reais, UTC,
assim como todos os defaults produtivos. Não houve separação de clocks ou nova
camada. `test_browser_clock.py` exercita lifespan/overrides reais do wrapper
com DB substituído, prova as injeções, defaults reais externos, limpeza dos
overrides e validade antes/no dia/depois. Primeiro teste tinha premissa errada
de que AuthService não possuía atributo clock (1FAIL/3PASS); corrigido para
verificar o relógio real UTC existente, GREEN4PASS. Logs originais preservados.

Regressões produtivas continuam na suíte integral: guards expiry/backdate de
`test_rentals`, revisão de vencido `test_rental_changes`, futura/limite de data
`test_payment_contracts`, data PDF São Paulo/auditoria UTC
`test_contract_contracts`, sessões/auth e vínculos/atores de rotas privadas.
Não foram congeladas por esse wrapper nem tiveram asserts enfraquecidos.

Novo candidate final: Linux `source-correction1-final2`, clone browser run03,
operações `quality-final2` / `browser-final2` do mesmo helper privado. Renderer
e PDFs completos finais permanecem byte-exatos; pipeline integral refeito no
harness final. A tabela521 anterior é evidência intermediária, não o gate final
da alteração do harness. Nenhuma promoção/reexecução de tarefa anterior.

| Gate do candidate final2 | Resultado |
| --- | --- |
| PG real Linux, backend+infra |525 passed (515backend+10infra),2 warnings,193.13s, exit0, nenhum skip |
| Ruff check / format |exit0;99 arquivos formatados |
| mypy estrito |46 fontes, exit0 |
| Infra Windows |10 passed,3.45s, exit0 |
| ESLint / Prettier |exit0 |
| Vitest |84 passed,10 arquivos,15.99s, exit0 |
| Build checkout/clone run03 e wheel |exit0; mesmos4artefatos frontend e template no wheel byte-exato |
| Auditorias finais Windows/Linux/npm |exit0,0 vulnerabilidades, mesmos locks/export hashes |
| Fingerprints finais |101backend/82frontend/4artefatos/2infra,0 divergências; manifesto SHA `0ebd646a9c6ed67b2032881a5a070212e5eeb72faa18eb9689cdc3651f287c6f` |
| PDF completo no código final2 |comparação integral byte-idêntica, SHA51f13d completo acima, exit0 |

Comando exato PG: `wsl -d Ubuntu-24.04 -u rop004-rehearsal -- python3
/mnt/c/Users/Raphael/.codex/tmp/rop015-correction1-environment.py quality-final2
pytest backend/tests infra/tests -q`. Browser usa o mesmo prefixo com
`browser-final2`, variável LOCATTO_BROWSER_SERVER_COMMAND, e
`npm run test:e2e` no clone run03. Logs finais2 separados dos anteriores.

Inspeção efetiva das capturas Chromium mascaradas do run03, recortes sem
alterar originais em `correction1/ui-inspection-final`:

| Largura | Capturas abertas / observações |
| --- | --- |
|320 | parameters-unknown: replay explícito/campos bloqueados/logo opcional; contract-awaiting-review: entrega/anexo ainda aguardando conferência, datas São Paulo e ações legíveis em coluna, sem corte horizontal; rolagem vertical longa |
|390 | parameters-error: erro/retry distintos de vazio; contract-zoom200: controles/histórico ampliados refluem, versão antiga/anexo preservados; rolagem ampliada, sem corte horizontal |
|768 | parameters-loading/empty: estados separados, formulário progressivo em duas colunas e logo opcional; contract-signed: aviso e assinatura vigente conferida coerentes, entrega/upload/conferência separados e datas consistentes |
|1440 | contract-signed: assinatura vigente, aviso, datas e ações separados/coerentes; parameters-logo: marca opcional, remoção só para próximos contratos e campos/ações legíveis sem corte horizontal |

Matriz final run03:136PASS,34 por largura320/390/768/1440,
3.6/3.7/3.9/4.2min, exit0, zero retries. Inclui axe, teclado/foco, fonte200%,
reduced motion e estados empty/loading/error/success/unknown; capturas reais
mascaradas inspecionadas conforme tabela, não certificação universal de UX.
Todos os cinco cenários que falharam por validade na execução anterior passaram
sem relaxar suas expectativas no harness reconciliado.

### Encerramento local da correção1

Código final commit `9e471eeface716d0146427c676cc94616d491205`; depois dele
somente este relatório é atualizado. Base completa acff9c377cd8ff9caa9708ff2e7194281ae43cfd
inalterada. Staged código final sem segredos; histórico/diff completo e staged
do relatório recebem scans próprios, com logs finais do HEAD no journal/handoff.

Reverificação após a matriz/cleanup:189 arquivos/artefatos efetivamente testados
(101backend/82frontend/4build/2infra), nenhum byte divergente do manifesto final2.
Sessão64049 e todas as anteriores encerradas. Harness gerenciado parou seus
frontend/backend; portas4173/8000/15445 fechadas, postmaster.pid próprio ausente.
Somente PG15 foi parado; fixture/config/source-correction1-final2 e todos os
outros sources/reports/PDFs/capturas/backups retidos. Fixtures11/12/13 presentes.
MinIO segue running, ID/StartedAt completos idênticos ao registro acima;
nenhum container/imagem/dado do usuário removido ou reiniciado.

CTR01–07 continuam mapeados na matriz inicial; correção fecha o achado
CTR05/07 multipart e amplia CTR06 com campos completos/longos e todas8p,
sem trocar requisitos históricos ou versão aprovada. Nenhum gate local final
com falha aberta. Originais RED e falhas intermediárias preservados; warnings
de biblioteca/Poppler/NO_COLOR mantidos. Causa503 histórica não demonstrada.
Não há PII real nos testes/evidências; insuficiência da máscara sintética inicial
e clocks/timestamps sintéticos do harness explicitados, sem afirmar relógio
real onde a fixture é determinística. Dados/fotos reais da empresa continuam
gates de emissão final futura, não prova desta execução. Limitações de produção,
retenção/restore, validação humana e não certificação jurídica/UX mantidas.

Executor encerra COMPLETED/PARADO para nova revisão independente do HEAD final
exato informado pelo journal/handoff. Não executou re-review, push, PR, check
remoto, merge, Project Done ou release; não alegou CI remoto PASS nem iniciou
6/14/16/017+. Owner permanece para a coordenação, sem liberar lock unilateral.
