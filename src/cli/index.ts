import {
    DEFAULT_BUNDLE_NAME,
    DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
    LIFECYCLE_COMMANDS,
    MANAGED_CONFIG_NAMES,
    NODE_BASELINE_LABEL,
    NODE_ENGINE_RANGE,
    SOURCE_OF_TRUTH_VALUES
} from '../core/constants';

export function describeFoundation() {
    return {
        activeCliEntrypoint: 'bin/octopus.js',
        defaultBundleName: DEFAULT_BUNDLE_NAME,
        defaultInitAnswersRelativePath: DEFAULT_INIT_ANSWERS_RELATIVE_PATH,
        lifecycleCommands: [...LIFECYCLE_COMMANDS],
        managedConfigNames: [...MANAGED_CONFIG_NAMES],
        nodeBaseline: NODE_ENGINE_RANGE,
        nodeBaselineLabel: NODE_BASELINE_LABEL,
        runtimeMode: 'node-only-router',
        sourceOfTruthValues: [...SOURCE_OF_TRUTH_VALUES]
    };
}

