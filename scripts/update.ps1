param(
    [string]$TargetRoot,
    [string]$InitAnswersPath = 'Octopus-agent-orchestrator/runtime/init-answers.json',
    [switch]$DryRun,
    [switch]$SkipVerify,
    [switch]$SkipManifestValidation
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundleRoot = Split-Path -Parent $scriptDir

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $TargetRoot = Split-Path -Parent $bundleRoot
}
$TargetRoot = (Resolve-Path $TargetRoot).Path

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

$assistantLanguage = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantLanguage'
if ([string]::IsNullOrWhiteSpace($assistantLanguage)) {
    throw "Init answers artifact missing AssistantLanguage: $initAnswersResolvedPath"
}
$assistantLanguage = $assistantLanguage.Trim()

$assistantBrevity = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'AssistantBrevity'
if ([string]::IsNullOrWhiteSpace($assistantBrevity)) {
    throw "Init answers artifact missing AssistantBrevity: $initAnswersResolvedPath"
}
$assistantBrevity = $assistantBrevity.Trim().ToLowerInvariant()
$allowedBrevity = @('concise', 'detailed')
if ($allowedBrevity -notcontains $assistantBrevity) {
    throw "Init answers artifact has unsupported AssistantBrevity '$assistantBrevity'. Allowed values: concise, detailed."
}

$sourceOfTruth = Get-InitAnswerValue -Answers $initAnswers -LogicalName 'SourceOfTruth'
if ([string]::IsNullOrWhiteSpace($sourceOfTruth)) {
    throw "Init answers artifact missing SourceOfTruth: $initAnswersResolvedPath"
}
$sourceOfTruth = $sourceOfTruth.Trim()
$allowedSources = @('Claude', 'Codex', 'Gemini', 'GitHubCopilot', 'Windsurf', 'Junie', 'Antigravity')
if ($allowedSources -notcontains $sourceOfTruth) {
    throw "Init answers artifact has unsupported SourceOfTruth '$sourceOfTruth'. Allowed values: $($allowedSources -join ', ')."
}

$bundleVersionPath = Join-Path $bundleRoot 'VERSION'
if (-not (Test-Path -LiteralPath $bundleVersionPath -PathType Leaf)) {
    throw "Bundle version file not found: $bundleVersionPath"
}

$bundleVersion = (Get-Content -LiteralPath $bundleVersionPath -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($bundleVersion)) {
    throw "Bundle version file is empty: $bundleVersionPath"
}

$liveVersionPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/live/version.json'
$previousVersion = 'unknown'
$previousVersionSource = 'missing'
if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
    try {
        $liveVersion = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $liveVersion -and $null -ne $liveVersion.PSObject.Properties['Version']) {
            $parsedVersion = [string]$liveVersion.Version
            if (-not [string]::IsNullOrWhiteSpace($parsedVersion)) {
                $previousVersion = $parsedVersion.Trim()
                $previousVersionSource = 'live/version.json'
            } else {
                $previousVersionSource = 'live/version.json-empty'
            }
        } else {
            $previousVersionSource = 'live/version.json-no-version-field'
        }
    }
    catch {
        $previousVersionSource = 'live/version.json-invalid-json'
    }
}

$installScriptPath = Join-Path $scriptDir 'install.ps1'
$verifyScriptPath = Join-Path $scriptDir 'verify.ps1'
$manifestScriptPath = Join-Path $bundleRoot 'live/scripts/agent-gates/validate-manifest.ps1'
$manifestPath = Join-Path $TargetRoot 'Octopus-agent-orchestrator/MANIFEST.md'

if (-not (Test-Path -LiteralPath $installScriptPath -PathType Leaf)) {
    throw "Install script not found: $installScriptPath"
}
if (-not (Test-Path -LiteralPath $verifyScriptPath -PathType Leaf)) {
    throw "Verify script not found: $verifyScriptPath"
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$updateReportRelativePath = "Octopus-agent-orchestrator/runtime/update-reports/update-$timestamp.md"
$updateReportPath = Join-Path $TargetRoot $updateReportRelativePath

$installStatus = 'NOT_RUN'
$verifyStatus = 'NOT_RUN'
$manifestStatus = 'NOT_RUN'
$updatedVersion = $bundleVersion

$installParams = @{
    TargetRoot        = $TargetRoot
    AssistantLanguage = $assistantLanguage
    AssistantBrevity  = $assistantBrevity
    SourceOfTruth     = $sourceOfTruth
    InitAnswersPath   = $initAnswersResolvedPath
}
if ($DryRun) {
    $installParams.DryRun = $true
}

& $installScriptPath @installParams
$installStatus = 'PASS'

if ($DryRun) {
    $verifyStatus = 'SKIPPED_DRY_RUN'
    $manifestStatus = 'SKIPPED_DRY_RUN'
} else {
    if ($SkipVerify) {
        $verifyStatus = 'SKIPPED'
    } else {
        & $verifyScriptPath -TargetRoot $TargetRoot -SourceOfTruth $sourceOfTruth -InitAnswersPath $initAnswersResolvedPath
        $verifyStatus = 'PASS'
    }

    if ($SkipManifestValidation) {
        $manifestStatus = 'SKIPPED'
    } else {
        if (-not (Test-Path -LiteralPath $manifestScriptPath -PathType Leaf)) {
            throw "Manifest validation script not found: $manifestScriptPath"
        }
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            throw "Manifest file not found: $manifestPath"
        }

        & $manifestScriptPath -ManifestPath $manifestPath
        $manifestStatus = 'PASS'
    }

    if (Test-Path -LiteralPath $liveVersionPath -PathType Leaf) {
        try {
            $newLiveVersion = Get-Content -LiteralPath $liveVersionPath -Raw | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $newLiveVersion -and $null -ne $newLiveVersion.PSObject.Properties['Version']) {
                $newParsedVersion = [string]$newLiveVersion.Version
                if (-not [string]::IsNullOrWhiteSpace($newParsedVersion)) {
                    $updatedVersion = $newParsedVersion.Trim()
                }
            }
        }
        catch {
            $updatedVersion = 'unknown'
        }
    }
}

if (-not $DryRun) {
    $reportDir = Split-Path -Parent $updateReportPath
    if ($reportDir -and -not (Test-Path $reportDir)) {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    }

    $reportLines = @()
    $reportLines += '# Update Report'
    $reportLines += ''
    $reportLines += "GeneratedAt: $((Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK'))"
    $reportLines += "TargetRoot: $TargetRoot"
    $reportLines += "InitAnswersPath: $initAnswersResolvedPath"
    $reportLines += ''
    $reportLines += '## Version'
    $reportLines += "PreviousVersion: $previousVersion"
    $reportLines += "PreviousVersionSource: $previousVersionSource"
    $reportLines += "BundleVersion: $bundleVersion"
    $reportLines += "UpdatedVersion: $updatedVersion"
    $reportLines += ''
    $reportLines += '## CommandStatus'
    $reportLines += "Install: $installStatus"
    $reportLines += "Verify: $verifyStatus"
    $reportLines += "ManifestValidation: $manifestStatus"

    Set-Content -Path $updateReportPath -Value ($reportLines -join "`r`n")
}

Write-Output "TargetRoot: $TargetRoot"
Write-Output "InitAnswersPath: $initAnswersResolvedPath"
Write-Output "AssistantLanguage: $assistantLanguage"
Write-Output "AssistantBrevity: $assistantBrevity"
Write-Output "SourceOfTruth: $sourceOfTruth"
Write-Output "PreviousVersion: $previousVersion"
Write-Output "PreviousVersionSource: $previousVersionSource"
Write-Output "BundleVersion: $bundleVersion"
Write-Output "UpdatedVersion: $updatedVersion"
Write-Output "InstallStatus: $installStatus"
Write-Output "VerifyStatus: $verifyStatus"
Write-Output "ManifestValidationStatus: $manifestStatus"
if ($DryRun) {
    Write-Output 'UpdateReportPath: not-generated-in-dry-run'
} else {
    Write-Output "UpdateReportPath: $updateReportRelativePath"
}
Write-Output 'Update: PASS'
