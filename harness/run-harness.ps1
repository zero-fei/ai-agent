param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Token = "",
  [string]$Username = "",
  [string]$Password = "",
  [string]$CasesDir = "./harness/cases",
  [switch]$EnableFaultInjection,
  [switch]$EnableLlmCases
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-HeaderValueSafe {
  param(
    [Parameter(Mandatory = $false)]$Headers,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if ($null -eq $Headers) { return "" }
  try {
    if ($Headers -is [System.Collections.IDictionary]) {
      return [string]$Headers[$Name]
    }
    $values = New-Object 'System.Collections.Generic.IEnumerable[string]' ([string[]]@())
    if ($Headers.TryGetValues($Name, [ref]$values)) {
      return [string]($values | Select-Object -First 1)
    }
  } catch {
    return ""
  }
  return ""
}

function Resolve-AuthToken {
  param(
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $false)][string]$Token,
    [Parameter(Mandatory = $false)][string]$Username,
    [Parameter(Mandatory = $false)][string]$Password
  )
  if ($Token -and $Token.Trim().Length -gt 0) {
    return $Token.Trim()
  }
  if (-not $Username -or -not $Password) {
    return ""
  }
  try {
    $loginBody = @{
      username = $Username
      password = $Password
    } | ConvertTo-Json -Compress
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $resp = Invoke-WebRequest `
      -Uri "$BaseUrl/api/auth/login" `
      -Method POST `
      -ContentType "application/json" `
      -Body $loginBody `
      -TimeoutSec 30 `
      -WebSession $session
    $setCookie = Get-HeaderValueSafe -Headers $resp.Headers -Name "Set-Cookie"
    if ($setCookie -match "auth-token=([^;]+)") {
      return $matches[1]
    }
    return ""
  } catch {
    return ""
  }
}

if (-not (Test-Path $CasesDir)) {
  throw "Cases directory not found: $CasesDir"
}

$ResolvedToken = Resolve-AuthToken -BaseUrl $BaseUrl -Token $Token -Username $Username -Password $Password

$caseFiles = Get-ChildItem -Path $CasesDir -Filter *.json | Sort-Object Name
if ($caseFiles.Count -eq 0) {
  throw "No case files found in $CasesDir"
}

$results = @()

foreach ($f in $caseFiles) {
  $raw = Get-Content -Raw -Path $f.FullName
  $c = $raw | ConvertFrom-Json
  $hasRequiresToken = $null -ne $c.psobject.Properties["requiresToken"]
  if ($hasRequiresToken -and $c.requiresToken -eq $true -and (-not $ResolvedToken -or $ResolvedToken.Trim().Length -eq 0)) {
    $results += [pscustomobject]@{
      case = $c.name
      pass = $true
      status = "SKIP"
      expectStatus = "-"
      elapsedMs = 0
      traceId = ""
      httpOk = $false
      error = "Skipped: requires token"
    }
    continue
  }
  $hasRequiresFault = $null -ne $c.psobject.Properties["requiresFaultInjection"]
  if ($hasRequiresFault -and $c.requiresFaultInjection -eq $true -and -not $EnableFaultInjection) {
    $results += [pscustomobject]@{
      case = $c.name
      pass = $true
      status = "SKIP"
      expectStatus = "-"
      elapsedMs = 0
      traceId = ""
      httpOk = $false
      error = "Skipped: requires fault injection"
    }
    continue
  }
  $hasRequiresLlm = $null -ne $c.psobject.Properties["requiresLlm"]
  if ($hasRequiresLlm -and $c.requiresLlm -eq $true -and -not $EnableLlmCases) {
    $results += [pscustomobject]@{
      case = $c.name
      pass = $true
      status = "SKIP"
      expectStatus = "-"
      elapsedMs = 0
      traceId = ""
      httpOk = $false
      error = "Skipped: requires llm cases enabled"
    }
    continue
  }

  $url = "$BaseUrl$($c.path)"
  $method = if ($null -ne $c.psobject.Properties["method"] -and $c.method) { [string]$c.method } else { "GET" }
  $hasBody = $null -ne $c.psobject.Properties["body"] -and $null -ne $c.body
  $bodyJson = if ($hasBody) { $c.body | ConvertTo-Json -Depth 20 -Compress } else { "" }

  $headers = @{
    "Content-Type" = "application/json"
  }
  $includeAuth = $true
  $hasIncludeAuth = $null -ne $c.psobject.Properties["includeAuth"]
  if ($hasIncludeAuth) { $includeAuth = [bool]$c.includeAuth }
  if ($includeAuth -and $ResolvedToken -and $ResolvedToken.Trim().Length -gt 0) {
    $headers["Cookie"] = "auth-token=$ResolvedToken"
  } elseif (-not $includeAuth) {
    # 显式覆盖，避免系统会话自动带上历史 Cookie。
    $headers["Cookie"] = "auth-token="
  }
  if ($null -ne $c.psobject.Properties["headers"] -and $c.headers) {
    $c.headers.psobject.Properties | ForEach-Object {
      $headers[$_.Name] = [string]$_.Value
    }
  }

  $start = Get-Date
  $status = -1
  $ok = $false
  $traceId = ""
  $eventText = ""
  $errMsg = ""

  try {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $resp = Invoke-WebRequest -Uri $url -Method $method -Headers $headers -Body $bodyJson -TimeoutSec 120 -MaximumRedirection 0 -WebSession $session
    $status = [int]$resp.StatusCode
    $traceId = Get-HeaderValueSafe -Headers $resp.Headers -Name "X-Trace-Id"
    $eventText = [string]$resp.Content
    $ok = $true
  } catch {
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode.value__
      $traceId = Get-HeaderValueSafe -Headers $_.Exception.Response.Headers -Name "X-Trace-Id"
    }
    $errMsg = $_.Exception.Message
  }

  $elapsedMs = [int]((Get-Date) - $start).TotalMilliseconds

  $expectStatus = if ($null -ne $c.psobject.Properties["expectStatus"] -and $c.expectStatus) { [int]$c.expectStatus } else { 200 }
  $statusPass = ($status -eq $expectStatus)
  if (-not $statusPass -and $expectStatus -eq 401 -and $status -eq 307) {
    # 在 Next middleware 场景，未登录可能先被 307 重定向，而不是直接 401。
    $statusPass = $true
  }
  if ($null -ne $c.psobject.Properties["expectStatusIn"] -and $c.expectStatusIn) {
    $statusPass = $false
    foreach ($st in $c.expectStatusIn) {
      if ($status -eq [int]$st) {
        $statusPass = $true
      }
    }
  }

  $eventPass = $true
  if ($null -ne $c.psobject.Properties["expectSseEvents"] -and $c.expectSseEvents) {
    foreach ($evt in $c.expectSseEvents) {
      if (-not ($eventText -match "event:\s*$evt")) {
        $eventPass = $false
      }
    }
  }

  $bodyPass = $true
  $isRedirect = $status -ge 300 -and $status -lt 400
  if (-not $isRedirect -and $null -ne $c.psobject.Properties["expectBodyContains"] -and $c.expectBodyContains) {
    foreach ($fragment in $c.expectBodyContains) {
      if (-not ($eventText -like "*$fragment*")) {
        $bodyPass = $false
      }
    }
  }

  $tracePass = $true
  if ($null -ne $c.psobject.Properties["expectTraceId"] -and $c.expectTraceId -eq $true) {
    $tracePass = $isRedirect -or (-not [string]::IsNullOrWhiteSpace($traceId))
  }

  $pass = $statusPass -and $eventPass -and $bodyPass -and $tracePass
  $results += [pscustomobject]@{
    case = $c.name
    pass = $pass
    status = $status
    expectStatus = $expectStatus
    elapsedMs = $elapsedMs
    traceId = $traceId
    httpOk = $ok
    error = $errMsg
  }
}

$results | Format-Table -AutoSize

$failed = @($results | Where-Object { -not $_.pass })
if ($failed.Count -gt 0) {
  Write-Error "Harness failed: $($failed.Count)/$($results.Count) cases failed."
  exit 1
}

Write-Host "Harness passed: $($results.Count) cases." -ForegroundColor Green

