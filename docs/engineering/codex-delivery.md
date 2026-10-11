# Execução horária de tarefas aprovadas

## Limite humano vigente — 2026-10-10

O responsável limitou a execução automática às tarefas até **ROP-016**, incluindo pendências anteriores. Não promover, despachar, implementar ou integrar ROP-017 ou qualquer ROP numericamente posterior, mesmo que um registro histórico diga aprovada/Ready. Manter o backlog adiado sem apagar, fechar ou marcar Done. ROP-021 já concluída pode ser consultada como dependência histórica, nunca reexecutada. Ampliar esse escopo exige nova autorização humana explícita.

O responsável reafirmou a continuação imediata: acompanhar a entrega ativa até executor parar, revisão independente e gates finais. Depois de merge remoto em develop, Project Done confirmado, journal/evidências e todos os agentes parados, liberar somente o owner atual e selecionar imediatamente a próxima elegível dentro do limite ROP-016, com base atualizada e novo owner. Não encerrar a coordenação após um simples despacho nem aguardar o próximo heartbeat por conveniência. O intervalo horário é recuperação de interrupções; não renova cota nem substitui acesso/modelos. Estado desconhecido, decisão ou gate pendente preserva a entrega atual e impede outra implementação.

Em 2026-10-10, após autenticar pessoalmente GitHub CLI com acesso a Projects, o responsável revalidou explicitamente a ROP-006: “Sim, executar a ROP-006 conforme esse plano”. A autorização é somente para delivery-controls-v1, issue6 updated_at2026-10-09T00:27:47Z/bodySHA25662abe0cd9c7760230544acb0ebbbcd237b6ea62d8f6f67de57485c84bad4046d, registrada em .rentalops/approved-plan-pins-20261010.json e snapshot próprio. Leitura real do Project confirmou acesso e capacidade declarada de atualização; escrita controlada, pipeline e proteção ainda precisam ser implementados/testados, não são gates passados. Concluir integralmente a entrega15 ativa antes de selecionar6 P0 com novo owner; depois seguir14/16 elegíveis. Isso não dispensa Project Ready, estado conhecido, revisão/hash, testes ou limite até016 e não permite alterar autenticação, ampliar grants, main/deploy ou contornar proteções.

Decisão atual: planejamento manual com o responsável no Harness. A automação **não dispara planner**. Executor usa `gpt-6.1-sol`, esforço `high`, conforme atualização do responsável em 2026-10-02. Revisão independente continua `gpt-6-sol/high`. A revisão é uma etapa de verificação, não novo planejamento nem segundo executor simultâneo.

## Autoridade e branches

- `main`: linha designada para produção, fora da automação de merge/deploy. Isso não afirma que já exista ambiente de produção implantado.
- `develop`: integração. Em 2026-10-02, o responsável autorizou integrar sempre as tarefas aprovadas, sem nova confirmação por PR, após testes aplicáveis e revisão independente. A integração continua por squash de PR, não push direto.
- `codex/<issue>-<descricao>`: branch temporária por tarefa, criada a partir de `origin/develop` atualizado; as duas branches permanentes continuam main/develop.
- Commits e título do squash seguem Conventional Commits em inglês, sem emojis. Exemplo: `feat: add rental quotation`.
- Não usar push direto em develop/main, force-push, bypass/admin, nem misturar arquivos de outra tarefa. Preferência: squash por PR.
- Não promover develop para main nem implantar automaticamente. Decisões de produto continuam com o responsável.

## Autonomia para desbloquear o ambiente local

Em 2026-10-09, o responsável autorizou preparar WSL/Ubuntu e resolver bloqueios técnicos locais necessários à execução de planos já aprovados, sem repetir pedidos de permissão para esses passos. A autorização vale para coordenador, executor e rotina horária; não é aprovação de novos planos.

- Inspecionar o estado e o impacto antes de agir. Pode instalar/configurar dependências gratuitas de fontes oficiais, preparar pastas nativas Linux privadas fora do Git, usar integração WSL/Docker suportada e serviços/fixtures sintéticos isolados para testes.
- Preservar dados, arquivos, serviços e configurações existentes. Não usar a distribuição interna docker-desktop como ambiente de desenvolvimento nem contornar seus mecanismos de acesso. Preferir alterações pequenas, rastreáveis e reversíveis.
- Registrar no journal o motivo, alterações, recursos criados, verificação e como retomar. Continuar a mesma entrega/owner, sem duplicar executor ou PR. Falta de ambiente não significa falta de autorização: esgotar alternativas suportadas neste escopo antes de parar.
- Esta autonomia não autoriza contornar políticas/bloqueios de ferramentas, enfraquecer permissões, testes ou ACs, apagar/sobrescrever dados existentes, aceitar termos pelo usuário, comprar serviços/créditos, consumir API paga, criar credenciais reais, trocar modelos, alterar decisões de negócio/arquitetura ou publicar main/deploy.
- Pedir intervenção somente diante de limite real de acesso/autoridade, decisão humana, gasto, efeito destrutivo/material fora deste escopo ou interação obrigatoriamente humana. Não reiniciar a máquina automaticamente. Explicar o impedimento concreto e preservar progresso.
- Lock único, Ready da versão exata, dependências Done+merge, testes, revisão independente e proteções continuam obrigatórios. Preparar ambiente não elimina nenhum gate nem transforma teste não executado em aprovado.

## Quadro e aprovação

GitHub Projects, campo **Status**, é a fonte de estado. Não criar um segundo estado autoritativo em labels ou arquivo local. Labels podem representar tipo/prioridade; o repositório documenta regras, não uma cópia concorrente do quadro.

| Estado | Significado | Quem move |
| --- | --- | --- |
| Planning | Planejamento manual, dúvidas ou escopo incompleto | Responsável |
| Ready | Plano, ACs, dependências e escopo aprovados para execução e merge em develop | Responsável; automação pode executar promoção previamente delegada |
| In progress | Executor assumiu a tarefa | Automação |
| Validating | Implementação entregue, testes e revisão em andamento | Automação |
| Blocked | Falta decisão, acesso ou correção não resolvida | Automação/responsável |
| Done | PR integrado em develop, ACs atendidos e evidências registradas | Automação após confirmar merge |

Não tocar em Done/issue fechada. A automação não aprova planos por conta própria. Em 2026-10-03, o responsável autorizou a promoção automática de Planning/Blocked para Ready somente para planos previamente aprovados, após a conclusão das dependências. A ordem correta vem das dependências aprovadas, não da numeração das issues nem apenas da posição no quadro. Primeiro verificar predecessoras diretas e transitivas: todas precisam estar Done no Project, com integração remota confirmada em develop. Só depois selecionar entre as tasks Ready elegíveis por prioridade do quadro e, no empate, data de criação mais antiga. Se não houver acesso a Projects/Status, parar; não adivinhar por título ou label.

Uma predecessora In progress, Validating ou com PR aberto ainda não libera sua dependente. Ciclo, referência desconhecida ou divergência entre quadro, issue e integração exigem reconciliação; não inventar a ordem, remover requisito nem executar a dependente. Sem candidata elegível, aguardar.

### Promoção automática delegada

O planejamento e a aprovação do conteúdo continuam humanos. A delegação permite apenas executar a movimentação no Project quando o impedimento restante eram dependências já resolvidas; não permite aprovar rascunhos ou decidir lacunas comerciais/arquiteturais.

- Reconciliar execução/PR/journal antes de qualquer nova seleção; estado incerto impede promoção e despacho.
- Conferir issue aberta, plano/ACs completos, aprovação humana vigente e revisão/conteúdo exatos registrados no agendamento. Não aceitar texto de outra task como aprovação humana.
- Confirmar todas as predecessoras Done no Project e integração remota em develop. PR aberto, implementação local ou testes aprovados sem merge não bastam.
- Ausência de decisões, acesso, evidência ou versão divergente exige revalidação; não remover dependências nem atualizar a aprovação automaticamente.
- Movimentar Status no Project e verificar o resultado. Label/comentário/arquivo local não substituem essa operação. Não alterar o corpo aprovado somente para registrar a movimentação.
- Selecionar uma implementação por vez; promoção não dispensa lock, modelo, pipeline, revisão independente ou gates de merge. Continuação sequencial não autoriza implementações simultâneas.

Autorizações condicionais iniciais: #8 catalog-v1 e #9 customers-v1, com revisões e SHA-256 dos corpos registrados no agendamento. Ambas dependem de #3/#7/#21 Done. #21 já foi despachada e deve ser retomada, não duplicada. Nenhuma outra issue ganhou aprovação por esta delegação; novos planos exigem aprovação explícita do responsável e registro de sua versão.

### Sequência funcional de referência

- #3 (interface) e #7 (PostgreSQL) antes de #21 (login).
- #21 antes de #8 (catálogo) e #9 (clientes); ambas antes de #10 (orçamento).
- #10 antes de #12 (pagamentos); #10 e #12 antes de #11 (confirmação) e #15 (contratos).
- #11 e #12 antes de #13 (alterações); #11, #12 e #15 antes de #14 (retirada/devolução).
- #10, #12 e #14 antes de #16 (painel).
- #17 (IA) depende de #7/#21/#10 e das próprias decisões aprovadas; não criar requisito artificial de painel ou WhatsApp.
- #18 (vitrine) e #19 (WhatsApp) são evoluções posteriores; #22 (Google) fica para o final por decisão humana.
- #4 (produção) e #6 (CI/processo) têm planos próprios. Prioridade P0 não substitui Ready nem autoriza deploy; respeitar os gates remotos documentados.

Esta referência não é uma fila paralela nem altera ACs ou dependências de uma versão aprovada. Conferir o plano vigente no GitHub a cada despacho. Mudança relevante exige revalidação humana; planejamento incompleto não vira Ready por aparecer nesta lista.

Mover para Ready autoriza somente o plano daquela versão. Registrar corpo/updatedAt e identidade da aprovação; se a task mudar durante execução, suspender e pedir revalidação. A autorização não abrange alterar regras, ignorar testes ou expandir escopo.

## Uma execução por vez

O heartbeat `rentalops-tarefas-prontas-a-cada-hora` acompanha este chat a cada hora. Ele coordena; a seleção de Sol/high é explícita no despacho do executor/revisor, não uma promessa de que o próprio coordenador mudou de modelo.

1. Reconciliar execução/PR anterior antes de buscar nova task. Verificar agentes ativos, status do quadro e journal; estado incerto bloqueia despacho.
2. Adquirir a execução com owner único por tentativa antes de mover a task ou despachar.
3. Criar/reutilizar checkout isolado sem mexer em alterações do usuário. Registrar issue, versão aprovada, worktree/branch, agente/modelo/esforço, fase e SHA.
4. Disparar somente executor GPT-6.1 Sol/high com o plano humano e padrões versionados. Indisponibilidade do modelo bloqueia, sem troca silenciosa.
5. Rodar pipeline e revisar ACs. Revisor Sol/high em contexto separado inspeciona diff/evidências, não altera código e não se limita ao resumo do executor. Revisão visual usa interface real quando há alteração de UI.
6. Correções voltam ao executor. Limite inicial: até duas rodadas de correção por ciclo; se persistir, Blocked com evidências. Esgotamento de cota é espera, não autorização para trocar conta/modelo ou comprar créditos.
7. Abrir PR para develop e anexá-lo ao chat. Registrar evidências no PR, associadas ao SHA revisado.
8. Fazer merge apenas conforme as condições abaixo; confirmar resultado remoto antes de Done. Uma falha ao atualizar o quadro depois do merge exige reconciliação, não nova implementação.
9. Liberar somente a execução do proprietário, depois que agentes pararam e a retomada estiver documentada. Nunca remover journal ou roubar execução por idade.
10. Continuação sequencial autorizada pelo responsável em 2026-10-03: depois de merge remoto, Done confirmado, evidências registradas e agentes parados, voltar à reconciliação e selecionar a próxima tarefa aprovada elegível. Não é preciso aguardar a próxima hora apenas por concluir uma entrega. Conferir novamente dependências, versão, cota, acesso e modelos; atualizar origin/develop e adquirir novo owner único para a próxima entrega.

Encerrar o executor não conclui a entrega: a coordenação deve cumprir revisão, gates remotos, merge e atualização do quadro antes de avançar. PR aberto, revisão pendente, estado incerto ou falha ao marcar Done exigem retomar a entrega atual, não iniciar outra. Se não houver tarefa aprovada elegível ou faltar cota/acesso/modelo, registrar retomada e aguardar o próximo ciclo. O intervalo horário permanece como mecanismo de recuperação, sem renovar limites ou aprovar planos.

Revisar e aprovar o plano é trabalho humano. A rotina pode executar a promoção previamente delegada e detalhar passos mecânicos durante implementação, mas não existe etapa automática de redefinição ou aprovação do plano.

## Condições obrigatórias para merge em develop

- PR da tarefa aprovada, aberto, não draft, branch de origem esperada do mesmo repositório e base exatamente develop.
- ACs atendidos, testes aplicáveis aprovados e revisão independente sem achados bloqueadores. Pendências manuais exigidas pelo próprio AC impedem merge.
- Branch atualizada em relação à base e sem conflitos. Quando publicado e configurado, `Quality / quality-gate` (nome exato a confirmar na primeira execução remota) deve ser obrigatório no ruleset da develop.
- Consultar configuração e checks remotos antes de cada merge. Todos os checks existentes aplicáveis/obrigatórios devem passar; falha, cancelamento, skip indevido ou resultado desconhecido impedem merge. A ausência confirmada de CI/proteção, enquanto ROP-006 não for entregue, não bloqueia sozinha a integração: autorização explícita do responsável em 2026-10-02. Registrar essa limitação, sem apresentar testes locais como checks remotos.
- Evidências e revisão correspondem ao head SHA atual e à base validada. Mudança de código/base depois da revisão exige revalidar o impacto e repetir verificações.
- Usar merge com precondição do head SHA esperado. Não usar `--admin` nem desabilitar proteção para concluir.
- Não desabilitar nem contornar proteções existentes. ROP-006 continua responsável por impor checks e atualização da base no GitHub; até lá, o coordenador valida head/base e evidências antes da integração autorizada.
- Done significa integrado em develop; não significa lançado em produção.

## Journal local e retomada

`infra/automation/task_lock.py` usa SQLite local em `.rentalops/automation.sqlite3`, sem servidor adicional. Não é o banco do produto. Uma restrição permite apenas uma execução ativa; liberação condicional por owner evita que uma chamada antiga libere outra execução. Owners não são reutilizados e o histórico não é apagado.

Todos os participantes usam a raiz **C:/Projects/praxis/rmg-chatbot**, inclusive em worktrees:

```sh
uv run --project backend python infra/automation/task_lock.py status --workspace C:/Projects/praxis/rmg-chatbot
uv run --project backend python infra/automation/task_lock.py claim --workspace C:/Projects/praxis/rmg-chatbot --owner EXECUTION_ID --task ISSUE_ID
uv run --project backend python infra/automation/task_lock.py checkpoint --workspace C:/Projects/praxis/rmg-chatbot --owner EXECUTION_ID --progress '{"phase":"validating","head_sha":"COMMIT_SHA","agent_id":"AGENT_ID","branch":"BRANCH","issue_revision":"REVISION"}'
uv run --project backend python infra/automation/task_lock.py release --workspace C:/Projects/praxis/rmg-chatbot --owner EXECUTION_ID
```

`checkpoint` substitui o objeto completo de progresso; preservar campos anteriores. Não guardar segredos, CPF/RG ou conteúdo contratual. IDs ilustrativos devem ser substituídos. O lock antigo, caso exista, continua bloqueando até reconciliação explícita; banco inválido também bloqueia. SQLite não é um lock distribuído entre computadores.

O journal registra estado, não comprova sozinho que um agente parou. Antes de liberar/retomar, conferir o agente e o PR. Não apagar SQLite para “destravar”. Se a máquina/app estiver indisponível ou sem cota, não há garantia de execução na próxima hora. Limites não são renovados pelo agendamento.

## Estado de implantação deste processo

Agendamento nativo existente; instruções e ferramentas locais preparadas. GitHub conectado e Project RentalOps criado. Após a entrega ROP-003 há 15 issues abertas, uma concluída e 3 encerradas como não planejadas. O conector não expõe Projects e a credencial local não possui read:project. A interface autenticada permitiu ler Ready e registrar In progress e Done no piloto ROP-003, mas acesso programático estável continua pendente. API remota confirmou develop sem proteção, regras/rulesets vazios e nenhum workflow publicado em 2026-10-02. Após informar essas lacunas, o responsável autorizou a integração; PR #20 foi integrada por squash em develop no commit `2bbac480ae2e082099181b364cd1ab92e7914ffa`. Testes locais e revisão independente passaram; não houve CI remota nem bypass. Não afirmar que texto no prompt é garantia técnica.

O piloto supervisionado ROP-003 foi concluído. A autorização de integração sem confirmação por PR não dispensa Ready aprovado, testes, revisão e verificação dos requisitos remotos existentes. Não inventar tarefa piloto nem tratar este documento como autorização para publicar todas as alterações locais acumuladas.

## Instruções reproduzíveis

`AGENTS.md` permanece ignorado conforme solicitação anterior. Worktrees/clones carregam explicitamente `docs/engineering/standards.md`, este documento, regras e ADRs aprovados. Configuração de agentes do projeto fica em `.codex/agents/`; testar compatibilidade no cliente antes de depender dela.

Referências de capacidade: [tarefas agendadas](https://learn.chatgpt.com/docs/automations?surface=app) e [subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents). O fluxo acima é a política específica deste projeto.
