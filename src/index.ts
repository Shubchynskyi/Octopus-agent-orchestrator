module.exports = {
    cli: require('./cli/index.ts'),
    core: {
        constants: require('./core/constants.ts'),
        fs: require('./core/fs.ts'),
        json: require('./core/json.ts'),
        lineEndings: require('./core/line-endings.ts'),
        managedBlocks: require('./core/managed-blocks.ts'),
        paths: require('./core/paths.ts'),
        templates: require('./core/templates.ts')
    },
    gateRuntime: require('./gate-runtime/index.ts'),
    lifecycle: require('./lifecycle/index.ts'),
    materialization: require('./materialization/index.ts'),
    runtime: require('./runtime/loaders.ts'),
    schemas: {
        configArtifacts: require('./schemas/config-artifacts.ts'),
        initAnswers: require('./schemas/init-answers.ts')
    },
    validators: require('./validators/index.ts')
};
