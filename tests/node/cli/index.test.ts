const test = require('node:test');
const assert = require('node:assert/strict');

const { describeFoundation } = require('../../../src/cli/index.ts');

test('describeFoundation exposes the staged Node compatibility runtime', () => {
    const foundation = describeFoundation();

    assert.equal(foundation.activeCliEntrypoint, 'bin/octopus.js');
    assert.equal(foundation.nodeBaseline, '>=20.0.0');
    assert.equal(foundation.nodeBaselineLabel, 'Node 20 LTS');
    assert.equal(foundation.runtimeMode, 'compatibility-router');
    assert.deepEqual(foundation.lifecycleCommands, [
        'setup',
        'status',
        'doctor',
        'bootstrap',
        'install',
        'init',
        'reinit',
        'uninstall',
        'update'
    ]);
});
