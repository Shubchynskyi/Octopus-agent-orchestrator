const test = require('node:test');
const assert = require('node:assert/strict');

const {
    listTemplateTokens,
    replaceTemplateTokens
} = require('../../../src/core/templates.ts');

test('listTemplateTokens returns unique placeholders in encounter order', () => {
    assert.deepEqual(
        listTemplateTokens('Hello {{NAME}} and {{PLACE}} then {{NAME}} again'),
        ['NAME', 'PLACE']
    );
});

test('replaceTemplateTokens only replaces placeholders that were provided', () => {
    assert.equal(
        replaceTemplateTokens('Hello {{NAME}} from {{PLACE}} / {{UNKNOWN}}', {
            NAME: 'Octopus',
            PLACE: 'Node'
        }),
        'Hello Octopus from Node / {{UNKNOWN}}'
    );
});
