$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeRoot = Join-Path $root ".tools\node-v22.13.1-win-x64"
$node = Join-Path $nodeRoot "node.exe"

if (-not (Test-Path $node)) {
    throw "Bundled Node.js was not found at $node"
}

$backendDir = Join-Path $root "eco-eats-backend"
$frontendDir = Join-Path $root "eco-eats-frontend"
$backendLog = Join-Path $backendDir "local-backend.log"
$backendErr = Join-Path $backendDir "local-backend.err.log"
$frontendLog = Join-Path $frontendDir "local-frontend.log"
$frontendErr = Join-Path $frontendDir "local-frontend.err.log"

function Test-BackendHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:5000/api/health" -TimeoutSec 2
        return $health.status -eq "ok"
    } catch {
        return $false
    }
}

function Get-FrontendUrl {
    foreach ($port in 5173..5180) {
        $url = "http://127.0.0.1:$port"
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
            if ($response.StatusCode -eq 200 -and $response.Content -match "/src/main.jsx|vite/client") {
                return $url
            }
        } catch {
        }
    }

    return $null
}

if (Test-BackendHealth) {
    $backendPid = "already running"
} else {
    $backend = Start-Process -FilePath $node `
        -ArgumentList "scripts/startFullLocal.js" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $backendLog `
        -RedirectStandardError $backendErr `
        -PassThru `
        -WindowStyle Hidden

    Start-Sleep -Seconds 4

    if (-not (Test-BackendHealth)) {
        Write-Host "Backend failed to start. Error log:"
        Get-Content $backendErr -ErrorAction SilentlyContinue
        throw "Backend health check failed at http://localhost:5000/api/health"
    }

    $backendPid = $backend.Id
}

Start-Sleep -Seconds 1

$frontendUrl = Get-FrontendUrl

if ($frontendUrl) {
    $frontendPid = "already running"
} else {
    $frontend = Start-Process -FilePath $node `
        -ArgumentList "node_modules/vite/bin/vite.js", "--host", "127.0.0.1" `
        -WorkingDirectory $frontendDir `
        -RedirectStandardOutput $frontendLog `
        -RedirectStandardError $frontendErr `
        -PassThru `
        -WindowStyle Hidden

    Start-Sleep -Seconds 2
    $frontendUrl = Get-FrontendUrl
    $frontendPid = $frontend.Id
}

Write-Host "Eco Eats backend ready on http://localhost:5000 (PID $backendPid)"
Write-Host "Eco Eats frontend ready on $frontendUrl (PID $frontendPid)"
Write-Host "Backend log: $backendLog"
Write-Host "Frontend log: $frontendLog"
