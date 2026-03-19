#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    function script:New-TempRoot {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("oa-command-compactness-" + [Guid]::NewGuid().ToString('N'))
        New-Item -Path $tempRoot -ItemType Directory -Force | Out-Null
        return $tempRoot
    }
}

Describe 'command compactness audit' {
    It 'flags noisy first-pass commands in <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
        $modulePath = Join-Path $repoRoot "$Variant\scripts\agent-gates\lib\gate-utils.psm1"
        Import-Module -Name $modulePath -Force -DisableNameChecking

        $result = Test-GateCommandCompactness -CommandText 'git diff' -Mode 'scan'

        $result.warning_count | Should -BeGreaterThan 0
        @($result.matched_rules) | Should -Contain 'git_diff_unscoped'
    }

    It 'surfaces command-policy warnings in task summary for <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
        $modulePath = Join-Path $repoRoot "$Variant\scripts\agent-gates\lib\gate-utils.psm1"
        $summaryScriptPath = Join-Path $repoRoot "$Variant\scripts\agent-gates\task-events-summary.ps1"
        Import-Module -Name $modulePath -Force -DisableNameChecking

        $workspace = New-TempRoot
        try {
            Add-GateTaskEvent -RepoRootPath $workspace -TaskId 'T-065' -EventType 'COMMAND_EXECUTED' -Message 'ran a command' -Details ([pscustomobject]@{
                command = 'docker logs api'
                command_mode = 'scan'
            }) | Out-Null

            $output = & pwsh -NoLogo -NoProfile -File $summaryScriptPath -TaskId 'T-065' -RepoRoot $workspace 2>&1
            $outputText = @($output) -join [Environment]::NewLine

            $LASTEXITCODE | Should -Be 0
            $outputText | Should -Match 'CommandPolicyWarnings:'
            $outputText | Should -Match 'docker logs --tail 50'
        }
        finally {
            if (Test-Path -LiteralPath $workspace) {
                Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
