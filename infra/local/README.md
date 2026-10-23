# RentalOps no computador da locadora

Depois da instalação inicial, use **Abrir RentalOps** na área de trabalho. Aguarde
a janela informar que o sistema está pronto; o navegador abre em
<http://localhost:8080> (ou no endereço HTTPS local, se o acesso pelo celular foi
configurado). O Docker Desktop é iniciado automaticamente quando
necessário. Não é preciso abrir terminal, instalar Python ou Node, nem reconstruir
imagens para usar o sistema diariamente. O computador precisa estar ligado.

**Fechar RentalOps** faz um backup e encerra os serviços. Fechar somente a aba do
navegador mantém o sistema funcionando. **Backup RentalOps** cria uma cópia na
hora. O backup também acontece ao abrir se a última cópia tiver mais de 24 horas,
e pelo agendamento diário das 18h, quando permitido pelo Windows. Uma execução
perdida é retomada quando o Windows permitir. Não há exclusão automática de cópias.

Banco, fotos, documentos e arquivos de operação ficam em volumes persistentes do
Docker Desktop, separados do Git. Não use “limpar todos os volumes”, “factory
reset” ou desinstalação com remoção de dados no Docker. Alterar o código ou fechar
o sistema não remove os cadastros. O banco não publica porta na rede; a interface
fica restrita a este PC por padrão e pode ser habilitada no Wi-Fi doméstico com
HTTPS. O MinIO já existente não pertence a esta instalação.

As cópias cifradas ficam em `%LOCALAPPDATA%\RentalOps\Backups`. A chave de recuperação
fica em `%LOCALAPPDATA%\RentalOps\backup-recovery-key.txt`, sob permissão privada
da conta Windows usada na instalação. Guarde também uma cópia dessa chave e dos
backups em um pendrive ou outro disco seguro. Cópias apenas no mesmo computador
não protegem contra perda do equipamento ou do disco. Nenhuma cópia externa é
configurada automaticamente sem um destino disponível.

## Operação técnica

Todos os comandos selecionam explicitamente o contexto `desktop-linux`. A
configuração padrão é exclusiva para acesso por `localhost`, com autenticação
individual e HTTP local. `APP_ENV=development` permite esse HTTP; o frontend servido
é o build estático, e não o servidor de desenvolvimento. Para usar o telefone
somente no Wi-Fi de casa, rode `desktop.ps1 -Action ConfigureMobile`. Isso cria uma
autoridade local de certificados, ativa HTTPS e limita a publicação ao IP atual do
Wi-Fi; não abre o roteador nem publica o banco. O perfil do certificado do iPhone
é servido sem credenciais em HTTP local para instalação inicial; depois, o app usa
apenas HTTPS. No iPhone é necessário instalar o perfil e ativar a confiança em
**Ajustes > Geral > Sobre > Ajustes de Confiança de Certificados**. Como o Windows
marca esta rede como Pública, uma regra restrita do Firewall precisa ser criada
uma vez como administrador. Se o IP do Wi-Fi mudar, rode `ConfigureMobile` novamente
e atualize essa regra. Use apenas na rede doméstica confiável, nunca em Wi-Fi
público.

O arquivo `desktop.ps1` oferece `Start`, `ConfigureMobile`, `Stop`, `Backup`,
`VerifyBackup` e `Status`.
Um mutex por sessão impede operações simultâneas pelos atalhos. Senhas geradas
ficam em `%LOCALAPPDATA%\RentalOps`, fora do repositório. A conta de runtime do
PostgreSQL não é superusuária. As operações de backup usam a barreira de manutenção
do aplicativo, `pg_dump` 17 e `age`, incluindo arquivos e manifesto cifrado. A cópia
exportada para Windows tem seu SHA-256 comparado antes de registrar sucesso.

Instalação inicial por um responsável técnico, com dump PostgreSQL 17 sem owner/ACL
e um `storage.tar` contendo a raiz privada completa:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/local/desktop.ps1 -Action Install -ImportDirectory "CAMINHO_PRIVADO_DA_COPIA"
```

O instalador recusa configuração já existente para evitar sobrescrever uma
instalação parcial. Nunca apagar volumes ou arquivos de configuração para forçar
uma nova tentativa; primeiro reconciliar o estágio que falhou. O dump anterior e
o banco de origem devem ser preservados até conferência da cópia e da aplicação.

Para conferir a integridade do último pacote:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/local/desktop.ps1 -Action VerifyBackup -NoBrowser
```

A verificação confere a decriptação, os hashes do banco/arquivos e referências de
fotos/comprovantes. Não substitui um ensaio de restauração em banco descartável.
Atualizações são feitas pelo responsável técnico: backup, novas imagens do código
revisado, migrações explícitas com a conta de migração, verificação de prontidão.
Os atalhos nunca executam `git pull`, migrações ou builds automaticamente.

Se o agendamento for recusado, `schedule-warning.txt` registra a limitação e o
backup ao abrir continua disponível. Falhas interativas são mostradas na janela;
o agendamento registra código de saída no Histórico do Agendador de Tarefas.
