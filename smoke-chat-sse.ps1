param(
  [string]$BaseUrl = "http://localhost:18081",
  [string]$Token = "",
  [string]$Message = "你好，做个SSE冒烟测试",
  [string]$CookieName = "auth-token"
)

$ErrorActionPreference = "Stop"
try { Add-Type -AssemblyName System.Security } catch {}
try { Add-Type -AssemblyName System.Security.Cryptography.ProtectedData } catch {}

function Convert-HexToBytes {
  param([string]$Hex)
  if (-not $Hex) { return [byte[]]@() }
  $clean = $Hex.Trim()
  if (($clean.Length % 2) -ne 0) { throw "Invalid hex length" }
  $bytes = New-Object byte[] ($clean.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($clean.Substring($i * 2, 2), 16)
  }
  return $bytes
}

function Get-ChromiumMasterKey {
  param([string]$LocalStatePath)
  if (-not (Test-Path $LocalStatePath)) { return $null }
  $raw = Get-Content -Raw -Path $LocalStatePath
  $encKeyB64 = $null
  try {
    $json = $raw | ConvertFrom-Json
    $encKeyB64 = $json.os_crypt.encrypted_key
  } catch {
    $m = [regex]::Match($raw, '"encrypted_key"\s*:\s*"([^"]+)"')
    if ($m.Success) { $encKeyB64 = $m.Groups[1].Value }
  }
  if (-not $encKeyB64) { return $null }
  $encKey = [Convert]::FromBase64String($encKeyB64)
  if ($encKey.Length -le 5) { return $null }
  $dpapiBytes = $encKey[5..($encKey.Length - 1)]
  $pdType = [Type]::GetType("System.Security.Cryptography.ProtectedData")
  if (-not $pdType) { return $null }
  return [System.Security.Cryptography.ProtectedData]::Unprotect($dpapiBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
}

function Decrypt-ChromiumCookieValue {
  param(
    [string]$HexEncryptedValue,
    [string]$PlainValue,
    [byte[]]$MasterKey
  )
  if ($PlainValue -and $PlainValue.Length -gt 0) { return $PlainValue }
  $enc = Convert-HexToBytes $HexEncryptedValue
  if ($enc.Length -eq 0) { return "" }

  if ($enc.Length -ge 3 -and $enc[0] -eq 0x76 -and $enc[1] -eq 0x31 -and ($enc[2] -eq 0x30 -or $enc[2] -eq 0x31)) {
    if (-not $MasterKey) { return "" }
    # Chromium v10/v11: [3-byte prefix][12-byte nonce][ciphertext][16-byte tag]
    $nonce = $enc[3..14]
    $cipherAndTag = $enc[15..($enc.Length - 1)]
    if ($cipherAndTag.Length -le 16) { return "" }
    $cipher = $cipherAndTag[0..($cipherAndTag.Length - 17)]
    $tag = $cipherAndTag[($cipherAndTag.Length - 16)..($cipherAndTag.Length - 1)]
    $plain = New-Object byte[] $cipher.Length
    $aes = [System.Security.Cryptography.AesGcm]::new($MasterKey)
    try {
      $aes.Decrypt($nonce, $cipher, $tag, $plain, $null)
      return [System.Text.Encoding]::UTF8.GetString($plain)
    } finally {
      $aes.Dispose()
    }
  }

  # Older DPAPI format
  try {
    $pdType = [Type]::GetType("System.Security.Cryptography.ProtectedData")
    if (-not $pdType) { return "" }
    $raw = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [System.Text.Encoding]::UTF8.GetString($raw)
  } catch {
    return ""
  }
}

function Get-TokenFromBrowserCookies {
  param(
    [string]$TargetCookieName,
    [string]$TargetHost
  )

  $sqlite = "sqlite3.exe"
  $browserRoots = @(
    "$env:LOCALAPPDATA\Microsoft\Edge\User Data",
    "$env:LOCALAPPDATA\Google\Chrome\User Data"
  )

  foreach ($root in $browserRoots) {
    if (-not (Test-Path $root)) { continue }
    $master = Get-ChromiumMasterKey -LocalStatePath (Join-Path $root "Local State")
    $profiles = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" }

    foreach ($p in $profiles) {
      $cookieDb = Join-Path $p.FullName "Network\Cookies"
      if (-not (Test-Path $cookieDb)) { continue }
      $tmp = Join-Path $env:TEMP ("cookies_copy_" + [guid]::NewGuid().ToString("N") + ".db")
      $queryDb = $tmp
      try {
        Copy-Item $cookieDb $tmp -Force
      } catch {
        # Browser may lock cookies DB; fallback to querying source DB directly.
        $queryDb = $cookieDb
      }
      try {
        $query = "SELECT host_key,name,value,hex(encrypted_value) FROM cookies WHERE name = '$TargetCookieName' ORDER BY last_access_utc DESC LIMIT 200;"
        $rows = @()
        try {
          $rows = & $sqlite $queryDb $query 2>$null
        } catch {
          $rows = @()
        }
        foreach ($line in $rows) {
          $parts = $line -split "\|", 4
          if ($parts.Count -lt 4) { continue }
          $host = $parts[0]
          $name = $parts[1]
          $plain = $parts[2]
          $hex = $parts[3]
          if ($name -ne $TargetCookieName) { continue }
          if ($TargetHost -and $TargetHost.Length -gt 0) {
            if ($host -notlike "*$TargetHost*" -and $TargetHost -notlike "*$host*") { continue }
          }
          $token = Decrypt-ChromiumCookieValue -HexEncryptedValue $hex -PlainValue $plain -MasterKey $master
          if ($token -and $token.Trim().Length -gt 0) { return $token.Trim() }
        }
      } finally {
        if (Test-Path $tmp) {
          Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
      }
    }
  }
  return ""
}

$uri = "$BaseUrl/api/chat"
$headers = @{
  "Content-Type" = "application/json"
}
if (-not $Token -or $Token.Trim().Length -eq 0) {
  try {
    $targetHost = ([System.Uri]$BaseUrl).Host
  } catch {
    $targetHost = "localhost"
  }
  $Token = Get-TokenFromBrowserCookies -TargetCookieName $CookieName -TargetHost $targetHost
  if ($Token) {
    Write-Host "Auto-loaded token from browser cookies."
  } else {
    Write-Host "No browser cookie token found; will request without Authorization."
  }
}
if ($Token -and $Token.Trim().Length -gt 0) {
  $headers["Authorization"] = "Bearer $Token"
}

$payload = @{
  messages = @(
    @{
      role = "user"
      content = $Message
    }
  )
} | ConvertTo-Json -Depth 8 -Compress

Write-Host "POST $uri"
Write-Host "Payload: $payload"

$req = [System.Net.HttpWebRequest]::Create($uri)
$req.Method = "POST"
$req.ContentType = "application/json"
if ($headers.ContainsKey("Authorization")) {
  $req.Headers["Authorization"] = $headers["Authorization"]
}

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$req.ContentLength = $bytes.Length
$reqStream = $req.GetRequestStream()
$reqStream.Write($bytes, 0, $bytes.Length)
$reqStream.Close()

try {
  $resp = $req.GetResponse()
} catch [System.Net.WebException] {
  $errResp = $_.Exception.Response
  if ($errResp -ne $null) {
    Write-Host "HTTP error: $([int]$errResp.StatusCode)"
    $reader = New-Object System.IO.StreamReader($errResp.GetResponseStream())
    $body = $reader.ReadToEnd()
    $reader.Close()
    Write-Host $body
    exit 1
  }
  throw
}

$stream = $resp.GetResponseStream()
$reader = New-Object System.IO.StreamReader($stream)

$deltaCount = 0
$sawEnd = $false
$bufEvent = ""
$bufData = @()

while (-not $reader.EndOfStream) {
  $line = $reader.ReadLine()
  if ($line -eq "") {
    if ($bufEvent -or $bufData.Count -gt 0) {
      $dataText = ($bufData -join "`n")
      Write-Host ("event={0} data={1}" -f $bufEvent, $dataText)
      if ($bufEvent -eq "delta") { $deltaCount++ }
      if ($bufEvent -eq "end") { $sawEnd = $true; break }
      if ($bufEvent -eq "error") { break }
    }
    $bufEvent = ""
    $bufData = @()
    continue
  }
  if ($line.StartsWith("event:")) {
    $bufEvent = $line.Substring(6).Trim()
  } elseif ($line.StartsWith("data:")) {
    $bufData += $line.Substring(5).TrimStart()
  }
}

$reader.Close()
$stream.Close()
$resp.Close()

Write-Host ("delta_count={0}, saw_end={1}" -f $deltaCount, $sawEnd)
if (-not $sawEnd) { exit 2 }

