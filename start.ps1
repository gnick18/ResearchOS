# ResearchOS - start backend + frontend in one command
# Usage: .\start.ps1

Write-Host "Starting ResearchOS..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kill anything already using our ports
foreach ($port in @(8000, 3000)) {
    $connections = netstat -ano | Select-String ":$port\s" | Select-String "LISTENING"
    foreach ($conn in $connections) {
        $pid = ($conn -split '\s+')[-1]
        if ($pid -match '^\d+$') {
            Write-Host "  Killing existing process on port $port (PID $pid)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
}

# Wait for ports to be released
Start-Sleep -Seconds 2

# Start Backend
Write-Host "  Starting backend (FastAPI) on http://localhost:8000 ..." -ForegroundColor Green
$backendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\backend"
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
} -ArgumentList $scriptDir

# Start Frontend
Write-Host "  Starting frontend (Next.js) on http://localhost:3000 ..." -ForegroundColor Green
$frontendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location "$dir\frontend"
    npm run dev
} -ArgumentList $scriptDir

Write-Host ""
Write-Host "ResearchOS is running!" -ForegroundColor Green
Write-Host "   Frontend: http://localhost:3000"
Write-Host "   Backend:  http://localhost:8000"
Write-Host "   API docs: http://localhost:8000/docs"
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Cyan

# Wait for user to press Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 1
        # Check if jobs are still running
        if ($backendJob.State -eq "Failed" -or $frontendJob.State -eq "Failed") {
            Write-Host "A process has failed. Check the output above." -ForegroundColor Red
            break
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Shutting down..." -ForegroundColor Yellow
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Stop-Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $frontendJob -ErrorAction SilentlyContinue
    Write-Host "   Done." -ForegroundColor Green
}