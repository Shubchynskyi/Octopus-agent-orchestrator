Set-StrictMode -Version Latest

function Test-GateOrchestratorRootCandidate {
    param([string]$CandidatePath)

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $CandidatePath -PathType Container)) {
        return $false
    }

    $liveScriptsPath = Join-Path $CandidatePath 'live/scripts/agent-gates'
    $liveConfigPath = Join-Path $CandidatePath 'live/config'
    return (Test-Path -LiteralPath $liveScriptsPath -PathType Container) -and (Test-Path -LiteralPath $liveConfigPath -PathType Container)
}

function Test-GateWorkspaceRootCandidate {
    param([string]$CandidatePath)

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $CandidatePath -PathType Container)) {
        return $false
    }

    $sourceRepoIndicators = @(
        (Join-Path $CandidatePath 'template'),
        (Join-Path $CandidatePath 'scripts')
    )
    $isSourceRepoRoot = (Test-GateOrchestratorRootCandidate -CandidatePath $CandidatePath) -and (@($sourceRepoIndicators | Where-Object {
        Test-Path -LiteralPath $_ -PathType Container
    }).Count -eq $sourceRepoIndicators.Count)
    if ($isSourceRepoRoot) {
        return $true
    }

    return Test-GateOrchestratorRootCandidate -CandidatePath (Join-Path $CandidatePath 'Octopus-agent-orchestrator')
}

function Get-GateProjectRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptRoot
    )

    $currentPath = [System.IO.Path]::GetFullPath($ScriptRoot)
    while (-not [string]::IsNullOrWhiteSpace($currentPath)) {
        if (Test-GateWorkspaceRootCandidate -CandidatePath $currentPath) {
            return (Resolve-Path -LiteralPath $currentPath).Path
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or [string]::Equals($parentPath, $currentPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $currentPath = $parentPath
    }

    $projectRootCandidate = Join-Path $ScriptRoot '..\..\..\..'
    if (Test-Path -LiteralPath $projectRootCandidate) {
        return (Resolve-Path -LiteralPath $projectRootCandidate).Path
    }

    return (Resolve-Path -LiteralPath (Join-Path $ScriptRoot '..\..')).Path
}

function Get-GateOrchestratorRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath
    )

    $workspaceRoot = [System.IO.Path]::GetFullPath($RepoRootPath)
    $deployedRoot = Join-Path $workspaceRoot 'Octopus-agent-orchestrator'
    if (Test-GateOrchestratorRootCandidate -CandidatePath $deployedRoot) {
        return (Resolve-Path -LiteralPath $deployedRoot).Path
    }

    if (Test-GateOrchestratorRootCandidate -CandidatePath $workspaceRoot) {
        return (Resolve-Path -LiteralPath $workspaceRoot).Path
    }

    if (Test-Path -LiteralPath $deployedRoot) {
        return [System.IO.Path]::GetFullPath($deployedRoot)
    }

    return $workspaceRoot
}

function Get-GateOrchestratorRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [string]$PathValue = ''
    )

    $normalized = Convert-GatePathToUnix -PathValue $PathValue -TrimValue -StripLeadingRelative
    $prefix = 'Octopus-agent-orchestrator/'
    if (-not [string]::IsNullOrWhiteSpace($normalized) -and $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $normalized = $normalized.Substring($prefix.Length)
    }

    $workspaceRoot = [System.IO.Path]::GetFullPath($RepoRootPath)
    $orchestratorRoot = Get-GateOrchestratorRoot -RepoRootPath $workspaceRoot
    if ([string]::Equals($workspaceRoot.TrimEnd('\', '/'), $orchestratorRoot.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
        return $normalized
    }

    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return 'Octopus-agent-orchestrator'
    }

    return "Octopus-agent-orchestrator/$normalized"
}

function Join-GateOrchestratorPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [string]$RelativePath = ''
    )

    $workspaceRoot = [System.IO.Path]::GetFullPath($RepoRootPath)
    $orchestratorRoot = Get-GateOrchestratorRoot -RepoRootPath $workspaceRoot
    $normalized = Convert-GatePathToUnix -PathValue $RelativePath -TrimValue -StripLeadingRelative
    $prefix = 'Octopus-agent-orchestrator/'
    if (-not [string]::IsNullOrWhiteSpace($normalized) -and $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $normalized = $normalized.Substring($prefix.Length)
    }

    $candidate = if ([string]::IsNullOrWhiteSpace($normalized)) {
        $orchestratorRoot
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $orchestratorRoot ($normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar))))
    }

    $workspaceNormalized = $workspaceRoot.TrimEnd('\', '/')
    $candidateNormalized = $candidate.TrimEnd('\', '/')
    $workspaceBoundary = $workspaceNormalized + [System.IO.Path]::DirectorySeparatorChar
    if (-not (
            [string]::Equals($candidateNormalized, $workspaceNormalized, [System.StringComparison]::OrdinalIgnoreCase) -or
            $candidate.StartsWith($workspaceBoundary, [System.StringComparison]::OrdinalIgnoreCase)
        )) {
        throw "Path '$RelativePath' must resolve inside repository root '$RepoRootPath'."
    }

    return $candidate
}

function Convert-GatePathToUnix {
    param(
        [string]$PathValue,
        [switch]$TrimValue,
        [switch]$StripLeadingRelative
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    $normalized = $PathValue.Replace('\', '/')
    if ($TrimValue) {
        $normalized = $normalized.Trim()
    }

    if ($StripLeadingRelative) {
        while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
            $normalized = $normalized.Substring(2)
        }
        $normalized = $normalized.TrimStart('/')
    }

    return $normalized
}

function Get-GateStringSha256 {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Value)
        $hash = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-GateCompactReviewBudget {
    param([AllowNull()][object]$FailTailLines)

    $resolvedFailTailLines = 50
    if ($FailTailLines -is [int] -or $FailTailLines -is [long] -or $FailTailLines -is [short] -or $FailTailLines -is [byte]) {
        $resolvedFailTailLines = [int]$FailTailLines
    } elseif ($null -ne $FailTailLines) {
        $parsed = 0
        if ([int]::TryParse(([string]$FailTailLines).Trim(), [ref]$parsed)) {
            $resolvedFailTailLines = $parsed
        }
    }

    if ($resolvedFailTailLines -lt 1) {
        $resolvedFailTailLines = 50
    }

    $maxLines = [Math]::Max(120, $resolvedFailTailLines + 70)
    $maxChars = [Math]::Max(12000, $maxLines * 100)
    return [ordered]@{
        fail_tail_lines = $resolvedFailTailLines
        max_lines = $maxLines
        max_chars = $maxChars
        max_code_fence_lines = 4
        max_example_markers = 0
    }
}

function Estimate-GateCharTokenCount {
    param(
        [Parameter(Mandatory = $true)]
        [int]$CharCount,
        [string]$Estimator = 'chars_per_4'
    )

    if ($CharCount -le 0) {
        return 0
    }

    switch ($Estimator) {
        'chars_per_3_5' {
            return [int][Math]::Ceiling($CharCount / 3.5)
        }
        'chars_per_4_5' {
            return [int][Math]::Ceiling($CharCount / 4.5)
        }
        default {
            return [int][Math]::Ceiling($CharCount / 4.0)
        }
    }
}

function Estimate-GateTokenCount {
    param(
        [object]$Lines,
        [string]$Estimator = 'hybrid_text_v1'
    )

    $normalizedLines = @(Convert-GateToStringArray -Value $Lines)
    $charCount = Get-GateTextCharCount -Lines $normalizedLines
    if ($charCount -le 0) {
        return 0
    }

    if ($Estimator -in @('chars_per_4', 'chars_per_3_5', 'chars_per_4_5')) {
        return Estimate-GateCharTokenCount -CharCount $charCount -Estimator $Estimator
    }

    $text = @($normalizedLines) -join "`n"
    $baseEstimate = Estimate-GateCharTokenCount -CharCount $charCount -Estimator 'chars_per_4'
    $tokenishUnitCount = [regex]::Matches($text, "[A-Za-z]+(?:'[A-Za-z]+)?|[0-9]+|[^\w\s]").Count
    if ($tokenishUnitCount -le 0) {
        return $baseEstimate
    }

    $hybridEstimate = [int][Math]::Ceiling(($baseEstimate + $tokenishUnitCount) / 2.0)
    return [int][Math]::Max($baseEstimate, $hybridEstimate)
}

function Invoke-GateMarkdownCompaction {
    param(
        [AllowNull()][string]$Content,
        [bool]$StripExamples = $false,
        [bool]$StripCodeBlocks = $false
    )

    $sourceText = if ($null -eq $Content) { '' } else { $Content.Replace("`r`n", "`n").Replace("`r", "`n") }
    $lines = @($sourceText -split "`n", 0, 'SimpleMatch')
    if ($sourceText.Length -eq 0) {
        $lines = @('')
    }

    $outputLines = New-Object 'System.Collections.Generic.List[string]'
    $exampleHeadingLevel = $null
    $insideRemovedCodeBlock = $false
    $pendingExampleLabel = $false
    $removedCodeBlocks = 0
    $removedExampleSections = 0
    $removedExampleLabels = 0
    $removedExampleContentLines = 0
    $insertedExamplePlaceholder = $false
    $insertedCodeBlockPlaceholder = $false
    $headingPattern = '^(#{1,6})\s+(.+?)\s*$'
    $exampleLabelPattern = '^\s*(?:bad|good)?\s*examples?\s*:\s*$'
    $codeFencePattern = '^\s*```'

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = [string]$lines[$index]
        $headingMatch = [regex]::Match($line, $headingPattern)

        if ($null -ne $exampleHeadingLevel) {
            if ($headingMatch.Success -and $headingMatch.Groups[1].Value.Length -le $exampleHeadingLevel) {
                $exampleHeadingLevel = $null
                $insertedExamplePlaceholder = $false
                $index--
                continue
            }
            $removedExampleContentLines++
            continue
        }

        if ($insideRemovedCodeBlock) {
            if ($line -match $codeFencePattern) {
                $insideRemovedCodeBlock = $false
                $insertedCodeBlockPlaceholder = $false
            }
            continue
        }

        if ($StripExamples -and $headingMatch.Success -and $headingMatch.Groups[2].Value.ToLowerInvariant().Contains('example')) {
            if ($outputLines.Count -gt 0 -and $outputLines[$outputLines.Count - 1] -ne '') {
                $outputLines.Add('')
            }
            $outputLines.Add($line)
            $outputLines.Add('> Example section omitted due to token economy.')
            $removedExampleSections++
            $exampleHeadingLevel = $headingMatch.Groups[1].Value.Length
            $insertedExamplePlaceholder = $true
            continue
        }

        if ($StripExamples -and $line -match $exampleLabelPattern) {
            if (-not $insertedExamplePlaceholder) {
                if ($outputLines.Count -gt 0 -and $outputLines[$outputLines.Count - 1] -ne '') {
                    $outputLines.Add('')
                }
                $outputLines.Add('> Example content omitted due to token economy.')
                $insertedExamplePlaceholder = $true
            }
            $removedExampleLabels++
            $pendingExampleLabel = $true
            continue
        }

        if ($pendingExampleLabel) {
            if ($line -match $codeFencePattern) {
                if (-not $insertedCodeBlockPlaceholder) {
                    if ($outputLines.Count -gt 0 -and $outputLines[$outputLines.Count - 1] -ne '') {
                        $outputLines.Add('')
                    }
                    $outputLines.Add('> Code block omitted due to token economy.')
                    $insertedCodeBlockPlaceholder = $true
                }
                $removedCodeBlocks++
                $insideRemovedCodeBlock = $true
                $pendingExampleLabel = $false
                continue
            }
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }
            if ($headingMatch.Success) {
                $pendingExampleLabel = $false
                $index--
                continue
            }
            $removedExampleContentLines++
            continue
        }

        if ($StripCodeBlocks -and $line -match $codeFencePattern) {
            if (-not $insertedCodeBlockPlaceholder) {
                if ($outputLines.Count -gt 0 -and $outputLines[$outputLines.Count - 1] -ne '') {
                    $outputLines.Add('')
                }
                $outputLines.Add('> Code block omitted due to token economy.')
                $insertedCodeBlockPlaceholder = $true
            }
            $removedCodeBlocks++
            $insideRemovedCodeBlock = $true
            continue
        }

        $outputLines.Add($line)
    }

    $sanitizedText = (@($outputLines) -join "`n").Trim("`n")
    if ($sourceText.EndsWith("`n", [System.StringComparison]::Ordinal)) {
        $sanitizedText += "`n"
    }

    return [ordered]@{
        content = $sanitizedText
        original_line_count = $lines.Count
        output_line_count = if ([string]::IsNullOrEmpty($sanitizedText)) { 0 } else { (@($sanitizedText -split "`n")).Count }
        original_char_count = $sourceText.Length
        output_char_count = $sanitizedText.Length
        removed_code_blocks = $removedCodeBlocks
        removed_example_sections = $removedExampleSections
        removed_example_labels = $removedExampleLabels
        removed_example_content_lines = $removedExampleContentLines
    }
}

function New-GateRuleContextArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [Parameter(Mandatory = $true)]
        [string[]]$SelectedRulePaths,
        [Parameter(Mandatory = $true)]
        [string]$ArtifactPath,
        [bool]$StripExamples = $false,
        [bool]$StripCodeBlocks = $false
    )

    $outputSections = New-Object 'System.Collections.Generic.List[string]'
    $outputSections.Add('# Reviewer Rule Context')
    $outputSections.Add('')
    $outputSections.Add("- strip_examples: $($StripExamples.ToString().ToLowerInvariant())")
    $outputSections.Add("- strip_code_blocks: $($StripCodeBlocks.ToString().ToLowerInvariant())")
    $outputSections.Add('')

    $fileEntries = @()
    $originalLineTotal = 0
    $outputLineTotal = 0
    $originalCharTotal = 0
    $outputCharTotal = 0
    $originalTokenTotal = 0
    $outputTokenTotal = 0
    $legacyOriginalTokenTotal = 0
    $legacyOutputTokenTotal = 0

    foreach ($selectedRulePath in @($SelectedRulePaths)) {
        $resolvedRulePath = Resolve-GatePathInsideRepo -PathValue $selectedRulePath -RepoRootPath $RepoRootPath
        $rawContent = Get-Content -LiteralPath $resolvedRulePath -Raw -Encoding UTF8
        $compacted = Invoke-GateMarkdownCompaction -Content $rawContent -StripExamples:$StripExamples -StripCodeBlocks:$StripCodeBlocks
        $artifactContent = [string]$compacted.content
        if ([string]::IsNullOrWhiteSpace($artifactContent)) {
            $artifactContent = "_No remaining content after token-economy compaction._`n"
        } elseif (-not $artifactContent.EndsWith("`n", [System.StringComparison]::Ordinal)) {
            $artifactContent += "`n"
        }

        $outputSections.Add("## Source: $selectedRulePath")
        $outputSections.Add('')
        foreach ($contentLine in @($artifactContent.TrimEnd("`n") -split "`n")) {
            $outputSections.Add([string]$contentLine)
        }
        $outputSections.Add('')
        $outputSections.Add('---')
        $outputSections.Add('')

        $originalLineTotal += [int]$compacted.original_line_count
        $outputLineTotal += [int]$compacted.output_line_count
        $originalCharTotal += [int]$compacted.original_char_count
        $outputCharTotal += [int]$compacted.output_char_count
        $originalTokenTotal += Estimate-GateTokenCount -Lines $rawContent
        $outputTokenTotal += Estimate-GateTokenCount -Lines $compacted.content
        $legacyOriginalTokenTotal += Estimate-GateTokenCount -Lines $rawContent -Estimator 'chars_per_4'
        $legacyOutputTokenTotal += Estimate-GateTokenCount -Lines $compacted.content -Estimator 'chars_per_4'

        $fileEntries += [ordered]@{
            path = $selectedRulePath
            artifact_source_path = Convert-GatePathToUnix -PathValue $resolvedRulePath
            original_line_count = [int]$compacted.original_line_count
            output_line_count = [int]$compacted.output_line_count
            original_char_count = [int]$compacted.original_char_count
            output_char_count = [int]$compacted.output_char_count
            removed_code_blocks = [int]$compacted.removed_code_blocks
            removed_example_sections = [int]$compacted.removed_example_sections
            removed_example_labels = [int]$compacted.removed_example_labels
            removed_example_content_lines = [int]$compacted.removed_example_content_lines
            content_sha256 = Get-GateStringSha256 -Value ([string]$compacted.content)
        }
    }

    $artifactParent = Split-Path -Parent $ArtifactPath
    if ($artifactParent -and -not (Test-Path -LiteralPath $artifactParent)) {
        New-Item -Path $artifactParent -ItemType Directory -Force | Out-Null
    }
    $artifactText = (@($outputSections) -join "`n").TrimEnd() + "`n"
    Set-Content -LiteralPath $ArtifactPath -Value $artifactText -Encoding UTF8

    return [ordered]@{
        artifact_path = Convert-GatePathToUnix -PathValue $ArtifactPath
        artifact_sha256 = Get-GateStringSha256 -Value $artifactText
        source_file_count = $fileEntries.Count
        source_files = $fileEntries
        summary = [ordered]@{
            original_line_count = $originalLineTotal
            output_line_count = $outputLineTotal
            original_char_count = $originalCharTotal
            output_char_count = $outputCharTotal
            original_token_count_estimate = $originalTokenTotal
            output_token_count_estimate = $outputTokenTotal
            estimated_saved_chars = [Math]::Max($originalCharTotal - $outputCharTotal, 0)
            estimated_saved_tokens = [Math]::Max($originalTokenTotal - $outputTokenTotal, 0)
            estimated_saved_tokens_chars_per_4 = [Math]::Max($legacyOriginalTokenTotal - $legacyOutputTokenTotal, 0)
            token_estimator = 'hybrid_text_v1'
            legacy_token_estimator = 'chars_per_4'
        }
    }
}

function Test-GateReviewArtifactCompaction {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArtifactPath,
        [AllowNull()][string]$Content,
        [AllowNull()][object]$ReviewContext
    )

    $tokenEconomyObject = $null
    $tokenEconomyActive = $false
    $flagsObject = $null
    if ($null -ne $ReviewContext) {
        if ($ReviewContext -is [System.Collections.IDictionary]) {
            if ($ReviewContext.Contains('token_economy')) {
                $tokenEconomyObject = $ReviewContext['token_economy']
            }
            if ($ReviewContext.Contains('token_economy_active')) {
                $tokenEconomyActive = [bool]$ReviewContext['token_economy_active']
            }
        } elseif ($null -ne $ReviewContext.PSObject.Properties['token_economy']) {
            $tokenEconomyObject = $ReviewContext.token_economy
            if ($null -ne $ReviewContext.PSObject.Properties['token_economy_active']) {
                $tokenEconomyActive = [bool]$ReviewContext.token_economy_active
            }
        }
    }

    if (-not $tokenEconomyActive -and $null -ne $tokenEconomyObject) {
        if ($tokenEconomyObject -is [System.Collections.IDictionary]) {
            $tokenEconomyActive = [bool]$tokenEconomyObject['active']
            $flagsObject = $tokenEconomyObject['flags']
        } else {
            if ($null -ne $tokenEconomyObject.PSObject.Properties['active']) {
                $tokenEconomyActive = [bool]$tokenEconomyObject.active
            }
            if ($null -ne $tokenEconomyObject.PSObject.Properties['flags']) {
                $flagsObject = $tokenEconomyObject.flags
            }
        }
    }

    if ($null -eq $flagsObject -and $null -ne $tokenEconomyObject) {
        if ($tokenEconomyObject -is [System.Collections.IDictionary]) {
            $flagsObject = $tokenEconomyObject['flags']
        } elseif ($null -ne $tokenEconomyObject.PSObject.Properties['flags']) {
            $flagsObject = $tokenEconomyObject.flags
        }
    }

    $compactReviewerOutput = $false
    $stripExamples = $false
    $failTailLines = 50
    if ($null -ne $flagsObject) {
        if ($flagsObject -is [System.Collections.IDictionary]) {
            $compactReviewerOutput = [bool]$flagsObject['compact_reviewer_output']
            $stripExamples = [bool]$flagsObject['strip_examples']
            if ($flagsObject.Contains('fail_tail_lines')) { $failTailLines = $flagsObject['fail_tail_lines'] }
        } else {
            if ($null -ne $flagsObject.PSObject.Properties['compact_reviewer_output']) { $compactReviewerOutput = [bool]$flagsObject.compact_reviewer_output }
            if ($null -ne $flagsObject.PSObject.Properties['strip_examples']) { $stripExamples = [bool]$flagsObject.strip_examples }
            if ($null -ne $flagsObject.PSObject.Properties['fail_tail_lines']) { $failTailLines = $flagsObject.fail_tail_lines }
        }
    }

    $compactExpected = $tokenEconomyActive -and $compactReviewerOutput
    $budget = Get-GateCompactReviewBudget -FailTailLines $failTailLines
    $contentText = if ($null -eq $Content) { '' } else { $Content.Replace("`r`n", "`n").Replace("`r", "`n") }
    $lines = if ([string]::IsNullOrEmpty($contentText)) { @() } else { @($contentText -split "`n") }
    $codeFenceLineCount = @($lines | Where-Object { $_ -match '^\s*```' }).Count
    $exampleMarkerCount = @($lines | Where-Object { $_ -match '^\s*(?:#{1,6}\s+.*example.*|(?:bad|good)?\s*examples?\s*:)\s*$' }).Count
    $warnings = @()

    if ($compactExpected) {
        if ($lines.Count -gt [int]$budget.max_lines) {
            $warnings += "Review artifact '$ArtifactPath' exceeds compact line budget ($($lines.Count) > $($budget.max_lines))."
        }
        if ($contentText.Length -gt [int]$budget.max_chars) {
            $warnings += "Review artifact '$ArtifactPath' exceeds compact char budget ($($contentText.Length) > $($budget.max_chars))."
        }
        if ($codeFenceLineCount -gt [int]$budget.max_code_fence_lines) {
            $warnings += "Review artifact '$ArtifactPath' exceeds code-fence budget ($codeFenceLineCount > $($budget.max_code_fence_lines))."
        }
        if ($stripExamples -and $exampleMarkerCount -gt [int]$budget.max_example_markers) {
            $warnings += "Review artifact '$ArtifactPath' still contains example markers while strip_examples=true."
        }
    }

    $reviewContextPath = $null
    if ($null -ne $ReviewContext) {
        if ($ReviewContext -is [System.Collections.IDictionary]) {
            if ($ReviewContext.Contains('output_path')) {
                $reviewContextPath = Convert-GatePathToUnix -PathValue $ReviewContext['output_path']
            }
        } elseif ($null -ne $ReviewContext.PSObject.Properties['output_path']) {
            $reviewContextPath = Convert-GatePathToUnix -PathValue $ReviewContext.output_path
        }
    }

    return [ordered]@{
        expected = [bool]$compactExpected
        token_economy_active = [bool]$tokenEconomyActive
        review_context_path = $reviewContextPath
        line_count = $lines.Count
        char_count = $contentText.Length
        code_fence_line_count = $codeFenceLineCount
        example_marker_count = $exampleMarkerCount
        budget = $budget
        warnings = $warnings
        warning_count = $warnings.Count
    }
}

function Assert-GateTaskId {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'TaskId must not be empty.'
    }

    if ($Value.Length -gt 128) {
        throw 'TaskId must be 128 characters or fewer.'
    }

    if ($Value -notmatch '^[A-Za-z0-9._-]+$') {
        throw "TaskId '$Value' contains invalid characters. Allowed pattern: ^[A-Za-z0-9._-]+$"
    }
}

function Resolve-GatePathInsideRepo {
    param(
        [string]$PathValue,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [switch]$AllowMissing,
        [switch]$AllowEmpty
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        if ($AllowEmpty) {
            return $null
        }
        throw 'Path value must not be empty.'
    }

    $workspaceRoot = [System.IO.Path]::GetFullPath($RepoRootPath)
    $orchestratorRoot = Get-GateOrchestratorRoot -RepoRootPath $workspaceRoot
    $candidatePaths = New-Object 'System.Collections.Generic.List[string]'

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        [void]$candidatePaths.Add([System.IO.Path]::GetFullPath($PathValue))
    } else {
        $normalized = Convert-GatePathToUnix -PathValue $PathValue -TrimValue -StripLeadingRelative
        $directCandidate = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot ($normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar))))
        [void]$candidatePaths.Add($directCandidate)

        $prefix = 'Octopus-agent-orchestrator/'
        if (-not [string]::IsNullOrWhiteSpace($normalized) -and $normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $trimmed = $normalized.Substring($prefix.Length)
            $orchestratorCandidate = Join-GateOrchestratorPath -RepoRootPath $workspaceRoot -RelativePath $trimmed
            if ($candidatePaths -notcontains $orchestratorCandidate) {
                [void]$candidatePaths.Add($orchestratorCandidate)
            }
        } elseif (-not [string]::Equals($workspaceRoot.TrimEnd('\', '/'), $orchestratorRoot.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
            $orchestratorCandidate = Join-GateOrchestratorPath -RepoRootPath $workspaceRoot -RelativePath $normalized
            if ($candidatePaths -notcontains $orchestratorCandidate) {
                [void]$candidatePaths.Add($orchestratorCandidate)
            }
        }
    }

    $fullPath = $candidatePaths[0]
    foreach ($candidatePath in $candidatePaths) {
        if (Test-Path -LiteralPath $candidatePath) {
            $fullPath = $candidatePath
            break
        }
    }
    $fullPathTrimmed = $fullPath.TrimEnd('\', '/')
    $repoNormalized = $workspaceRoot.TrimEnd('\', '/')
    $repoBoundary = $repoNormalized + [System.IO.Path]::DirectorySeparatorChar
    if (-not (
            [string]::Equals($fullPathTrimmed, $repoNormalized, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullPath.StartsWith($repoBoundary, [System.StringComparison]::OrdinalIgnoreCase)
        )) {
        throw "Path '$PathValue' must resolve inside repository root '$RepoRootPath'."
    }

    if (-not $AllowMissing -and -not (Test-Path -LiteralPath $fullPath)) {
        throw "Path not found: $fullPath"
    }

    if (Test-Path -LiteralPath $fullPath) {
        return (Resolve-Path -LiteralPath $fullPath).Path
    }

    return $fullPath
}

function Convert-GateToStringArray {
    param(
        [object]$Value,
        [switch]$TrimValues
    )

    if ($null -eq $Value) {
        return @()
    }

    $result = @()
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($entry in $Value) {
            if ($null -eq $entry) {
                continue
            }

            $stringValue = [string]$entry
            if ($TrimValues) {
                $stringValue = $stringValue.Trim()
            }

            if ([string]::IsNullOrWhiteSpace($stringValue)) {
                continue
            }

            $result += $stringValue
        }
        return $result
    }

    $singleValue = [string]$Value
    if ($TrimValues) {
        $singleValue = $singleValue.Trim()
    }

    if ([string]::IsNullOrWhiteSpace($singleValue)) {
        return @()
    }

    return @($singleValue)
}

function Test-GateMatchAnyRegex {
    param(
        [string]$PathValue,
        [string[]]$Regexes,
        [switch]$SkipInvalidRegex,
        [string]$InvalidRegexContext = ''
    )

    foreach ($regex in @($Regexes)) {
        if ([string]::IsNullOrWhiteSpace($regex)) {
            continue
        }

        if (-not $SkipInvalidRegex) {
            if ($PathValue -match $regex) {
                return $true
            }
            continue
        }

        try {
            if ([regex]::IsMatch($PathValue, $regex)) {
                return $true
            }
        } catch {
            if ([string]::IsNullOrWhiteSpace($InvalidRegexContext)) {
                Write-Warning "Invalid regex '$regex': $($_.Exception.Message)"
            } else {
                Write-Warning "Invalid regex '$regex' for ${InvalidRegexContext}: $($_.Exception.Message)"
            }
        }
    }

    return $false
}

function Add-GateMetricsEvent {
    param(
        [string]$Path,
        [object]$EventObject,
        [bool]$EmitMetrics = $true
    )

    if (-not $EmitMetrics) {
        return
    }

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    try {
        $metricsDir = Split-Path -Parent $Path
        if ($metricsDir -and -not (Test-Path -LiteralPath $metricsDir)) {
            New-Item -Path $metricsDir -ItemType Directory -Force | Out-Null
        }

        $line = $EventObject | ConvertTo-Json -Depth 12 -Compress
        Add-Content -LiteralPath $Path -Value $line
    } catch {
        Write-Warning "Metrics append failed: $($_.Exception.Message)"
    }
}

function Get-GateTextCharCount {
    param(
        [object]$Lines
    )

    $normalizedLines = @(Convert-GateToStringArray -Value $Lines)
    if ($normalizedLines.Count -eq 0) {
        return 0
    }

    $charCount = 0
    foreach ($line in $normalizedLines) {
        $charCount += $line.Length
    }

    if ($normalizedLines.Count -gt 1) {
        $charCount += ($normalizedLines.Count - 1)
    }

    return [int]$charCount
}

function Get-GateOutputTelemetry {
    param(
        [object]$RawLines,
        [object]$FilteredLines,
        [string]$FilterMode = 'passthrough',
        [string]$FallbackMode = 'none',
        [string]$ParserMode = 'NONE',
        [string]$ParserName = '',
        [string]$ParserStrategy = '',
        [string]$TokenEstimator = 'hybrid_text_v1'
    )

    $rawLineArray = @(Convert-GateToStringArray -Value $RawLines)
    $filteredLineArray = @(Convert-GateToStringArray -Value $FilteredLines)
    $rawCharCount = Get-GateTextCharCount -Lines $rawLineArray
    $filteredCharCount = Get-GateTextCharCount -Lines $filteredLineArray
    $estimatedSavedChars = [Math]::Max(0, $rawCharCount - $filteredCharCount)
    $rawTokenCountEstimate = Estimate-GateTokenCount -Lines $rawLineArray -Estimator $TokenEstimator
    $filteredTokenCountEstimate = Estimate-GateTokenCount -Lines $filteredLineArray -Estimator $TokenEstimator
    $estimatedSavedTokens = [Math]::Max($rawTokenCountEstimate - $filteredTokenCountEstimate, 0)
    $legacyRawTokenCountEstimate = Estimate-GateTokenCount -Lines $rawLineArray -Estimator 'chars_per_4'
    $legacyFilteredTokenCountEstimate = Estimate-GateTokenCount -Lines $filteredLineArray -Estimator 'chars_per_4'
    $legacyEstimatedSavedTokens = [Math]::Max($legacyRawTokenCountEstimate - $legacyFilteredTokenCountEstimate, 0)

    return [ordered]@{
        raw_line_count = [int]$rawLineArray.Count
        raw_char_count = [int]$rawCharCount
        raw_token_count_estimate = [int]$rawTokenCountEstimate
        filtered_line_count = [int]$filteredLineArray.Count
        filtered_char_count = [int]$filteredCharCount
        filtered_token_count_estimate = [int]$filteredTokenCountEstimate
        estimated_saved_chars = [int]$estimatedSavedChars
        estimated_saved_tokens = [int]$estimatedSavedTokens
        estimated_saved_tokens_chars_per_4 = [int]$legacyEstimatedSavedTokens
        token_estimator = $TokenEstimator
        legacy_token_estimator = 'chars_per_4'
        filter_mode = $(if ([string]::IsNullOrWhiteSpace($FilterMode)) { 'passthrough' } else { $FilterMode })
        fallback_mode = $(if ([string]::IsNullOrWhiteSpace($FallbackMode)) { 'none' } else { $FallbackMode })
        parser_mode = $(if ([string]::IsNullOrWhiteSpace($ParserMode)) { 'NONE' } else { $ParserMode.Trim().ToUpperInvariant() })
        parser_name = $(if ([string]::IsNullOrWhiteSpace($ParserName)) { $null } else { $ParserName.Trim() })
        parser_strategy = $(if ([string]::IsNullOrWhiteSpace($ParserStrategy)) { $null } else { $ParserStrategy.Trim() })
    }
}

function Get-GateFilterConfigValue {
    param(
        [AllowNull()]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Key)) {
            return $Object[$Key]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$Key]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Resolve-GateFilterIntegerSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [hashtable]$ContextData = @{},
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [int]$Minimum = 0
    )

    $resolvedValue = $Value
    $contextKey = Get-GateFilterConfigValue -Object $Value -Key 'context_key'
    if (-not [string]::IsNullOrWhiteSpace([string]$contextKey)) {
        if (-not $ContextData.ContainsKey([string]$contextKey)) {
            throw "$FieldName references missing context key '$contextKey'."
        }
        $resolvedValue = $ContextData[[string]$contextKey]
    }

    $resolvedInt = $null
    if ($resolvedValue -is [int] -or $resolvedValue -is [long] -or $resolvedValue -is [short] -or $resolvedValue -is [byte]) {
        $resolvedInt = [int]$resolvedValue
    } elseif ($resolvedValue -is [double] -or $resolvedValue -is [decimal] -or $resolvedValue -is [single]) {
        $numericValue = [double]$resolvedValue
        if ($numericValue -eq [Math]::Floor($numericValue)) {
            $resolvedInt = [int]$numericValue
        }
    } elseif ($resolvedValue -is [string]) {
        $parsedInt = 0
        if ([int]::TryParse($resolvedValue.Trim(), [ref]$parsedInt)) {
            $resolvedInt = $parsedInt
        }
    }

    if ($null -eq $resolvedInt -or $resolvedInt -lt $Minimum) {
        throw "$FieldName must resolve to integer >= $Minimum."
    }

    return [int]$resolvedInt
}

function Resolve-GateFilterStringSpec {
    param(
        [AllowNull()]
        [object]$Value,
        [hashtable]$ContextData = @{},
        [Parameter(Mandatory = $true)]
        [string]$FieldName,
        [switch]$AllowEmpty
    )

    $resolvedValue = $Value
    $contextKey = Get-GateFilterConfigValue -Object $Value -Key 'context_key'
    if (-not [string]::IsNullOrWhiteSpace([string]$contextKey)) {
        if (-not $ContextData.ContainsKey([string]$contextKey)) {
            throw "$FieldName references missing context key '$contextKey'."
        }
        $resolvedValue = $ContextData[[string]$contextKey]
    }

    if ($null -eq $resolvedValue) {
        if ($AllowEmpty) {
            return ''
        }
        throw "$FieldName must resolve to non-empty string."
    }

    $text = [string]$resolvedValue
    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($text)) {
        throw "$FieldName must resolve to non-empty string."
    }

    return $text.Trim()
}

function Get-GateFilterPatterns {
    param(
        [AllowNull()]
        [object]$Operation
    )

    $patternsValue = Get-GateFilterConfigValue -Object $Operation -Key 'patterns'
    if ($null -eq $patternsValue) {
        $patternsValue = Get-GateFilterConfigValue -Object $Operation -Key 'pattern'
    }

    $patterns = @(Convert-GateToStringArray -Value $patternsValue -TrimValues)
    if ($patterns.Count -eq 0) {
        throw 'Filter operation requires non-empty `pattern` or `patterns`.'
    }

    foreach ($pattern in $patterns) {
        [void][regex]::new($pattern)
    }

    return @($patterns)
}

function Add-GateUniqueLines {
    param(
        [System.Collections.Generic.List[string]]$Destination,
        [System.Collections.Generic.HashSet[string]]$Seen,
        [string[]]$Lines,
        [int]$Limit = 0
    )

    foreach ($lineValue in @($Lines)) {
        $lineText = [string]$lineValue
        if ([string]::IsNullOrWhiteSpace($lineText)) {
            continue
        }

        if (-not $Seen.Add($lineText)) {
            continue
        }

        $Destination.Add($lineText) | Out-Null
        if ($Limit -gt 0 -and $Destination.Count -ge $Limit) {
            break
        }
    }
}

function Select-GateMatchingLines {
    param(
        [string[]]$Lines,
        [string[]]$Patterns,
        [int]$Limit = 0
    )

    $matches = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in @($Lines)) {
        if (Test-GateMatchAnyRegex -PathValue ([string]$line) -Regexes $Patterns) {
            $matches.Add([string]$line) | Out-Null
            if ($Limit -gt 0 -and $matches.Count -ge $Limit) {
                break
            }
        }
    }

    return @($matches.ToArray())
}

function Get-GateCompileFailureStrategyConfig {
    param([string]$Strategy)

    switch (($Strategy ?? '').Trim().ToLowerInvariant()) {
        'maven' {
            return [ordered]@{
                display_name = 'maven'
                full_patterns = @(
                    '^\[ERROR\]',
                    'BUILD FAILURE',
                    'COMPILATION ERROR',
                    'Failed to execute goal',
                    'There are test failures',
                    'Tests run: .*Failures:',
                    'Re-run Maven'
                )
                degraded_patterns = @(
                    '^\[ERROR\]',
                    '^\[WARNING\]',
                    'BUILD FAILURE',
                    'error'
                )
            }
        }
        'gradle' {
            return [ordered]@{
                display_name = 'gradle'
                full_patterns = @(
                    '^FAILURE: Build failed with an exception\.',
                    '^BUILD FAILED',
                    'Execution failed for task',
                    '^\* What went wrong:',
                    '^> .*',
                    '^> Task .*FAILED'
                )
                degraded_patterns = @(
                    '^FAILURE:',
                    '^BUILD FAILED',
                    'FAILED',
                    'error'
                )
            }
        }
        'node' {
            return [ordered]@{
                display_name = 'node-build'
                full_patterns = @(
                    '^npm ERR!',
                    '^ERR!',
                    'Command failed with exit code',
                    'Failed to compile',
                    'ERROR in',
                    'Type error',
                    'Module not found'
                )
                degraded_patterns = @(
                    '^npm ERR!',
                    'warning',
                    'error',
                    'failed'
                )
            }
        }
        'cargo' {
            return [ordered]@{
                display_name = 'cargo'
                full_patterns = @(
                    '^error(\[[A-Z0-9]+\])?:',
                    '^Caused by:',
                    'could not compile',
                    '^failures:',
                    '^test result: FAILED'
                )
                degraded_patterns = @(
                    '^warning:',
                    '^error',
                    'FAILED'
                )
            }
        }
        'dotnet' {
            return [ordered]@{
                display_name = 'dotnet'
                full_patterns = @(
                    '^Build FAILED\.',
                    '^\s*error [A-Z]{2,}\d+:',
                    '^\s*warning [A-Z]{2,}\d+:',
                    '^Failed!  - Failed:',
                    '^Test Run Failed\.'
                )
                degraded_patterns = @(
                    '^\s*error ',
                    '^\s*warning ',
                    'FAILED'
                )
            }
        }
        'go' {
            return [ordered]@{
                display_name = 'go'
                full_patterns = @(
                    '^# ',
                    '^--- FAIL:',
                    '^FAIL(\s|$)',
                    '^panic:',
                    'cannot use',
                    'undefined:'
                )
                degraded_patterns = @(
                    '^FAIL',
                    '^panic:',
                    'error'
                )
            }
        }
        default {
            return [ordered]@{
                display_name = 'generic-compile'
                full_patterns = @(
                    'error',
                    'failed',
                    'exception',
                    'cannot ',
                    'undefined',
                    'not found'
                )
                degraded_patterns = @(
                    'warning',
                    'error',
                    'failed'
                )
            }
        }
    }
}

function Invoke-GateCompileFailureParser {
    param(
        [string[]]$Lines,
        [object]$Parser,
        [hashtable]$ContextData = @{}
    )

    $strategy = Resolve-GateFilterStringSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'strategy') -ContextData $ContextData -FieldName 'parser.strategy' -AllowEmpty
    if ([string]::IsNullOrWhiteSpace($strategy)) {
        $strategy = Resolve-GateFilterStringSpec -Value @{ context_key = 'command_filter_strategy' } -ContextData $ContextData -FieldName 'parser.strategy_context' -AllowEmpty
    }
    if ([string]::IsNullOrWhiteSpace($strategy)) {
        $strategy = 'generic'
    }

    $config = Get-GateCompileFailureStrategyConfig -Strategy $strategy
    $maxMatches = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'max_matches') -ContextData $ContextData -FieldName 'parser.max_matches' -Minimum 1
    $tailCount = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'tail_count') -ContextData $ContextData -FieldName 'parser.tail_count' -Minimum 0

    $fullMatches = Select-GateMatchingLines -Lines $Lines -Patterns $config.full_patterns -Limit $maxMatches
    if ($fullMatches.Count -gt 0) {
        $summaryLines = New-Object 'System.Collections.Generic.List[string]'
        $seenLines = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @("CompactSummary: FULL | strategy=$($config.display_name)")
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines $fullMatches -Limit ($maxMatches + 1)
        if ($tailCount -gt 0) {
            Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @(Select-GateTailLines -Lines $Lines -Count $tailCount)
        }

        return [ordered]@{
            lines = @($summaryLines.ToArray())
            parser_mode = 'FULL'
            parser_name = 'compile_failure_summary'
            parser_strategy = $config.display_name
            fallback_mode = 'none'
        }
    }

    $degradedMatches = Select-GateMatchingLines -Lines $Lines -Patterns $config.degraded_patterns -Limit ([Math]::Max($maxMatches, 8))
    if ($degradedMatches.Count -gt 0) {
        $summaryLines = New-Object 'System.Collections.Generic.List[string]'
        $seenLines = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @("CompactSummary: DEGRADED | strategy=$($config.display_name)")
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines $degradedMatches -Limit ([Math]::Max($maxMatches, 8) + 1)
        if ($tailCount -gt 0) {
            Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @(Select-GateTailLines -Lines $Lines -Count $tailCount)
        }

        return [ordered]@{
            lines = @($summaryLines.ToArray())
            parser_mode = 'DEGRADED'
            parser_name = 'compile_failure_summary'
            parser_strategy = $config.display_name
            fallback_mode = 'none'
        }
    }

    return [ordered]@{
        lines = @($Lines)
        parser_mode = 'PASSTHROUGH'
        parser_name = 'compile_failure_summary'
        parser_strategy = $config.display_name
        fallback_mode = 'parser_passthrough'
    }
}

function Invoke-GateTestFailureParser {
    param(
        [string[]]$Lines,
        [object]$Parser,
        [hashtable]$ContextData = @{}
    )

    $maxMatches = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'max_matches') -ContextData $ContextData -FieldName 'parser.max_matches' -Minimum 1
    $tailCount = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'tail_count') -ContextData $ContextData -FieldName 'parser.tail_count' -Minimum 0
    $patterns = @(
        '^--- FAIL:',
        '^FAIL(\s|$)',
        '^FAILED',
        '^failures?:',
        '^panic:',
        '^AssertionError',
        '^Error:',
        '[0-9]+\s+failed',
        'Test Run Failed',
        '[✕×]'
    )

    $matches = Select-GateMatchingLines -Lines $Lines -Patterns $patterns -Limit $maxMatches
    if ($matches.Count -gt 0) {
        $summaryLines = New-Object 'System.Collections.Generic.List[string]'
        $seenLines = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @('CompactSummary: FULL | strategy=test')
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines $matches -Limit ($maxMatches + 1)
        if ($tailCount -gt 0) {
            Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @(Select-GateTailLines -Lines $Lines -Count $tailCount)
        }

        return [ordered]@{
            lines = @($summaryLines.ToArray())
            parser_mode = 'FULL'
            parser_name = 'test_failure_summary'
            parser_strategy = 'test'
            fallback_mode = 'none'
        }
    }

    return [ordered]@{
        lines = @($Lines)
        parser_mode = 'PASSTHROUGH'
        parser_name = 'test_failure_summary'
        parser_strategy = 'test'
        fallback_mode = 'parser_passthrough'
    }
}

function Invoke-GateLintFailureParser {
    param(
        [string[]]$Lines,
        [object]$Parser,
        [hashtable]$ContextData = @{}
    )

    $maxMatches = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'max_matches') -ContextData $ContextData -FieldName 'parser.max_matches' -Minimum 1
    $tailCount = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'tail_count') -ContextData $ContextData -FieldName 'parser.tail_count' -Minimum 0
    $patterns = @(
        '^\s*error',
        '^\s*warning',
        ':[0-9]+(:[0-9]+)?\s+(error|warning)',
        '^Found\s+[0-9]+\s+errors?',
        '^[✖×]',
        'problems?'
    )

    $matches = Select-GateMatchingLines -Lines $Lines -Patterns $patterns -Limit $maxMatches
    if ($matches.Count -gt 0) {
        $summaryLines = New-Object 'System.Collections.Generic.List[string]'
        $seenLines = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @('CompactSummary: FULL | strategy=lint')
        Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines $matches -Limit ($maxMatches + 1)
        if ($tailCount -gt 0) {
            Add-GateUniqueLines -Destination $summaryLines -Seen $seenLines -Lines @(Select-GateTailLines -Lines $Lines -Count $tailCount)
        }

        return [ordered]@{
            lines = @($summaryLines.ToArray())
            parser_mode = 'FULL'
            parser_name = 'lint_failure_summary'
            parser_strategy = 'lint'
            fallback_mode = 'none'
        }
    }

    return [ordered]@{
        lines = @($Lines)
        parser_mode = 'PASSTHROUGH'
        parser_name = 'lint_failure_summary'
        parser_strategy = 'lint'
        fallback_mode = 'parser_passthrough'
    }
}

function Invoke-GateReviewSummaryParser {
    param(
        [string[]]$Lines,
        [object]$Parser,
        [hashtable]$ContextData = @{}
    )

    $maxLines = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'max_lines') -ContextData $ContextData -FieldName 'parser.max_lines' -Minimum 1
    $summaryLines = @(Select-GateHeadLines -Lines $Lines -Count $maxLines)
    if ($summaryLines.Count -eq 0) {
        return [ordered]@{
            lines = @($Lines)
            parser_mode = 'PASSTHROUGH'
            parser_name = 'review_gate_summary'
            parser_strategy = 'review'
            fallback_mode = 'parser_passthrough'
        }
    }

    return [ordered]@{
        lines = $summaryLines
        parser_mode = 'FULL'
        parser_name = 'review_gate_summary'
        parser_strategy = 'review'
        fallback_mode = 'none'
    }
}

function Invoke-GateOutputParser {
    param(
        [string[]]$Lines,
        [AllowNull()]
        [object]$Parser,
        [hashtable]$ContextData = @{}
    )

    if ($null -eq $Parser) {
        return [ordered]@{
            lines = @($Lines)
            parser_mode = 'NONE'
            parser_name = $null
            parser_strategy = $null
            fallback_mode = 'none'
        }
    }

    if ($Parser -isnot [System.Collections.IDictionary] -and $Parser.PSObject.Properties.Count -eq 0) {
        throw 'Profile parser must be an object.'
    }

    $parserType = Resolve-GateFilterStringSpec -Value (Get-GateFilterConfigValue -Object $Parser -Key 'type') -ContextData $ContextData -FieldName 'parser.type'
    switch ($parserType.Trim().ToLowerInvariant()) {
        'compile_failure_summary' {
            return Invoke-GateCompileFailureParser -Lines $Lines -Parser $Parser -ContextData $ContextData
        }
        'test_failure_summary' {
            return Invoke-GateTestFailureParser -Lines $Lines -Parser $Parser -ContextData $ContextData
        }
        'lint_failure_summary' {
            return Invoke-GateLintFailureParser -Lines $Lines -Parser $Parser -ContextData $ContextData
        }
        'review_gate_summary' {
            return Invoke-GateReviewSummaryParser -Lines $Lines -Parser $Parser -ContextData $ContextData
        }
        default {
            throw "Unsupported profile parser type '$parserType'."
        }
    }
}

function Select-GateHeadLines {
    param(
        [string[]]$Lines,
        [int]$Count
    )

    $allLines = @($Lines)
    if ($Count -le 0 -or $allLines.Count -eq 0) {
        return @()
    }

    if ($allLines.Count -le $Count) {
        return $allLines
    }

    return $allLines[0..($Count - 1)]
}

function Select-GateTailLines {
    param(
        [string[]]$Lines,
        [int]$Count
    )

    $allLines = @($Lines)
    if ($Count -le 0 -or $allLines.Count -eq 0) {
        return @()
    }

    if ($allLines.Count -le $Count) {
        return $allLines
    }

    $startIndex = $allLines.Count - $Count
    return $allLines[$startIndex..($allLines.Count - 1)]
}

function Invoke-GateOutputFilterOperation {
    param(
        [string[]]$Lines,
        [Parameter(Mandatory = $true)]
        [object]$Operation,
        [hashtable]$ContextData = @{}
    )

    if ($Operation -isnot [System.Collections.IDictionary] -and $Operation.PSObject.Properties.Count -eq 0) {
        throw 'Filter operation must be an object.'
    }

    $typeValue = [string](Get-GateFilterConfigValue -Object $Operation -Key 'type')
    if ([string]::IsNullOrWhiteSpace($typeValue)) {
        throw 'Filter operation requires non-empty `type`.'
    }

    $operationType = $typeValue.Trim().ToLowerInvariant()
    $currentLines = @($Lines)
    switch ($operationType) {
        'strip_ansi' {
            $ansiPattern = '\x1B\[[0-9;?]*[ -/]*[@-~]'
            return @($currentLines | ForEach-Object { [regex]::Replace(([string]$_), $ansiPattern, '') })
        }
        'regex_replace' {
            $pattern = [string](Get-GateFilterConfigValue -Object $Operation -Key 'pattern')
            if ([string]::IsNullOrWhiteSpace($pattern)) {
                throw 'regex_replace requires non-empty `pattern`.'
            }
            [void][regex]::new($pattern)
            $replacement = [string](Get-GateFilterConfigValue -Object $Operation -Key 'replacement')
            return @($currentLines | ForEach-Object { [regex]::Replace(([string]$_), $pattern, $replacement) })
        }
        'drop_lines_matching' {
            $patterns = Get-GateFilterPatterns -Operation $Operation
            return @($currentLines | Where-Object { -not (Test-GateMatchAnyRegex -PathValue ([string]$_) -Regexes $patterns) })
        }
        'keep_lines_matching' {
            $patterns = Get-GateFilterPatterns -Operation $Operation
            return @($currentLines | Where-Object { Test-GateMatchAnyRegex -PathValue ([string]$_) -Regexes $patterns })
        }
        'truncate_line_length' {
            $maxChars = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'max_chars') -ContextData $ContextData -FieldName 'truncate_line_length.max_chars' -Minimum 1
            $suffix = [string](Get-GateFilterConfigValue -Object $Operation -Key 'suffix')
            if ($null -eq $suffix) {
                $suffix = '...'
            }

            return @($currentLines | ForEach-Object {
                    $line = [string]$_
                    if ($line.Length -le $maxChars) {
                        return $line
                    }

                    if ($suffix.Length -ge $maxChars) {
                        return $suffix.Substring(0, $maxChars)
                    }

                    return $line.Substring(0, $maxChars - $suffix.Length) + $suffix
                })
        }
        'head' {
            $count = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'count') -ContextData $ContextData -FieldName 'head.count' -Minimum 1
            return @(Select-GateHeadLines -Lines $currentLines -Count $count)
        }
        'tail' {
            $count = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'count') -ContextData $ContextData -FieldName 'tail.count' -Minimum 1
            return @(Select-GateTailLines -Lines $currentLines -Count $count)
        }
        'max_total_lines' {
            $maxLines = Resolve-GateFilterIntegerSpec -Value (Get-GateFilterConfigValue -Object $Operation -Key 'max_lines') -ContextData $ContextData -FieldName 'max_total_lines.max_lines' -Minimum 0
            $strategy = [string](Get-GateFilterConfigValue -Object $Operation -Key 'strategy')
            if ([string]::IsNullOrWhiteSpace($strategy)) {
                $strategy = 'tail'
            }
            $strategy = $strategy.Trim().ToLowerInvariant()
            if ($maxLines -eq 0) {
                return @()
            }

            if ($strategy -eq 'head') {
                return @(Select-GateHeadLines -Lines $currentLines -Count $maxLines)
            }
            if ($strategy -eq 'tail') {
                return @(Select-GateTailLines -Lines $currentLines -Count $maxLines)
            }

            throw "max_total_lines.strategy must be 'head' or 'tail'."
        }
        default {
            throw "Unsupported filter operation type '$operationType'."
        }
    }
}

function Invoke-GatePassthroughCeiling {
    param(
        [string[]]$Lines,
        [AllowNull()][object]$Config,
        [string]$FallbackMode
    )

    $defaultMax = 60
    $maxLines = $defaultMax
    $strategy = 'tail'

    if ($null -ne $Config -and $Config -is [System.Collections.IDictionary]) {
        $ceilingCfg = Get-GateFilterConfigValue -Object $Config -Key 'passthrough_ceiling'
        if ($ceilingCfg -is [System.Collections.IDictionary]) {
            $cfgMax = Get-GateFilterConfigValue -Object $ceilingCfg -Key 'max_lines'
            $cfgStrategy = Get-GateFilterConfigValue -Object $ceilingCfg -Key 'strategy'
            if (($cfgMax -is [int] -or $cfgMax -is [long]) -and [int]$cfgMax -gt 0) {
                $maxLines = [int]$cfgMax
            }
            if ([string]$cfgStrategy -eq 'head') { $strategy = 'head' }
        }
    }

    $allLines = @($Lines)
    $total = $allLines.Count
    if ($total -le $maxLines) {
        return $allLines
    }

    $capped = if ($strategy -eq 'head') {
        @(Select-GateHeadLines -Lines $allLines -Count $maxLines)
    } else {
        @(Select-GateTailLines -Lines $allLines -Count $maxLines)
    }
    $header = "[passthrough-ceiling] fallback=$FallbackMode total=$total ceiling=$maxLines strategy=$strategy"
    return @($header) + $capped
}

function Invoke-GateOutputFilter {
    param(
        [object]$Lines,
        [string]$ConfigPath,
        [string]$ProfileName,
        [hashtable]$ContextData = @{}
    )

    $originalLines = @(Convert-GateToStringArray -Value $Lines)
    $passthroughResult = [ordered]@{
        lines = $originalLines
        filter_mode = 'passthrough'
        fallback_mode = 'none'
        parser_mode = 'NONE'
        parser_name = $null
        parser_strategy = $null
    }

    if ([string]::IsNullOrWhiteSpace($ProfileName)) {
        return $passthroughResult
    }

    if ([string]::IsNullOrWhiteSpace($ConfigPath) -or -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        Write-Warning "Output filter config missing for profile '$ProfileName': $ConfigPath"
        $passthroughResult['fallback_mode'] = 'missing_config_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $null -FallbackMode 'missing_config_passthrough')
        return $passthroughResult
    }

    $config = $null
    try {
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    } catch {
        Write-Warning "Output filter config is invalid JSON for profile '$ProfileName': $($_.Exception.Message)"
        $passthroughResult['fallback_mode'] = 'invalid_config_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $null -FallbackMode 'invalid_config_passthrough')
        return $passthroughResult
    }

    $profiles = Get-GateFilterConfigValue -Object $config -Key 'profiles'
    if ($profiles -isnot [System.Collections.IDictionary]) {
        Write-Warning "Output filter config must contain object 'profiles'."
        $passthroughResult['fallback_mode'] = 'invalid_config_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $config -FallbackMode 'invalid_config_passthrough')
        return $passthroughResult
    }

    if (-not $profiles.Contains($ProfileName)) {
        Write-Warning "Output filter profile '$ProfileName' not found in $ConfigPath."
        $passthroughResult['fallback_mode'] = 'missing_profile_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $config -FallbackMode 'missing_profile_passthrough')
        return $passthroughResult
    }

    $profile = $profiles[$ProfileName]
    if ($profile -isnot [System.Collections.IDictionary]) {
        Write-Warning "Output filter profile '$ProfileName' must be an object."
        $passthroughResult['fallback_mode'] = 'invalid_profile_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $config -FallbackMode 'invalid_profile_passthrough')
        return $passthroughResult
    }

    try {
        $filteredLines = @($originalLines)
        $operations = Get-GateFilterConfigValue -Object $profile -Key 'operations'
        if ($null -eq $operations) {
            $operations = @()
        } elseif ($operations -is [string]) {
            throw "Profile '$ProfileName' field 'operations' must be an array."
        }

        foreach ($operation in @($operations)) {
            $filteredLines = @($(Invoke-GateOutputFilterOperation -Lines $filteredLines -Operation $operation -ContextData $ContextData))
        }

        $parserResult = Invoke-GateOutputParser -Lines @($filteredLines) -Parser (Get-GateFilterConfigValue -Object $profile -Key 'parser') -ContextData $ContextData
        $filteredLines = @($parserResult.lines)
        if ($parserResult.parser_mode -eq 'PASSTHROUGH') {
            $filteredLines = @(Invoke-GatePassthroughCeiling -Lines $filteredLines -Config $config -FallbackMode 'parser_passthrough')
        }
        $emitWhenEmpty = Get-GateFilterConfigValue -Object $profile -Key 'emit_when_empty'
        if ($filteredLines.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$emitWhenEmpty)) {
            $filteredLines = @([string]$emitWhenEmpty)
        }

        return [ordered]@{
            lines = @($filteredLines)
            filter_mode = "profile:$ProfileName"
            fallback_mode = $parserResult.fallback_mode
            parser_mode = $parserResult.parser_mode
            parser_name = $parserResult.parser_name
            parser_strategy = $parserResult.parser_strategy
        }
    } catch {
        Write-Warning "Output filter profile '$ProfileName' is invalid: $($_.Exception.Message)"
        $passthroughResult['fallback_mode'] = 'invalid_profile_passthrough'
        $passthroughResult['lines'] = @(Invoke-GatePassthroughCeiling -Lines $originalLines -Config $config -FallbackMode 'invalid_profile_passthrough')
        return $passthroughResult
    }
}

function Add-GateTaskEvent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath,
        [string]$TaskId,
        [Parameter(Mandatory = $true)]
        [string]$EventType,
        [string]$Outcome = 'INFO',
        [string]$Message = '',
        [object]$Details = $null,
        [string]$Actor = 'gate',
        [switch]$PassThru
    )

    if ([string]::IsNullOrWhiteSpace($TaskId)) {
        return
    }

    Assert-GateTaskId -Value $TaskId

    try {
        $eventsDir = Join-GateOrchestratorPath -RepoRootPath $RepoRootPath -RelativePath 'runtime/task-events'
        if (-not (Test-Path -LiteralPath $eventsDir)) {
            New-Item -Path $eventsDir -ItemType Directory -Force | Out-Null
        }

        $taskFilePath = Join-Path $eventsDir "$TaskId.jsonl"
        $allTasksPath = Join-Path $eventsDir 'all-tasks.jsonl'
        $taskLockPath = "$taskFilePath.lock"
        $allTasksLockPath = "$allTasksPath.lock"
        $result = [ordered]@{
            task_event_log_path = (Convert-GatePathToUnix -PathValue $taskFilePath)
            all_tasks_log_path = (Convert-GatePathToUnix -PathValue $allTasksPath)
            integrity = $null
            warnings = @()
        }

        $line = $null
        Acquire-GateAppendLock -LockPath $taskLockPath
        try {
            $appendState = Get-GateTaskEventAppendState -TaskFilePath $taskFilePath -TaskId $TaskId
            $nextSequence = if ($null -ne $appendState.last_integrity_sequence) {
                [int]$appendState.last_integrity_sequence + 1
            } else {
                [int]$appendState.matching_events + 1
            }

            $event = [ordered]@{
                timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
                task_id = $TaskId
                event_type = $EventType
                outcome = $Outcome
                actor = $Actor
                message = $Message
                details = $Details
                integrity = [ordered]@{
                    schema_version = 1
                    task_sequence = $nextSequence
                    prev_event_sha256 = $appendState.last_event_sha256
                }
            }
            # Hash the same JSON-shaped payload that later validators read back from disk.
            $hashSource = ($event | ConvertTo-Json -Depth 16 -Compress) | ConvertFrom-Json -ErrorAction Stop
            $event.integrity.event_sha256 = Get-GateEventIntegrityHash -EventRecord $hashSource
            $line = $event | ConvertTo-Json -Depth 16 -Compress
            Add-Content -LiteralPath $taskFilePath -Value $line
            $result.integrity = $event.integrity
        } finally {
            Release-GateAppendLock -LockPath $taskLockPath
        }

        try {
            Acquire-GateAppendLock -LockPath $allTasksLockPath
            try {
                Add-Content -LiteralPath $allTasksPath -Value $line
            } finally {
                Release-GateAppendLock -LockPath $allTasksLockPath
            }
        } catch {
            $warningMessage = "Task-event aggregate append failed: $($_.Exception.Message)"
            $result.warnings += $warningMessage
            Write-Warning $warningMessage
        }

        if ($PassThru) {
            return $result
        }
    } catch {
        $warningMessage = "Task-event append failed: $($_.Exception.Message)"
        Write-Warning $warningMessage
        if ($PassThru) {
            return [ordered]@{
                task_event_log_path = (Convert-GatePathToUnix -PathValue (Join-Path (Join-GateOrchestratorPath -RepoRootPath $RepoRootPath -RelativePath 'runtime/task-events') "$TaskId.jsonl"))
                all_tasks_log_path = (Convert-GatePathToUnix -PathValue (Join-Path (Join-GateOrchestratorPath -RepoRootPath $RepoRootPath -RelativePath 'runtime/task-events') 'all-tasks.jsonl'))
                integrity = $null
                warnings = @($warningMessage)
            }
        }
    }
}

function Convert-GateToPlainObject {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime().ToString('o')
    }

    if ($Value -is [System.Enum]) {
        return [string]$Value
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $copy = [ordered]@{}
        foreach ($key in ($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
            $copy[$key] = Convert-GateToPlainObject -Value $Value[$key]
        }
        return $copy
    }

    if ($Value -is [PSCustomObject]) {
        $copy = [ordered]@{}
        foreach ($propertyName in ($Value.PSObject.Properties.Name | Sort-Object)) {
            $copy[$propertyName] = Convert-GateToPlainObject -Value $Value.$propertyName
        }
        return $copy
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(Convert-GateToPlainObject -Value $item)
        }
        return ,$items
    }

    return $Value
}

function Convert-GateToCanonicalJson {
    param([object]$Value)

    if ($null -eq $Value) {
        return 'null'
    }

    if ($Value -is [bool]) {
        return $(if ($Value) { 'true' } else { 'false' })
    }

    if ($Value -is [string]) {
        return ($Value | ConvertTo-Json -Compress)
    }

    if ($Value -is [datetime]) {
        return ($Value.ToUniversalTime().ToString('o') | ConvertTo-Json -Compress)
    }

    if (
        $Value -is [byte] -or
        $Value -is [sbyte] -or
        $Value -is [short] -or
        $Value -is [ushort] -or
        $Value -is [int] -or
        $Value -is [uint] -or
        $Value -is [long] -or
        $Value -is [ulong] -or
        $Value -is [single] -or
        $Value -is [double] -or
        $Value -is [decimal]
    ) {
        return ($Value | ConvertTo-Json -Compress)
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $pairs = @()
        foreach ($key in ($Value.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
            $pairs += (($key | ConvertTo-Json -Compress) + ':' + (Convert-GateToCanonicalJson -Value $Value[$key]))
        }
        return '{' + ($pairs -join ',') + '}'
    }

    if ($Value -is [PSCustomObject]) {
        $copy = [ordered]@{}
        foreach ($propertyName in ($Value.PSObject.Properties.Name | Sort-Object)) {
            $copy[$propertyName] = $Value.$propertyName
        }
        return Convert-GateToCanonicalJson -Value $copy
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += (Convert-GateToCanonicalJson -Value $item)
        }
        return '[' + ($items -join ',') + ']'
    }

    return ($Value | ConvertTo-Json -Compress)
}

function Get-GateSha256Hex {
    param([string]$Text)

    $utf8 = [System.Text.Encoding]::UTF8
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $utf8.GetBytes($Text)
        $hashBytes = $sha256.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Get-GateEventIntegrityHash {
    param([Parameter(Mandatory = $true)][object]$EventRecord)

    $plainEvent = Convert-GateToPlainObject -Value $EventRecord
    if ($plainEvent -is [System.Collections.IDictionary] -and $plainEvent.Contains('integrity')) {
        $integrityMap = Convert-GateToPlainObject -Value $plainEvent['integrity']
        if ($integrityMap -is [System.Collections.IDictionary]) {
            $sanitizedIntegrity = [ordered]@{}
            foreach ($key in ($integrityMap.Keys | ForEach-Object { [string]$_ } | Sort-Object)) {
                if ([string]::Equals($key, 'event_sha256', [System.StringComparison]::Ordinal)) {
                    continue
                }
                $sanitizedIntegrity[$key] = $integrityMap[$key]
            }
            $plainEvent['integrity'] = $sanitizedIntegrity
        }
    }

    $canonicalJson = Convert-GateToCanonicalJson -Value $plainEvent
    return Get-GateSha256Hex -Text $canonicalJson
}

function Acquire-GateAppendLock {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LockPath,
        [int]$TimeoutMilliseconds = 10000,
        [int]$PollMilliseconds = 50,
        [int]$StaleMilliseconds = 120000
    )

    $parentPath = Split-Path -Parent $LockPath
    if (-not [string]::IsNullOrWhiteSpace($parentPath) -and -not (Test-Path -LiteralPath $parentPath)) {
        New-Item -Path $parentPath -ItemType Directory -Force | Out-Null
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        try {
            $stream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try {
                $payload = [ordered]@{
                    pid = $PID
                    acquired_utc = (Get-Date).ToUniversalTime().ToString('o')
                } | ConvertTo-Json -Compress
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush()
            } finally {
                $stream.Dispose()
            }
            return
        } catch [System.IO.IOException] {
            if (Test-Path -LiteralPath $LockPath -PathType Leaf) {
                try {
                    $lockAge = (Get-Date).ToUniversalTime() - (Get-Item -LiteralPath $LockPath).LastWriteTimeUtc
                    if ($lockAge.TotalMilliseconds -ge $StaleMilliseconds) {
                        Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
                        continue
                    }
                } catch {
                }
            }

            if ($stopwatch.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
                throw "Timed out acquiring append lock: $LockPath"
            }
            Start-Sleep -Milliseconds $PollMilliseconds
        }
    }
}

function Release-GateAppendLock {
    param([string]$LockPath)

    try {
        if (-not [string]::IsNullOrWhiteSpace($LockPath) -and (Test-Path -LiteralPath $LockPath -PathType Leaf)) {
            Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
        }
    } catch {
    }
}

function Get-GateTaskEventAppendState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskFilePath,
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    $state = [ordered]@{
        matching_events = 0
        parse_errors = 0
        last_integrity_sequence = $null
        last_event_sha256 = $null
    }

    if (-not (Test-Path -LiteralPath $TaskFilePath -PathType Leaf)) {
        return $state
    }

    foreach ($rawLine in (Get-Content -LiteralPath $TaskFilePath)) {
        if ([string]::IsNullOrWhiteSpace($rawLine)) {
            continue
        }

        $eventObject = $null
        try {
            $eventObject = $rawLine | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $state.parse_errors++
            continue
        }

        $eventTaskId = ''
        if ($null -ne $eventObject.PSObject.Properties['task_id']) {
            $eventTaskId = [string]$eventObject.task_id
        }
        if (-not [string]::IsNullOrWhiteSpace($eventTaskId) -and -not [string]::Equals($eventTaskId.Trim(), $TaskId, [System.StringComparison]::Ordinal)) {
            continue
        }

        $state.matching_events++
        $integrity = $null
        if ($null -ne $eventObject.PSObject.Properties['integrity']) {
            $integrity = $eventObject.integrity
        }
        if ($null -eq $integrity) {
            continue
        }

        $sequence = $null
        if ($null -ne $integrity.PSObject.Properties['task_sequence']) {
            $sequence = $integrity.task_sequence
        }
        $eventSha256 = ''
        if ($null -ne $integrity.PSObject.Properties['event_sha256']) {
            $eventSha256 = [string]$integrity.event_sha256
        }

        if (($sequence -is [int] -or $sequence -is [long]) -and [int]$sequence -gt 0 -and -not [string]::IsNullOrWhiteSpace($eventSha256)) {
            $state.last_integrity_sequence = [int]$sequence
            $state.last_event_sha256 = $eventSha256.Trim().ToLowerInvariant()
        }
    }

    return $state
}

function Get-GateTaskTimelineIntegrity {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TaskEventFilePath,
        [Parameter(Mandatory = $true)]
        [string]$TaskId
    )

    $result = [ordered]@{
        source_path = (Convert-GatePathToUnix -PathValue $TaskEventFilePath)
        status = 'UNKNOWN'
        events_scanned = 0
        matching_events = 0
        parse_errors = 0
        task_id_mismatches = 0
        legacy_event_count = 0
        integrity_event_count = 0
        first_integrity_sequence = $null
        last_integrity_sequence = $null
        duplicate_event_hashes = @()
        violations = @()
    }

    if (-not (Test-Path -LiteralPath $TaskEventFilePath -PathType Leaf)) {
        $result.status = 'MISSING'
        $result.violations += "Task events file not found: $($result.source_path)"
        return $result
    }

    $lastEventHash = $null
    $expectedSequence = $null
    $integrityStarted = $false
    $seenHashes = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $lineNumber = 0

    foreach ($rawLine in (Get-Content -LiteralPath $TaskEventFilePath)) {
        if ([string]::IsNullOrWhiteSpace($rawLine)) {
            continue
        }

        $lineNumber++
        $result.events_scanned = $lineNumber
        $eventObject = $null
        try {
            $eventObject = $rawLine | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $result.parse_errors++
            $result.violations += "Task timeline contains invalid JSON at line $lineNumber."
            continue
        }

        $eventTaskId = ''
        if ($null -ne $eventObject.PSObject.Properties['task_id']) {
            $eventTaskId = [string]$eventObject.task_id
        }
        if (-not [string]::IsNullOrWhiteSpace($eventTaskId) -and -not [string]::Equals($eventTaskId.Trim(), $TaskId, [System.StringComparison]::Ordinal)) {
            $result.task_id_mismatches++
            $result.violations += "Task timeline contains foreign task_id '$eventTaskId' at line $lineNumber."
            continue
        }

        $result.matching_events++
        $integrity = $null
        if ($null -ne $eventObject.PSObject.Properties['integrity']) {
            $integrity = $eventObject.integrity
        }
        if ($null -eq $integrity) {
            if ($integrityStarted) {
                $result.violations += "Task timeline contains legacy/unverified event after integrity chain start at line $lineNumber."
            } else {
                $result.legacy_event_count++
            }
            continue
        }

        $schemaVersion = $null
        if ($null -ne $integrity.PSObject.Properties['schema_version']) {
            $schemaVersion = $integrity.schema_version
        }
        $taskSequence = $null
        if ($null -ne $integrity.PSObject.Properties['task_sequence']) {
            $taskSequence = $integrity.task_sequence
        }
        $prevEventSha256 = $null
        if ($null -ne $integrity.PSObject.Properties['prev_event_sha256']) {
            $prevEventSha256 = $integrity.prev_event_sha256
        }
        $eventSha256 = ''
        if ($null -ne $integrity.PSObject.Properties['event_sha256']) {
            $eventSha256 = [string]$integrity.event_sha256
        }
        $eventSha256 = $eventSha256.Trim().ToLowerInvariant()

        if ($schemaVersion -ne 1) {
            $result.violations += "Task timeline integrity schema mismatch at line ${lineNumber}: expected 1, got '$schemaVersion'."
            continue
        }
        if (-not (($taskSequence -is [int]) -or ($taskSequence -is [long])) -or [int]$taskSequence -le 0) {
            $result.violations += "Task timeline has invalid task_sequence at line $lineNumber."
            continue
        }
        if ($null -ne $prevEventSha256 -and [string]::IsNullOrWhiteSpace([string]$prevEventSha256)) {
            $prevEventSha256 = $null
        }
        if ([string]::IsNullOrWhiteSpace($eventSha256)) {
            $result.violations += "Task timeline missing event_sha256 at line $lineNumber."
            continue
        }

        if (-not $integrityStarted) {
            $integrityStarted = $true
            $expectedSequence = [int]$result.legacy_event_count + 1
            if ($null -ne $prevEventSha256) {
                $result.violations += "Task timeline first integrity event must have null prev_event_sha256 (line $lineNumber)."
            }
        }

        if ([int]$taskSequence -ne [int]$expectedSequence) {
            $result.violations += "Task timeline sequence mismatch at line ${lineNumber}: expected $expectedSequence, got $taskSequence."
        }

        $normalizedPrevHash = if ($null -eq $prevEventSha256) { $null } else { ([string]$prevEventSha256).Trim().ToLowerInvariant() }
        if ($normalizedPrevHash -ne $lastEventHash) {
            $result.violations += "Task timeline prev_event_sha256 mismatch at line $lineNumber."
        }

        $recalculatedHash = Get-GateEventIntegrityHash -EventRecord $eventObject
        if ($recalculatedHash -ne $eventSha256) {
            $result.violations += "Task timeline event_sha256 mismatch at line $lineNumber."
        }

        if (-not $seenHashes.Add($eventSha256)) {
            $result.duplicate_event_hashes += $eventSha256
            $result.violations += "Task timeline duplicate/replayed event detected at line $lineNumber."
        }

        $result.integrity_event_count++
        if ($null -eq $result.first_integrity_sequence) {
            $result.first_integrity_sequence = [int]$taskSequence
        }
        $result.last_integrity_sequence = [int]$taskSequence
        $lastEventHash = $eventSha256
        $expectedSequence = [int]$taskSequence + 1
    }

    if ($result.violations.Count -gt 0) {
        $result.status = 'FAILED'
    } elseif ($result.matching_events -eq 0) {
        $result.status = 'EMPTY'
    } elseif ($result.integrity_event_count -eq 0) {
        $result.status = 'LEGACY_ONLY'
    } elseif ($result.legacy_event_count -gt 0) {
        $result.status = 'PASS_WITH_LEGACY_PREFIX'
    } else {
        $result.status = 'PASS'
    }

    return $result
}

Export-ModuleMember -Function @(
    'Get-GateProjectRoot',
    'Get-GateOrchestratorRoot',
    'Get-GateOrchestratorRelativePath',
    'Join-GateOrchestratorPath',
    'Convert-GatePathToUnix',
    'Assert-GateTaskId',
    'Resolve-GatePathInsideRepo',
    'Convert-GateToStringArray',
    'Test-GateMatchAnyRegex',
    'Get-GateStringSha256',
    'Get-GateCompactReviewBudget',
    'Estimate-GateTokenCount',
    'Invoke-GateMarkdownCompaction',
    'New-GateRuleContextArtifact',
    'Test-GateReviewArtifactCompaction',
    'Add-GateMetricsEvent',
    'Get-GateOutputTelemetry',
    'Invoke-GateOutputFilter',
    'Add-GateTaskEvent',
    'Get-GateTaskTimelineIntegrity'
)
