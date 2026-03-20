module.exports = {
    ...require('./validate-manifest.ts'),
    ...require('./workspace-layout.ts'),
    ...require('./status.ts'),
    ...require('./verify.ts'),
    ...require('./doctor.ts')
};
