[CmdletBinding()]
param(
    [string]$ManifestPath = 'Octopus-agent-orchestrator/MANIFEST.md'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ManifestPath)) {
    throw "Manifest not found: $ManifestPath"
}

$lines = Get-Content -Path $ManifestPath
$items = @()

foreach ($line in $lines) {
    if ($line -match '^\s*-\s+(.+?)\s*$') {
        $value = $matches[1].Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $items += $value
        }
    }
}

if ($items.Count -eq 0) {
    throw "No manifest list items found in: $ManifestPath"
}

$seen = @{}
$duplicates = @()

foreach ($item in $items) {
    $key = $item.ToLowerInvariant().Replace('\', '/')
    if ($seen.ContainsKey($key)) {
        $duplicates += $item
        continue
    }
    $seen[$key] = $item
}

if ($duplicates.Count -gt 0) {
    Write-Output 'MANIFEST_VALIDATION_FAILED'
    Write-Output "ManifestPath: $ManifestPath"
    Write-Output 'Duplicate entries:'
    $duplicates | ForEach-Object { Write-Output "- $_" }
    exit 1
}

Write-Output 'MANIFEST_VALIDATION_PASSED'
Write-Output "ManifestPath: $ManifestPath"
Write-Output "EntriesChecked: $($items.Count)"


