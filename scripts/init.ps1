param(
    [string]$TargetRoot,
    [switch]$DryRun,
    [string]$AssistantLanguage = 'English',
    [string]$AssistantBrevity = 'concise',
    [ValidateSet('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')]
    [string]$SourceOfTruth = 'Claude'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir
$templateRoot = Join-Path $bundleRoot 'template'
$liveRoot = Join-Path $bundleRoot 'live'
$templateRuleRoot = Join-Path $templateRoot 'docs/agent-rules'

if (-not (Test-Path $templateRoot)) {
    throw "Template directory not found: $templateRoot"
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

$projectName = Split-Path -Leaf $TargetRoot
$timestampIso = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$liveRuleRoot = Join-Path $liveRoot 'docs/agent-rules'
$languagePlaceholder = '{{ASSISTANT_RESPONSE_LANGUAGE}}'
$brevityPlaceholder = '{{ASSISTANT_RESPONSE_BREVITY}}'

if ([string]::IsNullOrWhiteSpace($AssistantLanguage)) {
    $AssistantLanguage = 'English'
}
$AssistantLanguage = $AssistantLanguage.Trim()

if ([string]::IsNullOrWhiteSpace($AssistantBrevity)) {
    $AssistantBrevity = 'concise'
}
$AssistantBrevity = $AssistantBrevity.Trim().ToLowerInvariant()

$allowedBrevity = @('concise', 'detailed')
if ($allowedBrevity -notcontains $AssistantBrevity) {
    throw "Unsupported AssistantBrevity value '$AssistantBrevity'. Allowed values: concise, detailed."
}

$SourceOfTruth = $SourceOfTruth.Trim()
$sourceOfTruthKey = $SourceOfTruth.ToUpperInvariant().Replace(' ', '')
$sourceToEntrypoint = @{
    'CLAUDE' = 'CLAUDE.md'
    'CODEX' = 'AGENTS.md'
    'GEMINI' = 'GEMINI.md'
    'GITHUBCOPILOT' = '.github/copilot-instructions.md'
    'WINDSURF' = '.windsurf/rules/rules.md'
    'JUNIE' = '.junie/guidelines.md'
    'ANTIGRAVITY' = '.antigravity/rules.md'
}
$canonicalEntrypoint = if ($sourceToEntrypoint.ContainsKey($sourceOfTruthKey)) {
    $sourceToEntrypoint[$sourceOfTruthKey]
} else {
    'CLAUDE.md'
}

$ruleFiles = @(
    '00-core.md',
    '10-project-context.md',
    '20-architecture.md',
    '30-code-style.md',
    '35-strict-coding-rules.md',
    '40-commands.md',
    '50-structure-and-docs.md',
    '60-operating-rules.md',
    '70-security.md',
    '80-task-workflow.md',
    '90-skill-catalog.md'
)

$contextRuleFiles = @(
    '10-project-context.md',
    '20-architecture.md',
    '30-code-style.md',
    '40-commands.md',
    '50-structure-and-docs.md',
    '60-operating-rules.md'
)

$discoveryAugmentedRuleFiles = @(
    '10-project-context.md',
    '20-architecture.md',
    '30-code-style.md',
    '40-commands.md',
    '60-operating-rules.md'
)

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ($DryRun) {
        return
    }

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function To-RelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    try {
        return [System.IO.Path]::GetRelativePath($TargetRoot, $Path).Replace('\', '/')
    }
    catch {
        return $Path.Replace('\', '/')
    }
}

function Normalize-RelativePath {
    param(
        [AllowNull()]
        [string]$PathValue
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $normalized = $PathValue.Replace('\', '/').Trim()
    while ($normalized.StartsWith('./')) {
        $normalized = $normalized.Substring(2)
    }

    return $normalized.TrimStart('/')
}

function Get-ProjectDiscovery {
    $excludedPathFragments = @(
        '/.git/',
        '/node_modules/',
        '/.next/',
        '/dist/',
        '/build/',
        '/target/',
        '/bin/',
        '/obj/',
        '/Octopus-agent-orchestrator/'
    )

    $relativeFiles = @()
    $discoverySource = 'filesystem_scan'
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCommand -and (Test-Path (Join-Path $TargetRoot '.git'))) {
        $tracked = @(git -C $TargetRoot ls-files 2>$null | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $untracked = @(git -C $TargetRoot ls-files --others --exclude-standard 2>$null | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $relativeFiles = @($tracked + $untracked | Sort-Object -Unique)
        $discoverySource = 'git_index_and_worktree'
    }

    if ($relativeFiles.Count -eq 0) {
        $files = Get-ChildItem -Path $TargetRoot -Recurse -File -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            $relative = Normalize-RelativePath (To-RelativePath -Path $file.FullName)
            if ([string]::IsNullOrWhiteSpace($relative)) {
                continue
            }

            $wrapped = "/$relative/"
            $isExcluded = $false
            foreach ($fragment in $excludedPathFragments) {
                if ($wrapped -like "*$fragment*") {
                    $isExcluded = $true
                    break
                }
            }
            if ($isExcluded) {
                continue
            }

            $relativeFiles += $relative
        }
        $relativeFiles = @($relativeFiles | Sort-Object -Unique)
    }

    $filteredFiles = @()
    foreach ($relative in $relativeFiles) {
        $normalized = Normalize-RelativePath $relative
        if ([string]::IsNullOrWhiteSpace($normalized)) {
            continue
        }

        $wrapped = "/$normalized/"
        $isExcluded = $false
        foreach ($fragment in $excludedPathFragments) {
            if ($wrapped -like "*$fragment*") {
                $isExcluded = $true
                break
            }
        }
        if ($isExcluded) {
            continue
        }

        $filteredFiles += $normalized
    }
    $relativeFiles = @($filteredFiles | Sort-Object -Unique)

    $stackSignals = [ordered]@{
        'Node.js or JavaScript' = '(^|/)package\.json$'
        'TypeScript' = '(^|/)tsconfig(\.[^/]+)?\.json$'
        'Java or JVM' = '(^|/)(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$'
        'Python' = '(^|/)(pyproject\.toml|requirements(\.txt|-dev\.txt)?)$'
        'Go' = '(^|/)go\.mod$'
        'Rust' = '(^|/)Cargo\.toml$'
        '.NET' = '\.(sln|csproj|fsproj)$'
        'PHP' = '(^|/)composer\.json$'
        'Ruby' = '(^|/)Gemfile$'
        'Containerization' = '(^|/)Dockerfile(\..+)?$|(^|/)docker-compose(\.[^/]+)?\.ya?ml$'
    }

    $detectedStacks = @()
    foreach ($signal in $stackSignals.GetEnumerator()) {
        $matched = ($relativeFiles | Where-Object { $_ -match $signal.Value }).Count -gt 0
        if ($matched) {
            $detectedStacks += $signal.Key
        }
    }

    $topLevelDirectories = @(
        Get-ChildItem -Path $TargetRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -notin @('Octopus-agent-orchestrator', '.git', 'node_modules', 'dist', 'build', 'target', 'bin', 'obj')
            } |
            Select-Object -ExpandProperty Name
    )

    $suggestedCommands = @()
    if ($detectedStacks -contains 'Node.js or JavaScript') {
        $suggestedCommands += 'npm run test'
        $suggestedCommands += 'npm run lint'
        $suggestedCommands += 'npm run build'
    }
    if ($detectedStacks -contains 'Python') {
        $suggestedCommands += 'pytest'
        $suggestedCommands += 'ruff check .'
    }
    if ($detectedStacks -contains 'Java or JVM') {
        $suggestedCommands += './mvnw test'
        $suggestedCommands += './gradlew test'
    }
    if ($detectedStacks -contains 'Go') {
        $suggestedCommands += 'go test ./...'
    }
    if ($detectedStacks -contains 'Rust') {
        $suggestedCommands += 'cargo test'
    }
    if ($detectedStacks -contains '.NET') {
        $suggestedCommands += 'dotnet test'
    }

    return [PSCustomObject]@{
        source = $discoverySource
        file_count = $relativeFiles.Count
        detected_stacks = @($detectedStacks | Sort-Object -Unique)
        top_level_directories = @($topLevelDirectories | Sort-Object -Unique)
        suggested_commands = @($suggestedCommands | Sort-Object -Unique)
        sample_files = @($relativeFiles | Select-Object -First 40)
    }
}

function Build-ProjectDiscoveryLines {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Discovery
    )

    $tick = [char]96
    $lines = @()
    $lines += '# Project Discovery'
    $lines += ''
    $lines += "Generated at: $timestampIso"
    $lines += 'Source: ' + $Discovery.source
    $lines += 'Files considered: ' + $Discovery.file_count
    $lines += ''
    $lines += '## Detected Stack Signals'
    if ($Discovery.detected_stacks.Count -eq 0) {
        $lines += '- No strong stack markers detected. Fill context rules manually.'
    } else {
        foreach ($stack in $Discovery.detected_stacks) {
            $lines += "- $stack"
        }
    }
    $lines += ''
    $lines += '## Top-Level Directories'
    if ($Discovery.top_level_directories.Count -eq 0) {
        $lines += '- No top-level runtime directories detected.'
    } else {
        foreach ($dir in $Discovery.top_level_directories) {
            $lines += "- $tick$dir/$tick"
        }
    }
    $lines += ''
    $lines += '## Suggested Local Commands (Heuristic)'
    if ($Discovery.suggested_commands.Count -eq 0) {
        $lines += '- No command suggestions from discovery. Populate `40-commands.md` manually.'
    } else {
        foreach ($command in $Discovery.suggested_commands) {
            $lines += "- $tick$command$tick"
        }
    }
    $lines += ''
    $lines += '## Sample Files Used For Detection'
    if ($Discovery.sample_files.Count -eq 0) {
        $lines += '- No sample files captured.'
    } else {
        foreach ($sample in $Discovery.sample_files) {
            $lines += "- $tick$sample$tick"
        }
    }

    return $lines
}

function Build-DiscoveryOverlaySection {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Discovery
    )

    $stacksText = if ($Discovery.detected_stacks.Count -gt 0) {
        ($Discovery.detected_stacks -join ', ')
    } else {
        'none detected'
    }
    $dirsText = if ($Discovery.top_level_directories.Count -gt 0) {
        (($Discovery.top_level_directories | Select-Object -First 10) -join ', ')
    } else {
        'none detected'
    }

    $lines = @()
    $lines += '## Project Discovery Snapshot'
    $lines += "- Discovery source: $($Discovery.source)"
    $lines += "- Files considered: $($Discovery.file_count)"
    $lines += "- Detected stacks: $stacksText"
    $lines += "- Top-level directories: $dirsText"
    $lines += '- Full report: `Octopus-agent-orchestrator/live/project-discovery.md`'

    return ($lines -join "`r`n")
}

function Select-RuleSource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RuleFile
    )

    $legacyCandidate = Join-Path $TargetRoot "docs/agent-rules/$RuleFile"
    $liveCandidate = Join-Path $liveRuleRoot $RuleFile
    $templateCandidate = Join-Path $templateRuleRoot $RuleFile

    $isContextRule = $contextRuleFiles -contains $RuleFile

    if ($RuleFile -eq '00-core.md') {
        if (Test-Path $templateCandidate) {
            return @{ Path = $templateCandidate; Origin = 'template' }
        }
        if (Test-Path $liveCandidate) {
            return @{ Path = $liveCandidate; Origin = 'live-existing' }
        }
        if (Test-Path $legacyCandidate) {
            return @{ Path = $legacyCandidate; Origin = 'legacy-docs' }
        }
    }

    if ($isContextRule) {
        if (Test-Path $legacyCandidate) {
            return @{ Path = $legacyCandidate; Origin = 'legacy-docs' }
        }
        if (Test-Path $templateCandidate) {
            return @{ Path = $templateCandidate; Origin = 'template' }
        }
        if (Test-Path $liveCandidate) {
            return @{ Path = $liveCandidate; Origin = 'live-existing' }
        }
    } else {
        if (Test-Path $liveCandidate) {
            return @{ Path = $liveCandidate; Origin = 'live-existing' }
        }
        if (Test-Path $templateCandidate) {
            return @{ Path = $templateCandidate; Origin = 'template' }
        }
        if (Test-Path $legacyCandidate) {
            return @{ Path = $legacyCandidate; Origin = 'legacy-docs' }
        }
    }

    return $null
}

function Apply-ContextDefaults {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$RuleFile
    )

    if (-not ($discoveryAugmentedRuleFiles -contains $RuleFile)) {
        return $Content
    }

    if ([string]::IsNullOrWhiteSpace($script:projectDiscoveryOverlaySection)) {
        return $Content
    }

    $updated = $Content.TrimEnd()
    if ($updated -match '(?ms)^## Project Discovery Snapshot.*?(?=^## |\z)') {
        $updated = [regex]::Replace(
            $updated,
            '(?ms)^## Project Discovery Snapshot.*?(?=^## |\z)',
            $script:projectDiscoveryOverlaySection
        )
        return $updated + "`r`n"
    }

    return $updated + "`r`n`r`n" + $script:projectDiscoveryOverlaySection + "`r`n"
}

function Apply-AssistantDefaults {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$RuleFile
    )

    if ($RuleFile -ne '00-core.md') {
        return $Content
    }

    $updated = $Content.Replace($languagePlaceholder, $AssistantLanguage)
    $updated = $updated.Replace($brevityPlaceholder, $AssistantBrevity)
    $updated = [regex]::Replace(
        $updated,
        '(?m)^Respond in .+ for explanations and assistance\.$',
        "Respond in $AssistantLanguage for explanations and assistance."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^1\. Respond in .+\.$',
        "1. Respond in $AssistantLanguage."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^Default response brevity: .+\.$',
        "Default response brevity: $AssistantBrevity."
    )
    $updated = [regex]::Replace(
        $updated,
        '(?m)^2\. Keep responses .+ unless the user explicitly asks for more or less detail\.$',
        "2. Keep responses $AssistantBrevity unless the user explicitly asks for more or less detail."
    )

    return $updated
}

Ensure-Directory -Path $liveRoot
Ensure-Directory -Path $liveRuleRoot

$projectDiscovery = Get-ProjectDiscovery
$projectDiscoveryLines = Build-ProjectDiscoveryLines -Discovery $projectDiscovery
$script:projectDiscoveryOverlaySection = Build-DiscoveryOverlaySection -Discovery $projectDiscovery

$ruleSourceMap = @()
foreach ($ruleFile in $ruleFiles) {
    $source = Select-RuleSource -RuleFile $ruleFile
    if ($null -eq $source) {
        throw "No source found for rule file: $ruleFile"
    }

    $sourcePath = $source.Path
    $sourceOrigin = $source.Origin
    $destinationPath = Join-Path $liveRuleRoot $ruleFile

    $content = Get-Content -Path $sourcePath -Raw
    if ([string]::IsNullOrWhiteSpace($content)) {
        throw "Rule source is empty: $sourcePath"
    }

    if ($sourceOrigin -eq 'template') {
        $content = Apply-ContextDefaults -Content $content -RuleFile $ruleFile
    }

    $content = Apply-AssistantDefaults -Content $content -RuleFile $ruleFile

    if (-not $DryRun) {
        Set-Content -Path $destinationPath -Value $content
    }

    $ruleSourceMap += [PSCustomObject]@{
        RuleFile = $ruleFile
        Source = (To-RelativePath -Path $sourcePath)
        Origin = $sourceOrigin
        Destination = (To-RelativePath -Path $destinationPath)
    }
}

$supportDirectories = @(
    'config',
    'scripts',
    'skills',
    'docs/changes',
    'docs/reviews',
    'docs/tasks'
)

$copiedSupportDirs = 0
foreach ($relativeDirectory in $supportDirectories) {
    $sourceDirectory = Join-Path $templateRoot $relativeDirectory
    if (-not (Test-Path $sourceDirectory)) {
        continue
    }

    $destinationDirectory = Join-Path $liveRoot $relativeDirectory
    Ensure-Directory -Path $destinationDirectory

    if (-not $DryRun) {
        Copy-Item -Path (Join-Path $sourceDirectory '*') -Destination $destinationDirectory -Recurse -Force
    }

    $copiedSupportDirs++
}

$legacyEntrypoints = @(
    'CLAUDE.md',
    'AGENTS.md',
    'GEMINI.md',
    '.github/agents/orchestrator.md',
    '.github/agents/reviewer.md',
    '.github/agents/code-review.md',
    '.github/agents/db-review.md',
    '.github/agents/security-review.md',
    '.github/agents/refactor-review.md',
    '.github/agents/api-review.md',
    '.github/agents/test-review.md',
    '.github/agents/performance-review.md',
    '.github/agents/infra-review.md',
    '.github/agents/dependency-review.md',
    '.windsurf/agents/orchestrator.md',
    '.junie/agents/orchestrator.md',
    '.antigravity/agents/orchestrator.md',
    '.qwen/settings.json',
    'TASK.md',
    '.antigravity/rules.md',
    '.junie/guidelines.md',
    '.windsurf/rules/rules.md',
    '.github/copilot-instructions.md'
)

$legacyDirectories = @(
    'docs/agent-rules'
)

$entryInventory = @()
foreach ($relativePath in $legacyEntrypoints) {
    $fullPath = Join-Path $TargetRoot $relativePath
    $state = if (Test-Path $fullPath) { 'FOUND' } else { 'MISSING' }
    $entryInventory += [PSCustomObject]@{
        Path = $relativePath
        State = $state
    }
}

$directoryInventory = @()
foreach ($relativePath in $legacyDirectories) {
    $fullPath = Join-Path $TargetRoot $relativePath
    if (Test-Path $fullPath) {
        $fileCount = (Get-ChildItem -Path $fullPath -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
        $directoryInventory += [PSCustomObject]@{
            Path = $relativePath
            State = 'FOUND'
            FileCount = $fileCount
        }
    } else {
        $directoryInventory += [PSCustomObject]@{
            Path = $relativePath
            State = 'MISSING'
            FileCount = 0
        }
    }
}

$docsRoot = Join-Path $TargetRoot 'docs'
$docSamples = @()
$docCount = 0
if (Test-Path $docsRoot) {
    $docs = Get-ChildItem -Path $docsRoot -Recurse -File -Filter '*.md' -ErrorAction SilentlyContinue
    $docCount = ($docs | Measure-Object).Count
    $docSamples = $docs | Select-Object -First 40
}

$normalizedTargetRoot = $TargetRoot -replace '\\', '/'
$mdCode = [char]96
$discoveredStackSummary = if ($projectDiscovery.detected_stacks.Count -gt 0) {
    $projectDiscovery.detected_stacks -join ', '
} else {
    'none detected'
}
$discoveredDirectorySummary = if ($projectDiscovery.top_level_directories.Count -gt 0) {
    ($projectDiscovery.top_level_directories | Select-Object -First 10) -join ', '
} else {
    'none detected'
}

$inventoryLines = @()
$inventoryLines += '# Source Inventory'
$inventoryLines += ''
$inventoryLines += "Generated at: $timestampIso"
$inventoryLines += "Project root: $normalizedTargetRoot"
$inventoryLines += ''
$inventoryLines += '## Legacy Entrypoints'
foreach ($item in $entryInventory) {
    $inventoryLines += "- $mdCode$($item.Path)$mdCode : $($item.State)"
}
$inventoryLines += ''
$inventoryLines += '## Legacy Rule Sources'
foreach ($item in $directoryInventory) {
    $inventoryLines += "- $mdCode$($item.Path)$mdCode : $($item.State) (files=$($item.FileCount))"
}
$inventoryLines += ''
$inventoryLines += '## Documentation Snapshot'
$inventoryLines += '- Markdown files in `docs/`: ' + $docCount
if ($docSamples.Count -gt 0) {
    $inventoryLines += '- Sample files:'
    foreach ($item in $docSamples) {
        $inventoryLines += "  - $mdCode$((To-RelativePath -Path $item.FullName))$mdCode"
    }
}

$initReportLines = @()
$initReportLines += '# Init Report'
$initReportLines += ''
$initReportLines += "Generated at: $timestampIso"
$initReportLines += "Project: $projectName"
$initReportLines += "Target root: $normalizedTargetRoot"
$initReportLines += ''
$initReportLines += '## Summary'
$initReportLines += '- Rule files materialized in `Octopus-agent-orchestrator/live/docs/agent-rules`: ' + $ruleFiles.Count
$initReportLines += '- Support directories synced into `Octopus-agent-orchestrator/live`: ' + $copiedSupportDirs
$initReportLines += '- Assistant response language: ' + $AssistantLanguage
$initReportLines += '- Assistant response brevity: ' + $AssistantBrevity
$initReportLines += '- Source of truth entrypoint: ' + $SourceOfTruth
$initReportLines += '- Project discovery source: ' + $projectDiscovery.source
$initReportLines += '- Project discovery stack signals: ' + $discoveredStackSummary
$initReportLines += '- Project discovery top-level directories: ' + $discoveredDirectorySummary
$initReportLines += '- Legacy docs discovered in `docs/agent-rules`: ' + ((($directoryInventory | Where-Object { $_.Path -eq 'docs/agent-rules' }).FileCount)) + ' files'
$initReportLines += "- No files were moved or deleted; discovery sources were read-only."
$initReportLines += ''
$initReportLines += '## Rule Source Mapping'
$initReportLines += '| Rule file | Source | Origin | Destination |'
$initReportLines += '|---|---|---|---|'
foreach ($item in $ruleSourceMap) {
    $initReportLines += "| $($item.RuleFile) | $mdCode$($item.Source)$mdCode | $($item.Origin) | $mdCode$($item.Destination)$mdCode |"
}
$initReportLines += ''
$initReportLines += '## Context Fill Policy'
$initReportLines += '- Project-context rules (`10/20/30/40/50/60`) prefer `docs/agent-rules/*` when available.'
$initReportLines += '- All other rules prefer existing `live` content, then template defaults.'
$initReportLines += '- Discovery overlay is appended to context rules (`10/20/30/40/60`) using `live/project-discovery.md`.'
$initReportLines += '- Selected source-of-truth entrypoint (`' + $SourceOfTruth + '`) is provided by installer and points to `Octopus-agent-orchestrator/live/docs/agent-rules/*`.'

$sourceInventoryPath = Join-Path $liveRoot 'source-inventory.md'
$initReportPath = Join-Path $liveRoot 'init-report.md'
$projectDiscoveryPath = Join-Path $liveRoot 'project-discovery.md'
$usagePath = Join-Path $liveRoot 'USAGE.md'
if (-not $DryRun) {
    Set-Content -Path $sourceInventoryPath -Value ($inventoryLines -join "`r`n")
    Set-Content -Path $initReportPath -Value ($initReportLines -join "`r`n")
    Set-Content -Path $projectDiscoveryPath -Value ($projectDiscoveryLines -join "`r`n")

    # Seed usage instructions so verification can pass before an agent writes project-specific guidance.
    if (-not (Test-Path -LiteralPath $usagePath)) {
        $usageLines = @(
            '# Usage Instructions',
            '',
            "Language: $AssistantLanguage",
            "Default response brevity: $AssistantBrevity",
            '',
            '## Execute Tasks',
            '- Explicit depth: `Execute task <task-id> depth=<1|2|3>`',
            '- Default depth (`2`): `Execute task <task-id>`',
            '',
            '## Depth Guide',
            '- `depth=1`: simple or low-risk change.',
            '- `depth=2`: default for most tasks.',
            '- `depth=3`: high-risk or cross-cutting work.',
            '',
            "Canonical instructions entrypoint for orchestration: `$canonicalEntrypoint`.",
            "Hard stop: first open `$canonicalEntrypoint` and follow its routing links. Only then execute any task from `TASK.md`.",
            'Orchestrator mode starts when task execution is requested from this file (`TASK.md`).',
            'If needed, the agent can add new tasks from user requests and then execute them in orchestrator mode.',
            '',
            'Tasks are managed in root `TASK.md`.',
            'This file can be replaced by the setup agent with project-specific instructions.'
        )
        Set-Content -Path $usagePath -Value ($usageLines -join "`r`n")
    }
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "ProjectName: $projectName"
Write-Output "LiveRoot: $liveRoot"
Write-Output "AssistantLanguage: $AssistantLanguage"
Write-Output "AssistantBrevity: $AssistantBrevity"
Write-Output "SourceOfTruth: $SourceOfTruth"
Write-Output "RuleFilesMaterialized: $($ruleFiles.Count)"
Write-Output "SupportDirectoriesSynced: $copiedSupportDirs"
Write-Output "DocFilesDiscovered: $docCount"
Write-Output "SourceInventoryPath: $sourceInventoryPath"
Write-Output "InitReportPath: $initReportPath"
Write-Output "ProjectDiscoveryPath: $projectDiscoveryPath"
Write-Output "UsagePath: $usagePath"
Write-Output 'Init: PASS'


