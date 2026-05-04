# subagent.ps1
# Muscle subagent — calls DeepSeek V4 Flash via the local free-claude-code proxy.
#
# PREREQUISITE: start the proxy server first in a separate terminal:
#   cd C:\Users\Administrator\Documents\free-claude\free-claude-code
#   uv run uvicorn server:app --host 0.0.0.0 --port 8082
#
# Usage:
#   .\subagent.ps1 -Task "Write unit tests for X. Code: ..."

param(
    [Parameter(Mandatory = $true)]
    [string]$Task
)

$ProxyUrl  = "http://localhost:8082"
$AuthToken = "freecc"

Write-Host ""
Write-Host "--- Subagent (DeepSeek V4 Flash @ $ProxyUrl) ---" -ForegroundColor Cyan
Write-Host "Task: $($Task.Substring(0, [Math]::Min(120, $Task.Length)))$(if ($Task.Length -gt 120) { ' [...]' })" -ForegroundColor DarkGray
Write-Host ""

$body = @{
    model      = "claude-haiku-4-5-20251001"
    max_tokens = 8096
    messages   = @(@{ role = "user"; content = $Task })
} | ConvertTo-Json -Depth 5 -Compress

try {
    $response = Invoke-WebRequest `
        -Uri "$ProxyUrl/v1/messages" `
        -Method POST `
        -Headers @{
            "x-api-key"         = $AuthToken
            "anthropic-version" = "2023-06-01"
            "content-type"      = "application/json"
        } `
        -Body $body `
        -UseBasicParsing `
        -TimeoutSec 120 `
        -ErrorAction Stop
} catch {
    Write-Host "--- Subagent API error: $($_.Exception.Message) ---" -ForegroundColor Red
    Write-Host "Is the proxy running?  uv run uvicorn server:app --host 0.0.0.0 --port 8082" -ForegroundColor Yellow
    exit 1
}

# Parse SSE stream: extract text_delta events only (skips thinking blocks)
$result = ""
foreach ($line in ($response.Content -split "`n")) {
    $line = $line.Trim()
    if (-not $line.StartsWith("data:")) { continue }
    $json = $line.Substring(5).Trim()
    if ($json -eq "[DONE]" -or $json -eq "") { continue }
    try {
        $event = $json | ConvertFrom-Json -ErrorAction Stop
        if ($event.type -eq "content_block_delta" -and $event.delta.type -eq "text_delta") {
            $result += $event.delta.text
        }
    } catch {}
}

$result = $result.Trim()

if ($result -eq "") {
    Write-Host "--- Subagent returned empty response ---" -ForegroundColor Yellow
    exit 1
}

Write-Output $result
Write-Host ""
Write-Host "--- Subagent complete ---" -ForegroundColor Green
