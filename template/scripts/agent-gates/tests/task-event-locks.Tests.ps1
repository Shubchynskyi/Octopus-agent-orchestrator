#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    function script:New-TempRoot {
        $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("oa-task-event-locks-" + [Guid]::NewGuid().ToString('N'))
        New-Item -Path $tempRoot -ItemType Directory -Force | Out-Null
        return $tempRoot
    }
}

Describe 'task-event append locking' {
    It 'keeps task integrity sequence stable in <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
        $modulePath = Join-Path $repoRoot "$Variant\scripts\agent-gates\lib\gate-utils.psm1"
        Import-Module -Name $modulePath -Force -DisableNameChecking

        $workspace = New-TempRoot
        try {
            $first = Add-GateTaskEvent -RepoRootPath $workspace -TaskId 'T-061' -EventType 'TASK_START' -Message 'start' -PassThru
            $second = Add-GateTaskEvent -RepoRootPath $workspace -TaskId 'T-061' -EventType 'TASK_PROGRESS' -Message 'progress' -PassThru

            $first.integrity.task_sequence | Should -Be 1
            $second.integrity.task_sequence | Should -Be 2
            $second.integrity.prev_event_sha256 | Should -Be $first.integrity.event_sha256
        }
        finally {
            if (Test-Path -LiteralPath $workspace) {
                Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    It 'does not let aggregate lock contention stall task append in <Variant>' -ForEach @(
        @{ Variant = 'live' },
        @{ Variant = 'template' }
    ) {
        param($Variant)

        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
        $modulePath = Join-Path $repoRoot "$Variant\scripts\agent-gates\lib\gate-utils.psm1"
        Import-Module -Name $modulePath -Force -DisableNameChecking

        $workspace = New-TempRoot
        try {
            $eventsDir = Join-Path $workspace 'runtime\task-events'
            New-Item -Path $eventsDir -ItemType Directory -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $eventsDir 'all-tasks.jsonl.lock') -Value '{"pid":999,"acquired_utc":"2026-01-01T00:00:00Z"}'

            $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
            $result = Add-GateTaskEvent -RepoRootPath $workspace -TaskId 'T-062' -EventType 'TASK_START' -Message 'start' -PassThru
            $stopwatch.Stop()

            $stopwatch.Elapsed.TotalSeconds | Should -BeLessThan 4
            @($result.warnings) | Should -Not -BeNullOrEmpty
            (@($result.warnings) -join [Environment]::NewLine) | Should -Match 'aggregate append failed'
            Test-Path -LiteralPath (Join-Path $eventsDir 'T-062.jsonl') | Should -BeTrue
        }
        finally {
            if (Test-Path -LiteralPath $workspace) {
                Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
