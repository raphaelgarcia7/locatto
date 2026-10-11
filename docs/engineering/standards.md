# Padrões de engenharia e qualidade

Padrões solicitados pelo responsável em 2026-10-02. Aplicam-se a pessoas e agentes. Este arquivo é versionável; o `AGENTS.md` da raiz continua ignorado conforme pedido anterior.

## Código

- Nomes em inglês, expressivos; comunicação e conteúdo da operação em português. Commits semânticos em inglês, sem emojis.
- Funções e componentes coesos, responsabilidades explícitas, validação nas fronteiras e erros úteis. Preferir composição e dependências explícitas.
- Clean Code e SOLID são critérios de julgamento, não motivo para criar camadas, interfaces ou serviços sem necessidade. Evitar overengineering, duplicação relevante e abstrações especulativas.
- Python: quatro espaços, type hints, Ruff para lint/formatação, mypy estrito nos fontes e pytest para testes. Frontend: TypeScript, ESLint e Prettier, sem `any` não justificado.
- Domínio independente do modelo de IA e da interface. Valores monetários exatos, regras determinísticas, concorrência e idempotência onde há efeitos comerciais.
- Segurança: não versionar credenciais; não usar dados pessoais reais nos testes; não divulgar contratos/CPF/RG/endereço/assinatura em logs, issues ou traces.

## UI/UX

Objetivo: interface amigável, consistente, bonita e orientada às tarefas da locadora. Validar a clareza com quem atende e confere materiais; opinião do agente não substitui essa validação.

- Layout fluido de 320 px a telas grandes, sem conteúdo essencial cortado; testar ao menos 320, 390, 768 e 1440 px, além de zoom e orientação quando relevante.
- Navegação e ações essenciais disponíveis também no celular; alvos de toque confortáveis, foco visível e operação por teclado.
- Hierarquia clara, tipografia legível, contraste, rótulos explícitos e mensagens de erro com próximo passo. Cor não é o único indicador.
- Estados de vazio, carregamento, erro, sucesso e ação pendente. Não confirmar estoque/pagamento antes de confirmação do servidor.
- Animações discretas, sem impedir interação; respeitar `prefers-reduced-motion`.
- Componentes e tokens reutilizáveis; feedback próximo da ação; confirmação explícita para operações consequentes.

## Pipeline por implementação

Preparação de ambiente é responsabilidade da execução: conforme autorização de 2026-10-09 em [codex-delivery.md](codex-delivery.md), resolver autonomamente bloqueios locais seguros (inclusive WSL/Ubuntu, dependências gratuitas e pastas Linux privadas), preservando recursos existentes e registrando alterações/verificação no journal. Não solicitar novamente autorização já concedida nem relaxar os gates abaixo; intervenção humana fica reservada aos limites reais descritos naquela política.

1. Ler plano humano, ACs, riscos e regras aprovadas antes de editar. A rotina não cria um novo plano de produto.
2. Implementar e adicionar testes de unidade/componente, integração e regressão pertinentes. Cada bug corrigido deve ganhar teste quando reproduzível automaticamente.
3. Rodar lint, formatação, tipos/build e suítes existentes. Falha ou teste não executado fica explícito; nunca converter falha em skip silencioso.
4. Rodar fluxos de navegador nos tamanhos-alvo, verificar acessibilidade automatizada e guardar evidências. Testes de viewport não provam funcionamento em todo dispositivo real.
5. Revisor independente em contexto separado, usando Sol/high, verifica diff e UI real: legibilidade, responsabilidades, segurança, responsividade, consistência visual e facilidade do fluxo. Registrar SHA, achados e correções.
6. Relacionar cada AC a evidência. Merge automático autorizado somente em develop, para task aprovada, sem achados bloqueadores, com SHA validado e checks/proteções existentes respeitados. Enquanto ROP-006 não publicar CI/proteção, a ausência confirmada não bloqueia sozinha a integração, conforme autorização explícita do responsável e limites de codex-delivery.md. Nunca declarar checks inexistentes como aprovados. Main e implantação ficam sob controle humano.

## Base automatizada atual

O workflow `Quality` verifica backend (Ruff/mypy/pytest/pip-audit), frontend (ESLint/Prettier/Vitest/build/npm audit), navegador contra build de produção (Playwright/axe) e segredos (Gitleaks). Actions estão fixadas em SHAs verificados. O job final quality-gate falha se qualquer job necessário não passar. Os testes atuais cobrem saúde, shell e coordenação; ainda não cobrem regras de aluguel inexistentes.

Resultados e limitações da primeira execução: [evidências da base](quality-baseline.md).

Os testes de navegador geram capturas para inspeção, não uma aprovação visual automática. Regressão visual por comparação de pixels exige baselines revisadas no mesmo ambiente; não atualizar imagens para esconder defeitos. Testes de acessibilidade também não certificam conformidade completa.

### Comandos

Na raiz:

```sh
uv sync --project backend --locked
uv run --project backend ruff check backend infra
uv run --project backend ruff format --check backend infra
uv run --project backend mypy --config-file backend/pyproject.toml
uv run --project backend python -m pytest -c backend/pyproject.toml backend/tests infra/tests
```

Em `frontend/`:

```sh
npm ci
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI não tem chave de IA, credencial de cliente ou acesso à produção; o token padrão do GitHub fica com leitura. Avaliações com modelo real exigirão orçamento autorizado e dados anonimizados. Publicar workflow não configura proteção de branch nem equivale à revisão independente do agente.

## Segurança e manutenção

- pip-audit verifica versões de terceiros exportadas do lockfile, incluindo grupos de desenvolvimento; o projeto local não é um pacote público a consultar. Falha de consulta/coleta bloqueia em vez de ser apresentada como auditoria limpa.
- npm audit bloqueia alertas altos/críticos; revisar também avisos inferiores. Exceção exige justificativa aprovada, prazo e acompanhamento; nunca ignorar um alerta apenas para passar CI.
- Gitleaks verifica histórico no GitHub. A execução remota e eventuais requisitos da conta/organização precisam ser validados; não desativar o check por faltar licença/acesso.
- Dependabot propõe atualizações semanais em develop. PR de dependência não ganha merge automático só por existir: precisa de task aprovada ou política específica posterior.
- Requisitos de branch protection e acesso estão em [execução horária](codex-delivery.md). Não habilitar bypass para a automação.

## Arquitetura e próximos testes

Seguir [ADR-001](../decisions/001-modular-architecture.md). Quando banco/casos de uso existirem, adicionar testes com banco real, migrações, concorrência, idempotência, datas e valores. São trabalho de engenharia do agente nas tasks correspondentes, não uma obrigação manual de o responsável escrever testes.

O responsável fornece decisões, exemplos reais anonimizados, template contratual, acessos e validação operacional. Backup/restauração, monitoramento e testes de carga precisam de tasks antes de produção, não antes de todo CRUD. Nenhum AC obrigatório pode ser ignorado sob a justificativa de que o usuário fará depois.
