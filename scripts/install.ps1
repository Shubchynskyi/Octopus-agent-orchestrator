param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [bool]$PreserveExisting = $true,
    [bool]$AlignExisting = $true,
    [bool]$RunInit = $true,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$AssistantLanguage,
    [Parameter(Mandatory = $true)]
    [ValidateSet('concise', 'detailed')]
    [string]$AssistantBrevity,
    [ValidateSet('Claude', 'Codex', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [Parameter(Mandatory = $true)]
    [string]$SourceOfTruth,
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InitAnswersPath
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

$AssistantLanguage = $AssistantLanguage.Trim()
if ([string]::IsNullOrWhiteSpace($AssistantLanguage)) {
    throw 'AssistantLanguage must not be empty.'
}

$AssistantBrevity = $AssistantBrevity.Trim().ToLowerInvariant()
$SourceOfTruth = $SourceOfTruth.Trim()

function Get-InitAnswerValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Answers,
        [Parameter(Mandatory = $true)]
        [string]$LogicalName
    )

    $targetKey = $LogicalName.ToLowerInvariant().Replace('_', '').Replace('-', '')
    foreach ($property in $Answers.PSObject.Properties) {
        $propertyKey = $property.Name.ToLowerInvariant().Replace('_', '').Replace('-', '')
        if ($propertyKey -eq $targetKey) {
            if ($null -eq $property.Value) {
                return $null
            }
            return [string]$property.Value
        }
    }

    return $null
}

$initAnswersCandidatePath = $InitAnswersPath
if (-not [System.IO.Path]::IsPathRooted($initAnswersCandidatePath)) {
    $initAnswersCandidatePath = Join-Path $TargetRoot $initAnswersCandidatePath
}

if (-not (Test-Path -LiteralPath $initAnswersCandidatePath -PathType Leaf)) {
    throw "Init answers artifact not found: $initAnswersCandidatePath"
}

$initAnswersResolvedPath = (Resolve-Path -LiteralPath $initAnswersCandidatePath).Path
$initAnswersRaw = Get-Content -LiteralPath $initAnswersResolvedPath -Raw
if ([string]::IsNullOrWhiteSpace($initAnswersRaw)) {
    throw "Init answers artifact is empty: $initAnswersResolvedPath"
}

try {
    $initAnswers = $initAnswersRaw | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Init answers artifact is not valid JSON: $initAnswersResolvedPath"
}

$artifactAssistantLanguage = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantLanguage'
if ([string]::IsNullOrWhiteSpace($artifactAssistantLanguage)) {
    throw "Init answers artifact missing AssistantLanguage: $initAnswersResolvedPath"
}
$artifactAssistantLanguage = $artifactAssistantLanguage.Trim()

$artifactAssistantBrevity = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantBrevity'
if ([string]::IsNullOrWhiteSpace($artifactAssistantBrevity)) {
    throw "Init answers artifact missing AssistantBrevity: $initAnswersResolvedPath"
}
$artifactAssistantBrevity = $artifactAssistantBrevity.Trim().ToLowerInvariant()
$allowedBrevity = @('concise', 'detailed')
if ($allowedBrevity -notcontains $artifactAssistantBrevity) {
    throw "Init answers artifact has unsupported AssistantBrevity '$artifactAssistantBrevity'. Allowed values: concise, detailed."
}

$artifactSourceOfTruth = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'SourceOfTruth'
if ([string]::IsNullOrWhiteSpace($artifactSourceOfTruth)) {
    throw "Init answers artifact missing SourceOfTruth: $initAnswersResolvedPath"
}
$artifactSourceOfTruth = $artifactSourceOfTruth.Trim()

$artifactCollectedVia = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'CollectedVia'
if ([string]::IsNullOrWhiteSpace($artifactCollectedVia)) {
    throw "Init answers artifact must include CollectedVia='AGENT_INIT_PROMPT.md': $initAnswersResolvedPath"
}
if (-not [string]::Equals($artifactCollectedVia.Trim(), 'AGENT_INIT_PROMPT.md', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Init answers artifact CollectedVia must be 'AGENT_INIT_PROMPT.md'. Current value: '$artifactCollectedVia'."
}

$sourceOfTruthKey = $SourceOfTruth.Trim().ToUpperInvariant().Replace(' ', '')
$artifactSourceOfTruthKey = $artifactSourceOfTruth.ToUpperInvariant().Replace(' ', '')
if ($sourceOfTruthKey -ne $artifactSourceOfTruthKey) {
    throw "SourceOfTruth parameter '$SourceOfTruth' does not match init answers artifact value '$artifactSourceOfTruth'."
}

if (-not [string]::Equals($AssistantLanguage, $artifactAssistantLanguage, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "AssistantLanguage parameter '$AssistantLanguage' does not match init answers artifact value '$artifactAssistantLanguage'."
}

if ($AssistantBrevity -ne $artifactAssistantBrevity) {
    throw "AssistantBrevity parameter '$AssistantBrevity' does not match init answers artifact value '$artifactAssistantBrevity'."
}

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
$taskDeploymentDatePlaceholder = '{{DEPLOYMENT_DATE}}'
$deploymentDate = (Get-Date).ToString('yyyy-MM-dd')

function Get-TemplateContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    if (-not (Test-Path $SourcePath)) {
        return $null
    }

    $content = Get-Content -Path $SourcePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        return $null
    }

    $relativePathNormalized = $RelativePath.Replace('\', '/')
    if ($relativePathNormalized -eq 'TASK.md') {
        $content = $content.Replace($taskDeploymentDatePlaceholder, $deploymentDate)
    }

    return $content
}

function Copy-TemplateFileToDestination {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath,
        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    $relativePathNormalized = $RelativePath.Replace('\', '/')
    if ($relativePathNormalized -eq 'TASK.md') {
        $content = Get-TemplateContent -SourcePath $SourcePath -RelativePath $RelativePath
        if ([string]::IsNullOrWhiteSpace($content)) {
            throw "Template content is empty: $SourcePath"
        }

        if (-not $DryRun) {
            Set-Content -Path $DestinationPath -Value $content
        }

        return
    }

    if (-not $DryRun) {
        Copy-Item -Path $SourcePath -Destination $DestinationPath -Force
    }
}

function Get-ManagedBlockFromTemplate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $content = Get-TemplateContent -SourcePath $SourcePath -RelativePath $RelativePath
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

    $baseBlock = Get-ManagedBlockFromTemplate -SourcePath (Join-Path $sourceRoot 'CLAUDE.md') -RelativePath 'CLAUDE.md'
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
            Copy-TemplateFileToDestination -SourcePath $file.FullName -RelativePath $relativeNormalized -DestinationPath $destination
            $deployed++
            $forcedOverwrites++
            continue
        }

        if ($PreserveExisting) {
            $skippedExisting++

            if ($AlignExisting -and ($managedEntryFiles -contains $relativeNormalized)) {
                $managedBlock = Get-ManagedBlockFromTemplate -SourcePath $file.FullName -RelativePath $relativeNormalized
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

    Copy-TemplateFileToDestination -SourcePath $file.FullName -RelativePath $relativeNormalized -DestinationPath $destination
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
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "DeploymentDate: $deploymentDate"
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

