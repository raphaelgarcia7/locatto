# Controles de entrega

O SQLite é um journal local de coordenação, não persistência do produto. Todos os
checkouts usam `--workspace C:/Projects/praxis/locatto`. Nunca apagar o banco,
roubar um owner por idade ou reutilizar um owner encerrado. `checkpoint` substitui
o objeto completo: ler e preservar os campos anteriores antes de atualizar.
Testes usam exclusivamente `tmp_path`, sem acesso ao journal compartilhado.

`python -m infra.automation.projects read --project PROJECT_ID --item ITEM_ID`
consulta a API Projects v2 pela sessão existente de `gh`. Não lê/exporta tokens.
Retorna identificação da issue, closed separado de Status, prioridade, revisão,
SHA-256 UTF-8 do body e os seis statuses. Paginação incompleta, falta de acesso,
resposta inválida ou revisão divergente interrompem a operação.

`move` exige `--workspace`, `--owner`, `--expected-previous-status`, `--target`,
`--updated-at` e `--body-sha256`. Confere o owner compartilhado, relê a revisão e
Status antes de escrever e confirma por nova leitura depois. O mesmo target já
confirmado é replay sem segunda escrita. Falha de escrita/leitura é resultado
desconhecido: consultar o mesmo item antes de repetir, jamais anunciar sucesso.
Issue fechada não recebe escrita automática. A API GitHub não oferece CAS para
esse campo: o expected status protege nossa execução sob o lock único, mas não
torna atômica uma mudança humana concorrente. Divergência exige reconciliação.

`coordinator.next_action` é a decisão determinística testável usada no ensaio do
coordenador; não despacha agentes, escolhe modelos, aprova planos ou faz merges.
A integração humana/agendada consulta estado remoto e preenche os fatos atuais.
Ready, dependências Done+merge, revisão aprovada, decisões resolvidas, acesso,
cota, modelos exatos e owner conhecido são necessários ao despacho. Escopo atual
até ROP-016. Depois de interrupção, reutilizar a execução/PR existente. Depois de
merge remoto, o único próximo trabalho é reconciliar o Project; não reimplementar.
Closed não substitui Done. Agentes parados são necessários antes do encerramento
e liberação. O journal sozinho não comprova que um agente parou.

## Reconciliação manual

1. Confirmar agentes/checkout/owner, head/base e PR remoto; não liberar por timeout.
2. Conferir issue aberta, aprovação exata, dependências e Status via API. Se a API
   falhar, usar a UI autenticada apenas para investigação/recuperação documentada;
   não declarar acesso programático estável sem nova consulta real.
3. Antes do PR, retomar o mesmo checkout. Após publicar, consultar/reutilizar o PR.
   Após merge, confirmar SHA/ancestralidade em origin/develop e mover apenas o mesmo
   item para Done. Falha nessa etapa fica `reconciliation_pending` no checkpoint.
4. Conferir todos os checks e proteção real. Revisão independente deve corresponder
   ao head/base atuais. Usar precondição de SHA no squash de PR para develop.
5. Registrar AC→evidência/modelos/recursos/retomada. Confirmar todos os agentes
   parados antes de liberar condicionalmente o owner; então selecionar outra tarefa.

## Quality

O workflow executa backend com PostgreSQL17 real e ferramentas age/nginx/PG17,
auditorias dos lockfiles, frontend e build, navegador contra produção nas quatro
larguras, e Gitleaks do histórico. Jobs usam token read-only, actions por SHA e
nenhum segredo de produção. Cada runner Linux inicia um cluster nativo privado
PG17 em loopback:15446; assim o teste de proteção libpq verifica o endereço real,
sem NAT Docker. `trust` vale somente para esse cluster descartável de CI. O job
para apenas seu próprio cluster ao terminar. Compose 5.3.0 e Gitleaks 8.30.1 são
obtidos dos releases oficiais e verificados por SHA-256 antes de executar.

`quality-gate` executa o mesmo `quality_gate.py` testado localmente e exige success
explícito de backend/frontend/browser/secrets. Failure, skipped, cancelled, ausente
e desconhecido falham. Cancelar a execução inteira também impede sucesso do check
obrigatório. Não há filtro por paths que possa dispensar o check de um PR.
O nome/contexto só é configurado na proteção após existir uma execução remota real.
Proteção de develop exige PR, base atualizada, check final, sem bypass/force/delete.
Main e deploy estão fora do workflow e desta automação.

Comandos reproduzíveis na raiz:

```sh
uv sync --project backend --locked
uv run --project backend ruff check backend infra
uv run --project backend ruff format --check backend infra
uv run --project backend mypy --config-file backend/pyproject.toml
uv run --project backend python -m pytest -c backend/pyproject.toml backend/tests infra/tests -q
```

O último comando exige TEST_DATABASE_URL descartável em loopback, PG17 client,
age/age-keygen e nginx no PATH. `TEST_NGINX_BINARY` pode apontar o nginx absoluto.
Windows pode usar o harness Linux privado conforme a autonomia já autorizada;
nenhum guard de privacidade ou assertion é relaxado.
