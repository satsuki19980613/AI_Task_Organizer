$AppDir = $PSScriptRoot
$Python = 'C:\Python313\python.exe'
$Port   = 5000
$Url    = "http://localhost:$Port"

Write-Host ""
Write-Host " Task Organizer - Starting..." -ForegroundColor Cyan
Write-Host ""

# Kill existing process on port
$conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($conn) {
    $oldPid = ($conn | Select-Object -First 1).OwningProcess
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Install packages
Write-Host " [1/3] Checking packages..."
& $Python -m pip install -r "$AppDir\requirements.txt" -q 2>$null

# Start server (hidden window, no output capture to avoid deadlock)
Write-Host " [2/3] Starting server..."
$proc = Start-Process `
    -FilePath $Python `
    -ArgumentList "app.py" `
    -WorkingDirectory $AppDir `
    -WindowStyle Hidden `
    -PassThru

Write-Host "       Server PID: $($proc.Id)"

# Wait for TCP port to open (up to 15 sec)
Write-Host " [3/3] Waiting for server..." -NoNewline
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "." -NoNewline
    $test = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue -ErrorAction SilentlyContinue
    if ($test.TcpTestSucceeded) {
        $ready = $true
        break
    }
}
Write-Host ""

if (-not $ready) {
    Write-Host " [ERROR] Server did not start." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

# Open browser
Write-Host " Opening browser..."
Start-Process $Url

Write-Host ""
Write-Host " Done! PID=$($proc.Id)" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 2
