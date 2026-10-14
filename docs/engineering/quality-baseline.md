# Evidências da base de qualidade

Validação local em Windows, 2026-10-02. Não corresponde a uma execução remota de GitHub Actions nem à conclusão de funcionalidades de locação. A tabela abaixo preserva a primeira validação; a atualização ao final registra o reforço posterior.

| Verificação | Resultado |
| --- | --- |
| Instalação backend com lockfile | Aprovada; nome do módulo configurado como `rentalops_api` |
| Ruff lint/formatação | Aprovados |
| pytest | 6 testes aprovados: saúde, contrato HTTP, rota inexistente, exclusão concorrente, liberação pelo proprietário e lock incompleto |
| ESLint/Prettier | Aprovados |
| Vitest | 2 testes de componente aprovados |
| TypeScript estrito e build | Aprovados |
| Playwright/axe | 4 cenários aprovados em Chromium: 320, 390, 768 e 1440 px; sem violações nos checks WCAG selecionados |
| Revisão visual | Capturas inspecionadas; contraste/tamanho de textos corrigidos; ilustração que interferia com texto em tablet ocultada nesse tamanho |
| Auditoria npm | Nenhuma vulnerabilidade reportada após atualização de `brace-expansion` |
| Links da documentação e whitespace Git | Aprovados |

As capturas e relatório ficam localmente em `frontend/playwright-report/`, ignorados pelo Git. O workflow preserva evidências como artefato quando executado no GitHub.

Limitações: dois avisos de depreciação de dependências no teste HTTP (httpx/TestClient e alias do AnyIO), sem falha; apenas Chromium foi testado; não houve teste em dispositivo físico, comparação visual com baseline de pixels nem avaliação com usuário real. O shell continua exibindo módulos em construção. Não há cobertura de regras de negócio ainda inexistentes. A revisão de cada implementação futura deve adicionar os casos pertinentes, não reutilizar esta evidência como aprovação geral.

A automação horária foi criada, mas o piloto de modelos distintos, o acesso ao GitHub e o ciclo completo de uma issue Ready ainda precisam ser validados. O lock foi testado localmente; não é exclusão distribuída entre computadores.

## Atualização — execução sem planner e reforço de qualidade

- Política alterada pelo responsável: planejamento manual, execução e revisão independente Sol/high; merge em develop autorizado após critérios/checks. Main e deploy continuam fora da automação.
- Corrigida corrida na liberação do lock por arquivos, substituído por journal SQLite com um ativo e liberação condicional. Validada concorrência entre processos, liberação duplicada, proprietário antigo, owner não reutilizável, retomada/progresso e banco inválido.
- **13 testes Python, 2 testes de componente e 4 cenários Chromium aprovados.** Navegador agora testa build de produção, não servidor de desenvolvimento.
- Ruff, mypy estrito, ESLint, Prettier e build aprovados. Configurações YAML/TOML parseadas e SHAs das Actions conferidos; isso não equivale a execução remota dos jobs.
- Auditoria do lockfile Python encontrou alertas em urllib3 2.7.0; atualizada para 2.8.0, nova auditoria sem vulnerabilidades conhecidas. npm audit também sem alertas na consulta.
- Workflow inclui Gitleaks, auditorias e quality-gate. Gitleaks não foi executado localmente nem validado no GitHub; não afirmar que todo histórico está livre de segredos.
- Agendamento existente atualizado com sucesso, sem planner e com condições de merge protegido. Configurações de executor/revisor preparadas; despacho real, revisão independente automatizada, quadro, proteções e merge remoto ainda dependem de conexão/piloto.
- Permanecem os avisos de depreciação de dependências do TestClient. Não foram ignorados com filtros nem convertidos em falhas inexistentes.
