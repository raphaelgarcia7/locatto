# RentalOps on this Windows account. All Docker commands select Desktop explicitly.
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Start', 'ConfigureMobile', 'Stop', 'Backup', 'VerifyBackup', 'Status')]
    [string]$Action = 'Start',
    [string]$ImportDirectory,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$LauncherPath = $PSCommandPath
$DataRoot = Join-Path $env:LOCALAPPDATA 'RentalOps'
$ComposeFile = Join-Path $PSScriptRoot 'compose.yaml'
$MobileComposeFile = Join-Path $PSScriptRoot 'compose.mobile.yaml'
$ComposeEnv = Join-Path $DataRoot 'compose.env'
$BackendEnv = Join-Path $DataRoot 'backend.env'
$BackupRoot = Join-Path $DataRoot 'Backups'
$Docker = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Protect-Directory([string]$Path) {
    [void][IO.Directory]::CreateDirectory($Path)
    if ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'A pasta privada não pode ser um atalho para outro local.' }
    $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & "$env:SystemRoot\System32\icacls.exe" $Path /inheritance:r /grant:r "*${owner}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível proteger a pasta privada do RentalOps.' }
}

function Invoke-Docker {
    param([string[]]$DockerArguments)
    $ErrorActionPreference = 'Continue'
    $errorFile = Join-Path $DataRoot 'docker-current-error.txt'
    $output = & $Docker --context desktop-linux @DockerArguments 2> $errorFile
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $errorFile -Destination (Join-Path $DataRoot 'last-docker-error.txt') -Force
        throw 'O Docker não concluiu a operação. Os dados foram preservados.'
    }
    return ($output | Out-String).Trim()
}

function Invoke-Compose {
    param([string[]]$ComposeArguments)
    $files = @('--file', $ComposeFile)
    if (Get-MobileOrigin) { $files += @('--file', $MobileComposeFile) }
    Invoke-Docker -DockerArguments (@('compose', '--project-name', 'rentalops-desktop', '--env-file', $ComposeEnv) + $files + $ComposeArguments)
}

function Get-MobileOrigin {
    if (-not (Test-Path -LiteralPath $ComposeEnv)) { return $null }
    $line = Get-Content -LiteralPath $ComposeEnv | Where-Object { $_ -match '^RENTALOPS_ORIGIN=https://' } | Select-Object -Last 1
    if ($line) { return $line.Substring('RENTALOPS_ORIGIN='.Length) }
    return $null
}

function Wait-Docker {
    $ErrorActionPreference = 'Continue'
    if (-not (Test-Path -LiteralPath $Docker)) { throw 'O Docker Desktop precisa estar instalado neste computador.' }
    & $Docker --context desktop-linux info --format '{{.OSType}}' *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Iniciando o Docker. Aguarde alguns instantes...'
        Start-Process -FilePath (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe') -WindowStyle Hidden -ErrorAction Stop
        $deadline = (Get-Date).AddMinutes(4)
        do {
            Start-Sleep -Seconds 3
            & $Docker --context desktop-linux info --format '{{.OSType}}' *> $null
            if ($LASTEXITCODE -eq 0) { return }
        } while ((Get-Date) -lt $deadline)
        throw 'O Docker ainda não ficou pronto. Abra o Docker Desktop e tente novamente.'
    }
}

function Start-App {
    if (-not (Test-Path -LiteralPath (Join-Path $DataRoot 'installed.json'))) {
        throw 'A instalação inicial do RentalOps ainda precisa ser concluída.'
    }
    $mobileOrigin = Get-MobileOrigin
    if ($mobileOrigin) {
        $savedIp = (Get-Content -LiteralPath $ComposeEnv | Where-Object { $_ -match '^RENTALOPS_LAN_IP=' } | Select-Object -Last 1)
        $currentIp = (Get-WifiAddress).IPAddress
        if (-not $savedIp -or $savedIp.Substring('RENTALOPS_LAN_IP='.Length) -ne $currentIp) {
            throw 'O endereço do Wi-Fi mudou. Conecte à rede de casa e execute ConfigureMobile para atualizar o acesso do telefone.'
        }
    }
    Write-Host 'Preparando o RentalOps...'
    [void](Invoke-Compose -ComposeArguments @('up', '-d', '--no-build', '--wait', '--wait-timeout', '180'))
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8080/api/ready' -TimeoutSec 10
    if ($response.StatusCode -ne 200) { throw 'O sistema ainda não está pronto para uso.' }
}

function Save-Backup {
    Write-Host 'Guardando uma cópia de segurança do banco, fotos e documentos...'
    $result = (Invoke-Compose -ComposeArguments @('exec', '-T', 'backend', 'python', '-m', 'infra.operations.backup', 'backup', '--storage-root', '/private/photos', '--operations-root', '/private/operations', '--output-dir', '/private/backups', '--recipient-file', '/private/keys/recipient.txt')) | ConvertFrom-Json
    if ($result.status -ne 'published' -or $result.point -notmatch '^point-[0-9a-f]{32}$') { throw 'A cópia de segurança não foi concluída.' }
    $container = Invoke-Compose -ComposeArguments @('ps', '-q', 'backend')
    [void](Invoke-Docker -DockerArguments @('cp', "${container}:/private/backups/$($result.point)", $BackupRoot))
    $point = Join-Path $BackupRoot $result.point
    $receipt = Get-Content -LiteralPath (Join-Path $point 'manifest.json') -Raw | ConvertFrom-Json
    $hash = (Get-FileHash -LiteralPath (Join-Path $point 'package.tar.age') -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $receipt.ciphertext_sha256) { throw 'Não foi possível conferir a cópia de segurança.' }
    [IO.File]::WriteAllText((Join-Path $DataRoot 'last-backup.json'), ($receipt | ConvertTo-Json), $Utf8)
    Write-Host 'Cópia de segurança concluída.'
}

function Set-ComposeValues([hashtable]$Values) {
    $lines = @()
    if (Test-Path -LiteralPath $ComposeEnv) {
        $lines = @(Get-Content -LiteralPath $ComposeEnv | Where-Object {
            $key = ($_ -split '=', 2)[0]
            -not $Values.ContainsKey($key)
        })
    }
    foreach ($key in $Values.Keys) { $lines += "$key=$($Values[$key])" }
    [IO.File]::WriteAllLines($ComposeEnv, $lines, $Utf8)
}

function Invoke-OpenSSL([string[]]$Arguments) {
    $OpenSSL = Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'
    if (-not (Test-Path -LiteralPath $OpenSSL)) { throw 'O OpenSSL do Git não foi encontrado neste computador.' }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $OpenSSL
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $quotedArguments = foreach ($argument in $Arguments) { '"' + ($argument -replace '"', '\"') + '"' }
    $startInfo.Arguments = $quotedArguments -join ' '
    $process = [Diagnostics.Process]::Start($startInfo)
    $null = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($exitCode -ne 0) { throw 'Não foi possível preparar o certificado local. Nenhuma chave foi exibida.' }
}

function Get-WifiAddress {
    $address = Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1
    if (-not $address -or $address.IPAddress -notmatch '^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.') {
        throw 'Não encontrei um endereço IPv4 privado ativo na rede Wi-Fi. Conecte o computador ao Wi-Fi de casa e tente novamente.'
    }
    return $address
}

function Get-WifiSubnet([Microsoft.Management.Infrastructure.CimInstance]$Address) {
    $route = Get-NetRoute -InterfaceAlias $Address.InterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.DestinationPrefix -match "/$($Address.PrefixLength)$" -and $_.DestinationPrefix -notmatch '^(224|239)\.' } |
        Select-Object -First 1
    if (-not $route) { throw 'Não foi possível confirmar a faixa local do Wi-Fi; nenhuma regra de rede foi criada.' }
    return $route.DestinationPrefix
}

function Configure-MobileAccess {
    if (-not (Test-Path -LiteralPath (Join-Path $DataRoot 'installed.json'))) { throw 'A instalação inicial do RentalOps ainda precisa ser concluída.' }
    $address = Get-WifiAddress
    $LanIp = $address.IPAddress
    $subnet = Get-WifiSubnet $address
    $CaRoot = Join-Path $DataRoot 'mobile-ca'
    $TlsRoot = Join-Path $DataRoot 'mobile-tls'
    Protect-Directory $CaRoot
    Protect-Directory $TlsRoot
    $caKey = Join-Path $CaRoot 'root-key.pem'
    $caCertificate = Join-Path $CaRoot 'root.crt'
    $caDer = Join-Path $TlsRoot 'rentalops-home-wifi-root.cer'
    $serverKey = Join-Path $TlsRoot 'server-key.pem'
    $serverCsr = Join-Path $TlsRoot 'server.csr'
    $serverCert = Join-Path $TlsRoot 'server.crt'
    $extensions = Join-Path $TlsRoot 'server-extensions.cnf'
    $mobileConfig = Join-Path $TlsRoot 'rentalops-home-wifi.mobileconfig'
    if ((Test-Path -LiteralPath $caKey) -xor (Test-Path -LiteralPath $caCertificate)) { throw 'A autoridade de certificados local está incompleta. Preserve os arquivos e peça reconciliação antes de continuar.' }
    if (-not (Test-Path -LiteralPath $caKey)) {
        Invoke-OpenSSL @('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', $caKey)
        Invoke-OpenSSL @('req', '-x509', '-new', '-key', $caKey, '-sha256', '-days', '3650', '-subj', '/CN=RentalOps Home Wi-Fi Root', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', $caCertificate)
    }
    Invoke-OpenSSL @('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', $serverKey)
    Invoke-OpenSSL @('req', '-new', '-key', $serverKey, '-subj', "/CN=$LanIp", '-out', $serverCsr)
    $extensionsText = "basicConstraints=critical,CA:FALSE`nkeyUsage=critical,digitalSignature,keyEncipherment`nextendedKeyUsage=serverAuth`nsubjectAltName=IP:$LanIp`nsubjectKeyIdentifier=hash`nauthorityKeyIdentifier=keyid,issuer`n"
    [IO.File]::WriteAllText($extensions, $extensionsText, $Utf8)
    Invoke-OpenSSL @('x509', '-req', '-in', $serverCsr, '-CA', $caCertificate, '-CAkey', $caKey, '-CAcreateserial', '-out', $serverCert, '-days', '397', '-sha256', '-extfile', $extensions)
    Invoke-OpenSSL @('x509', '-in', $caCertificate, '-outform', 'DER', '-out', $caDer)
    Remove-Item -LiteralPath $serverCsr, $extensions -Force

    $certificateData = [Convert]::ToBase64String([IO.File]::ReadAllBytes($caDer))
    $payloadUUID = [guid]::NewGuid().ToString().ToUpperInvariant()
    $profileUUID = [guid]::NewGuid().ToString().ToUpperInvariant()
    $profile = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>PayloadContent</key><array><dict>
<key>PayloadContent</key><data>$certificateData</data>
<key>PayloadDescription</key><string>Autoridade local usada somente para acessar o RentalOps no Wi-Fi de casa.</string>
<key>PayloadDisplayName</key><string>RentalOps Wi-Fi de casa</string>
<key>PayloadIdentifier</key><string>com.rentalops.homewifi.root</string>
<key>PayloadOrganization</key><string>RentalOps local</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>$payloadUUID</string><key>PayloadVersion</key><integer>1</integer>
</dict></array><key>PayloadDescription</key><string>Certificado local para acesso privado ao RentalOps pela rede Wi-Fi de casa.</string>
<key>PayloadDisplayName</key><string>RentalOps Wi-Fi de casa</string>
<key>PayloadIdentifier</key><string>com.rentalops.homewifi.profile</string>
<key>PayloadRemovalDisallowed</key><false/><key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>$profileUUID</string><key>PayloadVersion</key><integer>1</integer>
</dict></plist>
"@
    [IO.File]::WriteAllText($mobileConfig, $profile, $Utf8)
    $rootCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($caDer)
    $certificateStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
    try {
        $certificateStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        if (-not $certificateStore.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $rootCertificate.Thumbprint, $false).Count) {
            $certificateStore.Add($rootCertificate)
        }
    } catch { throw 'O certificado foi criado, mas o Windows não conseguiu registrá-lo para esta conta. Nenhum arquivo de dados foi alterado.' }
    finally { $certificateStore.Close(); $rootCertificate.Dispose() }

    Write-Host 'Guardando um backup antes de ativar o acesso pelo Wi-Fi...'
    Save-Backup
    Write-Host 'Preparando a imagem do acesso seguro...'
    [void](Invoke-Compose -ComposeArguments @('build', 'frontend'))
    Set-ComposeValues @{ RENTALOPS_LAN_IP = $LanIp; RENTALOPS_ORIGIN = "https://${LanIp}:8443" }
    [void](Invoke-Compose -ComposeArguments @('run', '--rm', '--no-deps', 'prepare'))
    $helper = Invoke-Compose -ComposeArguments @('run', '-d', '--no-deps', '--entrypoint', 'sleep', 'prepare', '600')
    try {
        foreach ($file in @(@($serverCert, 'server.crt', '644'), @($serverKey, 'server-key.pem', '600'), @($mobileConfig, 'rentalops-home-wifi.mobileconfig', '644'))) {
            [void](Invoke-Docker -DockerArguments @('cp', $file[0], "${helper}:/private/mobile-tls/$($file[1])"))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'chmod', $file[2], "/private/mobile-tls/$($file[1])"))
        }
    } finally { [void](Invoke-Docker -DockerArguments @('rm', '-f', $helper)) }
    [void](Invoke-Compose -ComposeArguments @('up', '-d', '--build', '--wait', '--wait-timeout', '180', 'backend', 'frontend'))
    $fingerprint = (Get-FileHash -LiteralPath $caDer -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "Acesso seguro preparado: https://${LanIp}:8443"
    Write-Host "Perfil do iPhone: http://${LanIp}:8080/rentalops-home-wifi.mobileconfig"
    Write-Host "Certificado raiz SHA-256: $fingerprint"
    Write-Host "O Wi-Fi está marcado como Público. Para liberar somente essa rede, abra o PowerShell como administrador e execute: New-NetFirewallRule -DisplayName 'RentalOps Home Wi-Fi' -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $LanIp -LocalPort 8080,8443 -RemoteAddress $subnet -InterfaceAlias '$($address.InterfaceAlias)' -Profile Any"
}

function Install-Shortcuts {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    foreach ($item in @(@('Abrir RentalOps', 'Start'), @('Fechar RentalOps', 'Stop'), @('Backup RentalOps', 'Backup'))) {
        $link = $shell.CreateShortcut((Join-Path $desktop ($item[0] + '.lnk')))
        $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $LauncherPath + '" -Action ' + $item[1]
        $link.WorkingDirectory = $DataRoot
        $link.Description = $item[0]
        $link.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
        $link.Save()
    }
    # HKCU only: no administrator rights or credentials are required.
    $task = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $LauncherPath + '" -Action Backup -NoBrowser')
    $trigger = New-ScheduledTaskTrigger -Daily -At '18:00'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
    try {
        Register-ScheduledTask -TaskName 'RentalOps Backup Local' -Action $task -Trigger $trigger -Settings $settings -Description 'Cópia cifrada do RentalOps enquanto o computador estiver ligado.' -Force | Out-Null
        if (Test-Path -LiteralPath (Join-Path $DataRoot 'schedule-warning.txt')) { Remove-Item -LiteralPath (Join-Path $DataRoot 'schedule-warning.txt') }
    } catch {
        # Logon plus backup-on-start remains available when Task Scheduler is restricted.
        [IO.File]::WriteAllText((Join-Path $DataRoot 'schedule-warning.txt'), 'O Windows recusou o agendamento diário. O backup continua automático ao abrir o RentalOps a cada 24 horas.', $Utf8)
    }
}

$mutex = New-Object Threading.Mutex($false, 'Local\RentalOpsDesktopOperation')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { throw 'O RentalOps já está iniciando ou fazendo backup. Aguarde e tente novamente.' }
    Protect-Directory $DataRoot
    Protect-Directory $BackupRoot
    Wait-Docker
    if ($Action -eq 'ConfigureMobile') {
        Configure-MobileAccess
    } elseif ($Action -eq 'Install') {
        if (Test-Path -LiteralPath (Join-Path $DataRoot 'installed.json')) { throw 'O RentalOps já está instalado. Use Abrir RentalOps.' }
        if (-not $ImportDirectory -or -not (Test-Path -LiteralPath (Join-Path $ImportDirectory 'database.dump')) -or -not (Test-Path -LiteralPath (Join-Path $ImportDirectory 'storage.tar'))) { throw 'Informe a cópia dos dados para a instalação inicial.' }
        if (Test-Path -LiteralPath $ComposeEnv) { throw 'Há uma instalação incompleta. É necessário reconciliar os dados antes de continuar.' }
        $existingVolumes = Invoke-Docker -DockerArguments @('volume', 'ls', '--filter', 'name=rentalops-desktop-', '--format', '{{.Name}}')
        if ($existingVolumes) { throw 'Foram encontrados dados de uma instalação anterior. É necessário recuperar a configuração antes de continuar.' }
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 32
        $rng.GetBytes($bytes)
        $bootstrapPassword = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $rng.GetBytes($bytes)
        $runtimePassword = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $rng.GetBytes($bytes)
        $rateKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
        $rng.Dispose()
        [IO.File]::WriteAllText((Join-Path $DataRoot 'postgres-password'), $bootstrapPassword, $Utf8)
        [IO.File]::WriteAllText($BackendEnv, "DATABASE_URL=postgresql+psycopg://rentalops_runtime:${runtimePassword}@database:5432/rentalops`nAUTH_RATE_KEY=$rateKey`n", $Utf8)
        [IO.File]::WriteAllText($ComposeEnv, "RENTALOPS_BACKEND_ENV=$($BackendEnv.Replace('\','/'))`nRENTALOPS_POSTGRES_PASSWORD_FILE=$((Join-Path $DataRoot 'postgres-password').Replace('\','/'))`n", $Utf8)
        Write-Host 'Preparando as imagens do sistema. Esta etapa é feita somente na instalação ou atualização...'
        [void](Invoke-Compose -ComposeArguments @('build', 'prepare', 'frontend'))
        [void](Invoke-Compose -ComposeArguments @('run', '--rm', '--no-deps', 'prepare'))
        $helper = Invoke-Compose -ComposeArguments @('run', '-d', '--no-deps', '--entrypoint', 'sleep', 'prepare', '600')
        try {
            [void](Invoke-Docker -DockerArguments @('cp', (Join-Path $DataRoot 'postgres-password'), "${helper}:/private/database-auth/postgres-password"))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'chmod', '600', '/private/database-auth/postgres-password'))
        } finally { [void](Invoke-Docker -DockerArguments @('rm', '-f', $helper)) }
        [void](Invoke-Compose -ComposeArguments @('up', '-d', '--wait', 'database'))
        $db = Invoke-Compose -ComposeArguments @('ps', '-q', 'database')
        [void](Invoke-Docker -DockerArguments @('cp', (Join-Path $ImportDirectory 'database.dump'), "${db}:/tmp/import.dump"))
        [void](Invoke-Docker -DockerArguments @('exec', $db, 'pg_restore', '-U', 'rentalops_bootstrap', '-d', 'rentalops', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '/tmp/import.dump'))
        [void](Invoke-Docker -DockerArguments @('exec', $db, 'rm', '/tmp/import.dump'))
        $sql = "CREATE ROLE rentalops_runtime LOGIN PASSWORD '$runtimePassword'; GRANT CONNECT ON DATABASE rentalops TO rentalops_runtime; GRANT USAGE ON SCHEMA public TO rentalops_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rentalops_runtime; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rentalops_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE rentalops_bootstrap IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rentalops_runtime; ALTER DEFAULT PRIVILEGES FOR ROLE rentalops_bootstrap IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rentalops_runtime;"
        $sql | & $Docker --context desktop-linux exec -i $db psql -U rentalops_bootstrap -d rentalops -v ON_ERROR_STOP=1 *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar a conta da aplicação.' }
        $helper = Invoke-Compose -ComposeArguments @('run', '-d', '--no-deps', '--entrypoint', 'sleep', 'prepare', '600')
        try {
            [void](Invoke-Docker -DockerArguments @('cp', (Join-Path $ImportDirectory 'storage.tar'), "${helper}:/tmp/storage.tar"))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'tar', '-xf', '/tmp/storage.tar', '-C', '/private/photos'))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'chown', '-R', '10001:10001', '/private/photos'))
            [void](Invoke-Docker -DockerArguments @('cp', "${helper}:/private/keys/identity.txt", (Join-Path $DataRoot 'backup-recovery-key.txt')))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'rm', '/private/keys/identity.txt'))
        } finally { [void](Invoke-Docker -DockerArguments @('rm', '-f', $helper)) }
        [IO.File]::WriteAllText((Join-Path $DataRoot 'installed.json'), (@{ installed_at = (Get-Date).ToUniversalTime().ToString('o'); url = 'http://localhost:8080' } | ConvertTo-Json), $Utf8)
        Install-Shortcuts
        Start-App
        Save-Backup
    } elseif ($Action -eq 'Stop') {
        Write-Host 'Encerrando o RentalOps e guardando uma cópia de segurança...'
        Start-App
        Save-Backup
        [void](Invoke-Compose -ComposeArguments @('stop', '--timeout', '30'))
        Write-Host 'RentalOps encerrado. Seus dados estão guardados.'
    } elseif ($Action -eq 'Status') {
        Write-Host (Invoke-Compose -ComposeArguments @('ps'))
    } elseif ($Action -eq 'VerifyBackup') {
        Start-App
        $point = Get-ChildItem -LiteralPath $BackupRoot -Directory -Filter 'point-*' | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
        if (-not $point) { throw 'Nenhuma cópia de segurança foi encontrada.' }
        $key = Join-Path $DataRoot 'backup-recovery-key.txt'
        $helper = Invoke-Compose -ComposeArguments @('run', '-d', '--no-deps', '--entrypoint', 'sleep', 'prepare', '600')
        try {
            [void](Invoke-Docker -DockerArguments @('cp', $key, "${helper}:/tmp/recovery-key"))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'chmod', '600', '/tmp/recovery-key'))
            [void](Invoke-Docker -DockerArguments @('exec', $helper, 'chown', '10001:10001', '/tmp/recovery-key'))
            $verified = Invoke-Docker -DockerArguments @('exec', '--user', '10001:10001', $helper, 'python', '-m', 'infra.operations.backup', 'verify', '--manifest', ('/private/backups/' + $point.Name + '/manifest.json'), '--identity-file', '/tmp/recovery-key', '--scratch-root', '/private/scratch')
        } finally { [void](Invoke-Docker -DockerArguments @('rm', '-f', $helper)) }
        if (($verified | ConvertFrom-Json).status -ne 'verified') { throw 'A cópia não passou na verificação.' }
        Write-Host 'Cópia cifrada, banco e arquivos conferidos.'
    } else {
        Start-App
        if ($Action -eq 'Backup') { Save-Backup } else {
            $last = Join-Path $DataRoot 'last-backup.json'
            if (-not (Test-Path -LiteralPath $last) -or (Get-Item -LiteralPath $last).LastWriteTimeUtc -lt [DateTime]::UtcNow.AddHours(-24)) { Save-Backup }
        }
    }
    [IO.File]::WriteAllText((Join-Path $DataRoot 'last-operation.json'), (@{status='ok'; action=$Action; at=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json), $Utf8)
    if (Test-Path -LiteralPath (Join-Path $DataRoot 'last-operation-error.txt')) { Remove-Item -LiteralPath (Join-Path $DataRoot 'last-operation-error.txt') }
    if ($Action -in @('Start', 'Install', 'ConfigureMobile') -and -not $NoBrowser) {
        $origin = Get-MobileOrigin
        if (-not $origin) { $origin = 'http://localhost:8080' }
        Start-Process $origin
    }
} catch {
    if (Test-Path -LiteralPath $DataRoot) {
        [IO.File]::WriteAllText((Join-Path $DataRoot 'last-operation-error.txt'), ((Get-Date).ToString('o') + ' ' + $_.Exception.Message), $Utf8)
    }
    Write-Host ('Não foi possível concluir: ' + $_.Exception.Message) -ForegroundColor Red
    if (-not $NoBrowser) { [void](Read-Host 'Pressione Enter para fechar') }
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
