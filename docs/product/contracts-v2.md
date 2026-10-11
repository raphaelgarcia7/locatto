# Contratos privados — contracts-v2 / ROP-015

Implementa somente o plano humano da issue15, revisão
`2026-10-10T22:13:33Z`, body SHA-256
`9a1104344f2ffc028b80c00b8834f478a961b9458b10c3956bf21474da199262`.
O corpo histórico contracts-v1 continua aplicável salvo substituições humanas
explícitas da v2. Não implementa retirada/devolução, IA ou integrações externas.

## Documento e gates

Fonte v0.4 aprovada juridicamente segundo confirmação do responsável, não
certificação do agente: SHA-256
`c036ecf76d780e5a2068867710d3d089aa62d5e7c1d42e2dab0fb059145731f0`.
PDF de referência privado SHA-256
`1afe14fd31c363e16e092053f62265a8a8257ad7996f7ce49b0aca23021cb7ad`.
A fonte do pacote conserva bytes originais via atributo Git `-text`; hash/revisão
divergente impede emissão. Somente as nove cláusulas e o termo entram no PDF;
notas históricas de minuta/revisão não entram no final. Rascunho é identificado
em todas as páginas. Campos vazios têm altura mínima de 52 pt e assinaturas 70 pt.

Empresa: nome, identificação, endereço e contato necessários à emissão; logo
opcional JPEG/PNG/WebP até 10 MiB. Cadastro progressivo, com revisão/request_id e
auditoria. Cliente PF: nome completo, CPF, telefone/endereço; RG opcional.
Endereço do evento distinto. Datas, valores, negociação e composição vêm dos
registros persistidos. Para locação confirmada, sinal individual já acordado é
preservado, inclusive após alteração de preço; não se usa 50% genérico do total
novo. Condição e foto legível de cada produto são necessárias no final. Foto
principal do catálogo tem prioridade; API permite escolher outra foto vinculada.
Kit geral não substitui fotos dos componentes; quantidades agregam componentes
por quantidade de linha e avulsos, sem limite artificial de páginas/omissão.

Logo ausente não bloqueia. Foto ausente/corrompida bloqueia final com pendência
por produto, mas permite placeholder no rascunho. Reposição não é campo/gate nem
coluna no PDF; valores existentes no catálogo não são apagados. Marca do sistema
não é fallback. Nenhuma foto fictícia é criada para emissão real.

## Estado, versões e dinheiro

Uma série por orçamento; numeração incremental sem reciclar. Cada emissão
congela empresa/revisão/logo, fonte/revisão/digest, cliente, evento, versões
comercial/financeira/locação, condições, imagens/bytes/chaves/digests e bytes/digest
do PDF. Diferença semântica identifica mudanças sem retornar pixels base64 em
metadados. Alterar catálogo, parâmetros ou arquivos posteriores não reescreve
versão anterior. Eventos são imutáveis e ordenados pela posição serializada.

Entrega manual registra meio/data/motivo, não envia documento. Upload não é
assinatura conferida: versão fica aguardando conferência até a equipe registrar
data e declaração explícita. Cada substituição acrescenta anexo, exige nova
conferência e preserva anteriores. Nova emissão começa pendente, nunca herda
assinatura. Assinatura vigente só satisfaz o contrato técnico para ROP-014 se a
versão assinada for a última e suas versões comercial/locação coincidirem com os
registros atuais. Geração, entrega, upload ou assinatura não alocam estoque,
confirmam reserva ou escrevem financeiro.

O texto aprovado de não reembolso, seis meses/30 dias, cartão parcelado, adesão por
pagamento e R$ 100/dia não cria serviços/automatizações financeiras, cálculo de
multa ou remarcação. Aplicação operacional e devolução parcial permanecem decisão
humana; pagamento não substitui assinatura vigente para retirada.

## APIs e consistência

Todas as rotas exigem sessão interna; mutações exigem Origin/CSRF existente.
Ator/session vêm do servidor. Respostas/downloads privados `no-store`; arquivos
como attachment e `nosniff`, nomes/URLs sem identidade pessoal ou caminho privado.

| Operação | Rotas |
| --- | --- |
| Parâmetros | GET/POST `/parameters`; POST `/parameters/logo`, `/parameters/logo/removal`; GET `/parameters/logo` |
| Preparar/emitir | POST `/quotations/{id}/contracts/preview`; POST/GET `/quotations/{id}/contracts` |
| Versões | GET `/contracts/{id}/versions`, `/versions/{number}`, `/versions/{number}/download` |
| Entrega | POST `/contracts/{id}/versions/{number}/deliveries` |
| Assinatura | POST `/contracts/{id}/versions/{number}/signatures`; POST `/signatures/{attachment_id}/validations`; GET `/signatures/{attachment_id}/download` (sob a mesma versão) |
| Estado vigente | GET `/quotations/{id}/contracts/current-signature-state`; GET `/contracts/{id}/current-signature-state` |

Emissão usa request_id e versões esperadas comercial, financeira, empresa,
locação e contrato. Prévia é somente leitura e retorna pendências/diff/PDF draft.
Eventos usam request_id/expected_contract_version. Mesma chave por
ator/operação/payload retorna resultado original antes de validar versões novas;
payload diferente: 409. Datas ISO/negócio, data exibida de emissão e resumo de
datas automáticas dos anexos em São Paulo; timestamp de auditoria UTC;
moeda decimal
exata. Sessão: 401; Origin: 403; vínculo: 404; versão/idempotência: 409; regra: 422;
arquivo: 413; dependência: 503. Resultado desconhecido bloqueia nova mutação e repete
mesmo payload/chave, sem afirmar sucesso.

Locks: request→quotation→rental→financial→contract series. Parâmetros têm
serialização independente. Captura de pixels e renderer fora da transação;
metadados/versões revalidados antes de publicar. Nenhuma rede ou lock inverso do
catálogo dentro da transação. Publicação e auditoria/request result atômicos.
Falha compensa somente arquivo novo pertencente à operação e comprovadamente
não referenciado; commit desconhecido é reconciliado sob locks com leitura nova.
Se essa consulta também falhar, conserva o arquivo para evitar apagar algo
durável. Nunca apaga arquivo anterior. Não há expurgo automático.

Anexos PDF/JPEG/PNG até 10.000.000 bytes usam a validação segura já existente de
comprovantes: formato/magic/type, pixels/recursos, PDF ativo/criptografado e
truncado rejeitados. Arquivos só no STORAGE_ROOT privado, não no webroot/Git.
CPF/endereço/assinatura não entram em logs, issues ou traces. Testes geram contato
sintético em runtime; provas visuais não usam dados reais. Retenção/backups e
restore de documentos permanecem gate operacional antes de produção.
