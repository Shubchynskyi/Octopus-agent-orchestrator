import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    getManagedConfigValidators,
    validateManagedConfigByName,
    validateOutputFiltersConfig,
    validateTokenEconomyConfig
} from '../../../src/schemas/config-artifacts';

function readTemplateConfig(configName: string): Record<string, unknown> {
    return JSON.parse(
        fs.readFileSync(path.join(process.cwd(), 'template', 'config', `${configName}.json`), 'utf8')
    );
}

test('tracked template managed configs validate successfully', () => {
    for (const configName of Object.keys(getManagedConfigValidators())) {
        const validated = validateManagedConfigByName(configName, readTemplateConfig(configName));
        assert.ok(validated);
    }
});

test('validateTokenEconomyConfig canonicalizes integer arrays and boolean-like values', () => {
    const normalized = validateTokenEconomyConfig({
        enabled: 'yes',
        enabled_depths: ['3', 1, '2', 2],
        strip_examples: 'true',
        strip_code_blocks: 1,
        scoped_diffs: 'no',
        compact_reviewer_output: false,
        fail_tail_lines: '25'
    });

    assert.equal(normalized.enabled, true);
    assert.deepEqual(normalized.enabled_depths, [1, 2, 3]);
    assert.equal(normalized.scoped_diffs, false);
    assert.equal(normalized.fail_tail_lines, 25);
});

test('validateOutputFiltersConfig accepts context-driven parser controls from the tracked template', () => {
    const normalized = validateOutputFiltersConfig(readTemplateConfig('output-filters'));

    assert.equal(normalized.version, 2);
    const profiles = (normalized as Record<string, unknown>).profiles as Record<string, { parser: { tail_count: { context_key: string } } }>;
    assert.equal(
        profiles.compile_failure_console.parser.tail_count.context_key,
        'fail_tail_lines'
    );
});
