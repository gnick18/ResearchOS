# ResearchOS - start the frontend.
#
# The app is now fully client-side via the File System Access API.
# The legacy FastAPI backend is no longer required and is not launched here.
# Usage: .\start.ps1

Write-Host "Starting ResearchOS..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kill anything already using port 3000
$connections = netstat -ano | Select-String ":3000\s" | Select-String "LISTENING"
foreach ($conn in $connections) {
    $pid = ($conn -split '\s+')[-1]
    if ($pid -match '^\d+$') {
        Write-Host "  Killing existing process on port 3000 (PID $pid)" -ForegroundColor Yellow
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Seconds 1

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
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Cyan

# Wait for user to press Ctrl+C
try {
    while ($true) {
        Start-Sleep -Seconds 1
        if ($frontendJob.State -eq "Failed") {
            Write-Host "Frontend has failed. Check the output above." -ForegroundColor Red
            break
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Shutting down..." -ForegroundColor Yellow
    Stop-Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $frontendJob -ErrorAction SilentlyContinue
    Write-Host "   Done." -ForegroundColor Green
}
