# VK Auction Bot - Test Runner Script
# This script runs tests and retrieves logs from Google Apps Script

param(
    [string]$Action = "run_tests",
    [string]$WebAppUrl = "https://script.google.com/macros/s/AKfycbx1E8xzjP1vwNFq_XzLr_xymJvom2fh_7_qT6wgfn1XqQtOmCFjHaVYGs9hIXtMEb0/exec",
    [string]$Secret = "5f574d3f-2f39-4f",
    [string]$ArtifactsDir = "./artifacts"
)

$ErrorActionPreference = "Stop"

# Create artifacts directory
if (-not (Test-Path $ArtifactsDir)) {
    New-Item -ItemType Directory -Path $ArtifactsDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VK Auction Bot - Test Runner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Action: $Action"
Write-Host "Time: $timestamp"
Write-Host ""

function Invoke-GasRequest {
    param([string]$Action, [string]$Url, [string]$Secret)
    
    $fullUrl = "${Url}?action=${Action}&secret=${Secret}"
    Write-Host "Calling: $Action ..." -ForegroundColor Yellow
    
    try {
        $response = curl.exe -s -L $fullUrl 2>&1
        return $response
    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
        return $null
    }
}

# Step 1: Push code
Write-Host "Step 1: Pushing code to GAS..." -ForegroundColor Green
npx @google/clasp push -f
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: Could not push code" -ForegroundColor Red
    exit 1
}
Write-Host "Code pushed successfully" -ForegroundColor Green
Write-Host ""

# Step 2: Run tests
Write-Host "Step 2: Running tests..." -ForegroundColor Green
$testResult = Invoke-GasRequest -Action "run_tests" -Url $WebAppUrl -Secret $Secret

# Save test result
$testResultFile = "$ArtifactsDir/test_result_$timestamp.txt"
$testResult | Out-File -FilePath $testResultFile -Encoding UTF8
Write-Host "Test result saved to: $testResultFile" -ForegroundColor Gray

# Display result
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TEST RESULT:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host $testResult

# Check for success
if ($testResult -match "TESTS PASSED|ALL TESTS PASSED|Failed: 0") {
    Write-Host ""
    Write-Host "SUCCESS: All tests passed!" -ForegroundColor Green
}
elseif ($testResult -match "ERROR|FAILED|Error") {
    Write-Host ""
    Write-Host "FAILURE: Tests failed or errors occurred" -ForegroundColor Red
    
    # Get logs for debugging
    Write-Host ""
    Write-Host "Step 3: Fetching logs..." -ForegroundColor Yellow
    $logs = Invoke-GasRequest -Action "get_logs" -Url $WebAppUrl -Secret $Secret
    
    $logsFile = "$ArtifactsDir/logs_$timestamp.json"
    $logs | Out-File -FilePath $logsFile -Encoding UTF8
    Write-Host "Logs saved to: $logsFile" -ForegroundColor Gray
    
    Write-Host ""
    Write-Host "RECENT LOGS:" -ForegroundColor Yellow
    Write-Host $logs
}
else {
    Write-Host ""
    Write-Host "UNKNOWN: Could not determine test status" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
