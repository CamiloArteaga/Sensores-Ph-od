# free_com3.ps1 — libera COM3 cerrando MSI Center
# Corre desde PowerShell como administrador si es necesario

Write-Host "Buscando proceso que bloquea COM3..."

$proc = Get-Process -Name "DCv2" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "Encontrado: MSI Center (DCv2, PID $($proc.Id)) — cerrando..."
    Stop-Process -Name "DCv2" -Force
    Start-Sleep -Seconds 2
    Write-Host "Listo. Probando COM3..."
} else {
    Write-Host "DCv2 no esta corriendo. Buscando otros candidatos..."
    # Fallback: matar cualquier proceso con CH340 en modulos
    Get-Process | ForEach-Object {
        $p = $_
        try {
            $p.Modules | Where-Object { $_.ModuleName -like "*CH34*" -or $_.ModuleName -like "*serial*" } | ForEach-Object {
                Write-Host "Candidato: $($p.Name) (PID $($p.Id))"
                Stop-Process -Id $p.Id -Force
            }
        } catch {}
    }
}

# Verificar
Start-Sleep -Seconds 1
try {
    $sp = New-Object System.IO.Ports.SerialPort "COM3", 9600
    $sp.Open()
    $sp.Close()
    Write-Host "COM3 esta libre. El backend deberia detectar el Arduino en ~5 segundos."
} catch {
    Write-Host "COM3 sigue bloqueado: $_"
    Write-Host "Intenta reiniciar el PC o desconectar/reconectar el Arduino."
}
