param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [bool]$PreserveExisting = $true,
    [bool]$AlignExisting = $true,
    [bool]$RunInit = $true,
    [string]$AssistantLanguage = 'English',
    [string]$AssistantBrevity = 'concise',
    [ValidateSet('Claude', 'Codex', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [string]$SourceOfTruth = 'Claude'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$sourceRoot = Join-Path $bundleRoot 'template'

if (-not (Test-Path $sourceRoot)) {
    throw "Template directory not found: $sourceRoot"
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path
$sourceOfTruthKey = $SourceOfTruth.Trim().ToUpperInvariant().Replace(' ', '')
$sourceToEntrypoint = @{
    'CLAUDE' = 'CLAUDE.md'
    'CODEX' = 'AGENTS.md'
    'GITHUBCOPILOT' = '.github/copilot-instructions.md'
    'WINDSURF' = '.windsurf/rules/rules.md'
    'JUNIE' = '.junie/guidelines.md'
    'ANTIGRAVITY' = '.antigravity/rules.md'
}
if (-not $sourceToEntrypoint.ContainsKey($sourceOfTruthKey)) {
    throw "Unsupported SourceOfTruth value '$SourceOfTruth'."
}
$canonicalEntryFile = $sourceToEntrypoint[$sourceOfTruthKey]
$entrypointFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    '.github/copilot-instructions.md',
    '.windsurf/rules/rules.md',
    '.junie/guidelines.md',
    '.antigravity/rules.md'
)
$redirectEntryFiles = @($entrypointFiles | Where-Object { $_ -ne $canonicalEntryFile })

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $bundleRoot "runtime/backups/$timestamp"

$exactFiles = @(
    'CLAUDE.md',
    'AGENTS.md',
    'TASK.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md'
)

$forceOverwriteFiles = @(
    $canonicalEntryFile
)

$managedEntryFiles = @(
    'AGENTS.md',
    'TASK.md',
    '.antigravity/rules.md',
    '.github/copilot-instructions.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md'
)

$directoryPrefixes = @()

$managedStart = '<!-- Octopus-agent-orchestrator:managed-start -->'
$managedEnd = '<!-- Octopus-agent-orchestrator:managed-end -->'

function Get-ManagedBlockFromTemplate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath
    )

    if (-not (Test-Path $SourcePath)) {
        return $null
    }

    $content = Get-Content -Path $SourcePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)
    $match = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        return $null
    }

    return $match.Value
}

function Build-CanonicalManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile
    )

    $baseBlock = Get-ManagedBlockFromTemplate -SourcePath (Join-Path $sourceRoot 'CLAUDE.md')
    if ([string]::IsNullOrWhiteSpace($baseBlock)) {
        throw 'Template CLAUDE.md managed block is missing; cannot build canonical entrypoint.'
    }

    $updated = [regex]::Replace($baseBlock, '(?m)^# CLAUDE\.md$', "# $CanonicalFile")
    return $updated
}

function Build-RedirectManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetFile,
        [Parameter(Mandatory = $true)]
        [string]$CanonicalFile
    )

    $title = "# $TargetFile"
    $template = @'
{MANAGED_START}
{TITLE}

This file is a redirect.
Canonical source of truth for agent workflow rules: `{CANONICAL_FILE}`.

Read `{CANONICAL_FILE}` first, then follow its routing links.
{MANAGED_END}
'@

    return $template.Replace('{MANAGED_START}', $managedStart).
        Replace('{TITLE}', $title).
        Replace('{CANONICAL_FILE}', $CanonicalFile).
        Replace('{MANAGED_END}', $managedEnd)
}

$backedUpSet = @{}
$deployed = 0
$backedUp = 0
$skippedExisting = 0
$aligned = 0
$forcedOverwrites = 0
$initInvoked = $false

function Backup-DestinationFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if (-not (Test-Path $DestinationPath)) {
        return
    }

    $key = $RelativePath.ToLowerInvariant().Replace('\', '/')
    if ($backedUpSet.ContainsKey($key)) {
        return
    }

    $backupPath = Join-Path $backupRoot $RelativePath
    $backupDir = Split-Path -Parent $backupPath

    if (-not $DryRun) {
        if ($backupDir -and -not (Test-Path $backupDir)) {
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        }
        Copy-Item -Path $DestinationPath -Destination $backupPath -Force
    }

    $script:backedUp++
    $backedUpSet[$key] = $true
}

function Sync-ManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    if (-not (Test-Path $DestinationPath)) {
        return $false
    }

    $content = Get-Content -Path $DestinationPath -Raw
    if ($null -eq $content) {
        $content = ''
    }

    $pattern = '(?s)' + [regex]::Escape($managedStart) + '.*?' + [regex]::Escape($managedEnd)

    $newContent = $content
    if ([regex]::IsMatch($content, $pattern)) {
        $replacementEvaluator = [System.Text.RegularExpressions.MatchEvaluator]{
            param($match)
            return $ManagedBlock
        }
        $newContent = [regex]::Replace($content, $pattern, $replacementEvaluator)
    } else {
        if ([string]::IsNullOrWhiteSpace($content)) {
            $newContent = $ManagedBlock + "`r`n"
        } else {
            $newContent = $content.TrimEnd() + "`r`n`r`n" + $ManagedBlock + "`r`n"
        }
    }

    if ($newContent -eq $content) {
        return $false
    }

    Backup-DestinationFile -DestinationPath $DestinationPath -RelativePath $RelativePath

    if (-not $DryRun) {
        Set-Content -Path $DestinationPath -Value $newContent
    }

    return $true
}

function Apply-EntrypointManagedBlock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$ManagedBlock
    )

    $destinationPath = Join-Path $TargetRoot $RelativePath
    $destinationDir = Split-Path -Parent $destinationPath

    if (-not (Test-Path $destinationPath)) {
        if (-not $DryRun) {
            if ($destinationDir -and -not (Test-Path $destinationDir)) {
                New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
            }
            Set-Content -Path $destinationPath -Value ($ManagedBlock + "`r`n")
        }
        $script:deployed++
        return
    }

    $wasAligned = Sync-ManagedBlock -DestinationPath $destinationPath -RelativePath $RelativePath -ManagedBlock $ManagedBlock
    if ($wasAligned) {
        $script:aligned++
    }
}

$files = @()
foreach ($relativePath in $exactFiles) {
    $full = Join-Path $sourceRoot $relativePath
    if (Test-Path $full) {
        $files += Get-Item -Path $full
    }
}

foreach ($relativeDirectory in $directoryPrefixes) {
    $full = Join-Path $sourceRoot $relativeDirectory
    if (Test-Path $full) {
        $files += Get-ChildItem -Path $full -Recurse -File
    }
}

$files = $files | Sort-Object FullName -Unique

foreach ($file in $files) {
    $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\','/')
    $relativeNormalized = $relative.Replace('\', '/')
    $destination = Join-Path $TargetRoot $relative
    $destinationDir = Split-Path -Parent $destination

    if (-not (Test-Path $destinationDir)) {
        if (-not $DryRun) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }
    }

    $isForceOverwrite = $forceOverwriteFiles -contains $relativeNormalized

    if (Test-Path $destination) {
        if ($isForceOverwrite) {
            Backup-DestinationFile -DestinationPath $destination -RelativePath $relative
            if (-not $DryRun) {
                Copy-Item -Path $file.FullName -Destination $destination -Force
            }
            $deployed++
            $forcedOverwrites++
            continue
        }

        if ($PreserveExisting) {
            $skippedExisting++

            if ($AlignExisting -and ($managedEntryFiles -contains $relativeNormalized)) {
                $managedBlock = Get-ManagedBlockFromTemplate -SourcePath $file.FullName
                if (-not [string]::IsNullOrWhiteSpace($managedBlock)) {
                    $wasAligned = Sync-ManagedBlock -DestinationPath $destination -RelativePath $relative -ManagedBlock $managedBlock
                    if ($wasAligned) {
                        $aligned++
                    }
                }
            }

            continue
        }

        Backup-DestinationFile -DestinationPath $destination -RelativePath $relative
    }

    if (-not $DryRun) {
        Copy-Item -Path $file.FullName -Destination $destination -Force
    }
    $deployed++
}

$canonicalManagedBlock = Build-CanonicalManagedBlock -CanonicalFile $canonicalEntryFile
Apply-EntrypointManagedBlock -RelativePath $canonicalEntryFile -ManagedBlock $canonicalManagedBlock

foreach ($redirectFile in $redirectEntryFiles) {
    $redirectManagedBlock = Build-RedirectManagedBlock -TargetFile $redirectFile -CanonicalFile $canonicalEntryFile
    Apply-EntrypointManagedBlock -RelativePath $redirectFile -ManagedBlock $redirectManagedBlock
}

$gitignoreEntries = @(
    'Octopus-agent-orchestrator/',
    'AGENTS.md',
    'TASK.md',
    '.antigravity/',
    '.junie/',
    '.windsurf/',
    '.github/copilot-instructions.md'
)

$gitignoreAdded = 0
$gitignorePath = Join-Path $TargetRoot '.gitignore'
if (-not $DryRun) {
    if (-not (Test-Path $gitignorePath)) {
        New-Item -ItemType File -Path $gitignorePath -Force | Out-Null
    }

    $existingLines = @(Get-Content -Path $gitignorePath)
    $appendLines = @()
    foreach ($entry in $gitignoreEntries) {
        if ($existingLines -notcontains $entry) {
            $appendLines += $entry
        }
    }

    if ($appendLines.Count -gt 0) {
        Add-Content -Path $gitignorePath -Value ''
        Add-Content -Path $gitignorePath -Value '# Octopus-agent-orchestrator managed ignores'
        Add-Content -Path $gitignorePath -Value $appendLines
        $gitignoreAdded = $appendLines.Count
    }
} else {
    if (Test-Path $gitignorePath) {
        $existingLines = @(Get-Content -Path $gitignorePath)
        foreach ($entry in $gitignoreEntries) {
            if ($existingLines -notcontains $entry) {
                $gitignoreAdded++
            }
        }
    } else {
        $gitignoreAdded = $gitignoreEntries.Count
    }
}

if ($RunInit -and -not $DryRun) {
    $initScriptPath = Join-Path $scriptDir 'init.ps1'
    if (-not (Test-Path $initScriptPath)) {
        throw "Init script not found: $initScriptPath"
    }

    & $initScriptPath -TargetRoot $TargetRoot -AssistantLanguage $AssistantLanguage -AssistantBrevity $AssistantBrevity -SourceOfTruth $SourceOfTruth
    $initInvoked = $true
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "TemplateRoot: $sourceRoot"
Write-Output "PreserveExisting: $PreserveExisting"
Write-Output "AlignExisting: $AlignExisting"
Write-Output "RunInit: $RunInit"
Write-Output "AssistantLanguage: $AssistantLanguage"
Write-Output "AssistantBrevity: $AssistantBrevity"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "CanonicalEntrypoint: $canonicalEntryFile"
Write-Output "FilesDeployed: $deployed"
Write-Output "FilesForcedOverwrite: $forcedOverwrites"
Write-Output "FilesSkippedExisting: $skippedExisting"
Write-Output "FilesAligned: $aligned"
Write-Output "FilesBackedUp: $backedUp"
Write-Output "GitignoreEntriesAdded: $gitignoreAdded"
Write-Output "InitInvoked: $initInvoked"
if (-not $DryRun) {
    Write-Output "BackupRoot: $backupRoot"
}

