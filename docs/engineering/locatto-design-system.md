# Locatto — identidade visual

Implementação baseada na referência visual e no briefing fornecidos em 26/10/2026.
O escopo é apresentação: nenhum endpoint, regra comercial, autenticação ou contrato
de dados foi alterado.

## Estrutura

- `frontend/src/styles/tokens.css`: cores semânticas, fontes, espaçamentos,
  bordas, raios e sombras. A cor de texto de aviso é mais escura que o tom
  decorativo de aviso para preservar contraste em fundos claros.
- `frontend/src/styles/primitives.css`: apresentação compartilhada dos botões,
  campos, badges, painéis/cards, tabelas, modais, autocomplete e estados existentes.
  Reutiliza os controles nativos, seus rótulos e os handlers atuais; não introduz
  wrappers que alterem submissão, foco ou permissões.
- `AppShell`, `BrandLogo`, `Icon`, `DashboardPage`, `OperationsCalendar`,
  `StatePanel` e `SearchPicker` continuam sendo os componentes compartilhados.
  `Icon` foi ampliado para navegação, métricas e ações do painel.
- Os estilos dos módulos Catálogo, Clientes, Locações, Pagamentos, Preparação,
  Retirada/Devolução e Contratos consomem os mesmos tokens.

## Fontes e imagens

Plus Jakarta Sans variável hospedada localmente em
`frontend/public/fonts/plus-jakarta-sans-variable.ttf`, pesos 400/500/600/700.
Fonte obtida do repositório oficial Google Fonts, diretório
`ofl/plusjakartasans`, acompanhada da licença `OFL.txt`. Não há requisição de fonte
externa em tempo de uso. A logo original fornecida permanece inalterada.

Os balões decorativos estão em
`frontend/public/images/celebration-balloons.png`. Criados com a ferramenta
integrada de geração de imagens (skill `imagegen`), não via API paga externa.
Prompt de geração: “A small loose cluster of five realistic translucent latex
helium balloons with very fine curved strings, in champagne beige, powder blush
rosé and muted light terracotta. Elegant natural soft window light, gentle
pearlescent highlights, not glossy exaggerated 3D, no cartoon, no emojis. Portrait
grouping, genuinely transparent background. No text, logo, scene, UI or watermark.
For low-opacity corners of an ivory interface, palette #F7F3EE, #C98B73, #ECD6CC.”

A decoração é exclusiva do layout global, com `pointer-events: none`, fora da
árvore de acessibilidade e omitida na impressão. Não é repetida em cada card.

## Calendário e acessibilidade

A apresentação mensal inicia no domingo, com dias anteriores decorativos não
interativos, conforme a referência. A semana mantém o intervalo operacional
existente (segunda a domingo). Navegação, callbacks, consultas e datas reais não
mudaram. As células se expandem quando há retiradas/devoluções.

Focus visível, rótulos, estados de carregamento/erro, disabled e controles
de teclado existentes foram preservados. Identidade visual responsiva; o
calendário semanal conserva sua rolagem local em telas menores.

## Validação

Build/typecheck, ESLint, Prettier e suíte Vitest do frontend. Comparação visual
com capturas sintéticas privadas das cinco áreas e em 390/768/1097/1440 px.
Verificações axe em páginas e controles exercitados, sem alegar certificação
integral de WCAG, leitor de tela ou dispositivos físicos. Os testes de apresentação
usam respostas simuladas, sem modificar cadastros ou realizar operações reais.
Backend e banco não precisam de migração para este ajuste.

Resultados desta implementação: 160 testes Vitest em 21 arquivos aprovados;
build/typecheck, ESLint e Prettier aprovados. O build estático também foi exercitado
em um servidor de preview separado: cinco áreas, login e modal de categorias
sem violações axe detectadas nos cenários visitados; fechamento por Escape e
retorno de foco do modal verificados. Mês/semana, aplicação e limpeza de filtros
foram exercitados. Sem overflow horizontal da página nas larguras verificadas.
