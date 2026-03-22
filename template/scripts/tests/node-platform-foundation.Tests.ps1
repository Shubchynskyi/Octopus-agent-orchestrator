#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..' '..' '..'))
    $script:PackageJsonPath = Join-Path $repoRoot 'package.json'
    $script:ContractDocPath = Join-Path $repoRoot 'docs\node-migration-contract.md'
    $script:FoundationDocPath = Join-Path $repoRoot 'docs\node-platform-foundation.md'
    $script:BuildScriptPath = Join-Path $repoRoot 'scripts\node-foundation\build.ts'
    $script:TestScriptPath = Join-Path $repoRoot 'scripts\node-foundation\test.ts'
    $script:BuildRoot = Join-Path $repoRoot '.node-build'
    $script:PackageJson = Get-Content -LiteralPath $script:PackageJsonPath -Raw | ConvertFrom-Json -ErrorAction Stop
    $script:RequiredFoundationPaths = @(
        'src\index.ts',
        'src\cli\index.ts',
        'src\core\constants.ts',
        'src\core\paths.ts',
        'src\core\line-endings.ts',
        'src\core\fs.ts',
        'src\core\json.ts',
        'src\core\templates.ts',
        'src\core\managed-blocks.ts',
        'src\schemas\shared.ts',
        'src\schemas\init-answers.ts',
        'src\schemas\config-artifacts.ts',
        'src\runtime\loaders.ts',
        'src\validators\index.ts',
        'src\validators\validate-manifest.ts',
        'src\validators\workspace-layout.ts',
        'src\validators\status.ts',
        'src\validators\verify.ts',
        'src\validators\doctor.ts',
        'scripts\node-foundation\build.ts',
        'scripts\node-foundation\test.ts',
        'tsconfig.node-foundation.json',
        'docs\node-platform-foundation.md'
    ) | ForEach-Object { @{ RelativePath = $_ } }

    function script:Invoke-TypeScriptEntrypoint {
        param(
            [Parameter(Mandatory = $true)]
            [string]$ScriptPath,
            [Parameter(Mandatory = $true)]
            [string]$Invocation
        )

        $output = & node '--input-type=commonjs' '--eval' "require.extensions['.ts']=require.extensions['.js'];$Invocation" $ScriptPath 2>&1
        return [PSCustomObject]@{
            Output   = @($output)
            ExitCode = $LASTEXITCODE
        }
    }
}

Describe 'Node platform foundation metadata' {
    It 'requires the Node 20 baseline in package.json' {
        $script:PackageJson.engines.node | Should -Be '>=20.0.0'
    }

    It 'defines build and test scripts for the Node foundation' {
        $script:PackageJson.scripts.'build:node-foundation' | Should -Be 'node --input-type=commonjs --eval "require.extensions[''.ts'']=require.extensions[''.js''];require(process.argv[1]).runNodeFoundationBuild()" ./scripts/node-foundation/build.ts'
        $script:PackageJson.scripts.'test:node-foundation' | Should -Be 'node --input-type=commonjs --eval "require.extensions[''.ts'']=require.extensions[''.js''];require(process.argv[1]).runNodeFoundationTests()" ./scripts/node-foundation/test.ts'
    }

    It '<RelativePath> exists' -ForEach $script:RequiredFoundationPaths {
        Test-Path -LiteralPath (Join-Path $repoRoot $RelativePath) | Should -BeTrue
    }
}

Describe 'Node platform foundation execution' {
    It 'build script stages the foundation successfully' {
        $result = Invoke-TypeScriptEntrypoint -ScriptPath $script:BuildScriptPath -Invocation 'require(process.argv[1]).runNodeFoundationBuild()'
        $result.ExitCode | Should -Be 0
        (($result.Output | Out-String).Trim()) | Should -Match 'NODE_FOUNDATION_BUILD_OK'
        Test-Path -LiteralPath (Join-Path $script:BuildRoot 'src\index.js') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $script:BuildRoot 'tests\node\cli\index.test.js') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $script:BuildRoot 'node-foundation-manifest.json') | Should -BeTrue
    }

    It 'test script runs the Node foundation suite successfully' {
        $result = Invoke-TypeScriptEntrypoint -ScriptPath $script:TestScriptPath -Invocation 'require(process.argv[1]).runNodeFoundationTests()'
        $result.ExitCode | Should -Be 0
        (($result.Output | Out-String).Trim()) | Should -Match 'NODE_FOUNDATION_TEST_OK'
    }
}

Describe 'Runtime contract alignment' {
    It 'documents the current Node 20 floor in the contract doc' {
        $contractContent = Get-Content -LiteralPath $script:ContractDocPath -Raw
        $contractContent | Should -Match 'Node\.js >=20\.0\.0'
    }

    It 'documents the active foundation separately from the runtime contract' {
        $foundationContent = Get-Content -LiteralPath $script:FoundationDocPath -Raw
        $foundationContent | Should -Match 'Node 20'
        $foundationContent | Should -Match 'TypeScript'
        $foundationContent | Should -Match 'bin/octopus\.js'
        $foundationContent | Should -Match 'Node-only'
    }
}
