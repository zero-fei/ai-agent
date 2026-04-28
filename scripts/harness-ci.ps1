param(
  [string]$BaseUrl = $(if ($env:HARNESS_BASE_URL) { $env:HARNESS_BASE_URL } else { "http://localhost:3000" }),
  [string]$Username = $(if ($env:HARNESS_USERNAME) { $env:HARNESS_USERNAME } else { "" }),
  [string]$Password = $(if ($env:HARNESS_PASSWORD) { $env:HARNESS_PASSWORD } else { "" }),
  [switch]$EnableFaultInjection = $(if ($env:HARNESS_ENABLE_FAULT -eq "1" -or $env:HARNESS_ENABLE_FAULT -eq "true") { $true } else { $false }),
  [switch]$EnableLlmCases = $(if ($env:HARNESS_ENABLE_LLM -eq "1" -or $env:HARNESS_ENABLE_LLM -eq "true") { $true } else { $false })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-HarnessStage {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string[]]$Args
  )
  Write-Host "[harness-ci] Stage: $Name" -ForegroundColor Cyan
  & pwsh ./harness/run-harness.ps1 @Args
}

$commonArgs = @("-BaseUrl", $BaseUrl)
if ($Username -and $Password) {
  $commonArgs += @("-Username", $Username, "-Password", $Password)
}

Invoke-HarnessStage -Name "base" -Args $commonArgs

if ($EnableFaultInjection) {
  $faultArgs = @($commonArgs + @("-EnableFaultInjection"))
  Invoke-HarnessStage -Name "fault" -Args $faultArgs
} else {
  Write-Host "[harness-ci] Skip fault stage (HARNESS_ENABLE_FAULT not enabled)." -ForegroundColor Yellow
}

if ($EnableLlmCases) {
  $llmArgs = @($commonArgs + @("-EnableLlmCases"))
  Invoke-HarnessStage -Name "llm" -Args $llmArgs
} else {
  Write-Host "[harness-ci] Skip llm stage (HARNESS_ENABLE_LLM not enabled)." -ForegroundColor Yellow
}

Write-Host "[harness-ci] All requested stages completed." -ForegroundColor Green

