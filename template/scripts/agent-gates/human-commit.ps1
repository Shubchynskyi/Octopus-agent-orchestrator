[CmdletBinding()]
param(
    [Alias('m')]
    [string]$Message,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommitArgs
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Message) -and ($null -eq $CommitArgs -or $CommitArgs.Count -eq 0)) {
    throw 'Provide git commit arguments, for example: -m "feat: message"'
}

$finalArgs = @()
if (-not [string]::IsNullOrWhiteSpace($Message)) {
    $finalArgs += @('-m', $Message)
}
if ($null -ne $CommitArgs) {
    $finalArgs += $CommitArgs
}

$env:OCTOPUS_ALLOW_COMMIT = '1'
try {
    & git commit @finalArgs
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:OCTOPUS_ALLOW_COMMIT -ErrorAction SilentlyContinue
}
