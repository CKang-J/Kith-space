param(
  [ValidateRange(1, 20)]
  [int]$Rounds = 5,

  [ValidateRange(1, 300)]
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

function Resolve-Pa9CliSpecs {
  $specs = @()
  foreach ($name in @("claude", "codex", "opencode")) {
    $command = Get-Command $name -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (!$command) { continue }

    $source = $command.Source
    $extension = [System.IO.Path]::GetExtension($source).ToLowerInvariant()
    if ($extension -in @(".cmd", ".bat", ".ps1")) {
      $powershell = Get-Command powershell.exe -CommandType Application -ErrorAction Stop
      $escapedSource = $source.Replace("'", "''")
      $specs += [pscustomobject]@{
        Name = $name
        FilePath = $powershell.Source
        Arguments = @(
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "& '$escapedSource' --version"
        )
      }
      continue
    }

    $specs += [pscustomobject]@{ Name = $name; FilePath = $source; Arguments = @("--version") }
  }
  return $specs
}

function Format-Pa9Argument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Stop-Pa9ProcessTree([System.Diagnostics.Process]$Process) {
  $taskkill = Join-Path $env:SystemRoot "System32\taskkill.exe"
  if (Test-Path -LiteralPath $taskkill) {
    & $taskkill /PID $Process.Id /T /F *> $null
  }
  if (!$Process.HasExited) {
    try {
      $Process.Kill($true)
    } catch {
      if (!$Process.HasExited) { $Process.Kill() }
    }
  }
}

function Read-Pa9CapturedOutput([System.Threading.Tasks.Task[string]]$Task) {
  try {
    return $Task.GetAwaiter().GetResult().Trim()
  } catch {
    return ""
  }
}

$results = @()
$hasFailure = $false
foreach ($spec in Resolve-Pa9CliSpecs) {
  $samples = @()
  for ($round = 1; $round -le $Rounds; $round++) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $spec.FilePath
    $startInfo.Arguments = (($spec.Arguments | ForEach-Object { Format-Pa9Argument $_ }) -join " ")
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if (!$process.Start()) { throw "Failed to start $($spec.Name)" }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $peakWorkingSetBytes = 0
    $timedOut = $false
    while (!$process.WaitForExit(10)) {
      $process.Refresh()
      $peakWorkingSetBytes = [Math]::Max($peakWorkingSetBytes, $process.WorkingSet64)
      if ($stopwatch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
        $timedOut = $true
        Stop-Pa9ProcessTree $process
        break
      }
    }
    $process.WaitForExit()
    $stopwatch.Stop()
    $exitCode = if ($timedOut) { $null } else { $process.ExitCode }
    $failure = if ($timedOut) {
      "$($spec.Name) timed out after $TimeoutSeconds second(s)"
    } elseif ($exitCode -ne 0) {
      "$($spec.Name) exited with code $exitCode"
    } else {
      $null
    }
    if ($failure) { $hasFailure = $true }
    $samples += [pscustomobject]@{
      round = $round
      elapsedMs = $stopwatch.Elapsed.TotalMilliseconds
      peakWorkingSetBytes = $peakWorkingSetBytes
      timedOut = $timedOut
      exitCode = $exitCode
      failure = $failure
      version = Read-Pa9CapturedOutput $stdout
      stderr = Read-Pa9CapturedOutput $stderr
    }
    $process.Dispose()
  }
  $results += [pscustomobject]@{ name = $spec.Name; samples = $samples }
}

[pscustomobject]@{
  benchmark = "P-A9.0 installed CLI offline startup smoke"
  generatedAt = [DateTime]::UtcNow.ToString("o")
  rounds = $Rounds
  definition = "Runs --version only; records launcher startup and launcher peak working set, not a model-backed Runtime session or full child-process tree."
  results = $results
} | ConvertTo-Json -Depth 6

if ($hasFailure) { exit 1 }
