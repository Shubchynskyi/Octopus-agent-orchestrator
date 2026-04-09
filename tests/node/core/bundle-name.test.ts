import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_BUNDLE_NAME, resolveBundleName } from '../../../src/core/constants';

test('DEFAULT_BUNDLE_NAME is the expected constant', () => {
    assert.equal(DEFAULT_BUNDLE_NAME, 'Octopus-agent-orchestrator');
});

test('resolveBundleName returns default when no override and no env var', () => {
    const saved = process.env.OCTOPUS_BUNDLE_NAME;
    delete process.env.OCTOPUS_BUNDLE_NAME;
    try {
        assert.equal(resolveBundleName(), 'Octopus-agent-orchestrator');
    } finally {
        if (saved !== undefined) process.env.OCTOPUS_BUNDLE_NAME = saved;
    }
});

test('resolveBundleName returns explicit override when provided', () => {
    const saved = process.env.OCTOPUS_BUNDLE_NAME;
    process.env.OCTOPUS_BUNDLE_NAME = 'env-bundle';
    try {
        assert.equal(resolveBundleName('my-bundle'), 'my-bundle');
    } finally {
        if (saved !== undefined) {
            process.env.OCTOPUS_BUNDLE_NAME = saved;
        } else {
            delete process.env.OCTOPUS_BUNDLE_NAME;
        }
    }
});

test('resolveBundleName reads OCTOPUS_BUNDLE_NAME env var when no override', () => {
    const saved = process.env.OCTOPUS_BUNDLE_NAME;
    process.env.OCTOPUS_BUNDLE_NAME = 'custom-orchestrator';
    try {
        assert.equal(resolveBundleName(), 'custom-orchestrator');
    } finally {
        if (saved !== undefined) {
            process.env.OCTOPUS_BUNDLE_NAME = saved;
        } else {
            delete process.env.OCTOPUS_BUNDLE_NAME;
        }
    }
});

test('resolveBundleName ignores whitespace-only override', () => {
    const saved = process.env.OCTOPUS_BUNDLE_NAME;
    delete process.env.OCTOPUS_BUNDLE_NAME;
    try {
        assert.equal(resolveBundleName('  '), 'Octopus-agent-orchestrator');
    } finally {
        if (saved !== undefined) process.env.OCTOPUS_BUNDLE_NAME = saved;
    }
});

test('resolveBundleName ignores whitespace-only env var', () => {
    const saved = process.env.OCTOPUS_BUNDLE_NAME;
    process.env.OCTOPUS_BUNDLE_NAME = '  ';
    try {
        assert.equal(resolveBundleName(), 'Octopus-agent-orchestrator');
    } finally {
        if (saved !== undefined) {
            process.env.OCTOPUS_BUNDLE_NAME = saved;
        } else {
            delete process.env.OCTOPUS_BUNDLE_NAME;
        }
    }
});

test('resolveBundleName trims override', () => {
    assert.equal(resolveBundleName('  custom-name  '), 'custom-name');
});
