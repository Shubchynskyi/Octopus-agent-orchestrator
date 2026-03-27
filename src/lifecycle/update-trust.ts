/**
 * Update source trust policy for the orchestrator update lifecycle.
 *
 * Default behavior (trusted mode):
 * - Only allowlisted npm package names and git repository URLs are accepted.
 * - Local source paths (--source-path) are rejected.
 *
 * Override:
 * - Pass trustOverride: true or set OCTOPUS_UPDATE_TRUST_OVERRIDE=1 to bypass.
 * - Overridden sources are clearly flagged in the result.
 */

export const TRUSTED_GIT_REPO_URLS = Object.freeze([
    'https://github.com/Shubchynskyi/Octopus-agent-orchestrator.git',
    'https://github.com/Shubchynskyi/Octopus-agent-orchestrator'
]);

export const TRUSTED_NPM_PACKAGE_NAMES = Object.freeze([
    'octopus-agent-orchestrator'
]);

export const TRUST_OVERRIDE_ENV_VAR = 'OCTOPUS_UPDATE_TRUST_OVERRIDE';

interface TrustOverrideOptions {
    trustOverride?: boolean;
}

interface TrustValidationResult {
    trusted: boolean;
    overridden: boolean;
    policy: 'overridden' | 'enforced';
}

interface ParsedNpmPackageSpec {
    name: string;
    version: string | null;
}

/**
 * Returns true when the caller has explicitly opted out of trust enforcement.
 * Checks both the options object and the environment variable.
 */
export function isTrustOverrideActive(options?: TrustOverrideOptions | null): boolean {
    if (options && options.trustOverride === true) return true;
    const envValue = String(process.env[TRUST_OVERRIDE_ENV_VAR] || '').trim().toLowerCase();
    return envValue === '1' || envValue === 'true' || envValue === 'yes';
}

/**
 * Normalises a git URL for comparison: trims whitespace, strips trailing
 * slashes and the optional .git suffix, then lowercases.
 */
export function normalizeGitUrl(url: string): string {
    return String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

export function isGitRepoUrlTrusted(repoUrl: string): boolean {
    const normalized = normalizeGitUrl(repoUrl);
    for (const trusted of TRUSTED_GIT_REPO_URLS) {
        if (normalizeGitUrl(trusted) === normalized) return true;
    }
    return false;
}

/**
 * Parses an npm package spec into { name, version }.
 * Returns null for specs that are not valid package-name references
 * (local paths, URLs, tarballs, etc.).
 */
export function parseNpmPackageSpec(spec: string): ParsedNpmPackageSpec | null {
    const trimmed = String(spec || '').trim();
    if (!trimmed) return null;

    // Local / relative paths
    if (/^[./\\]/.test(trimmed)) return null;
    // Windows absolute paths (e.g. C:\...)
    if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return null;
    // URL-like protocols (file:, git:, http:, https:, git+https:, etc.)
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('@')) return null;
    // Tarballs
    if (/\.(tgz|tar\.gz|tar)$/i.test(trimmed)) return null;

    // Scoped packages: @scope/name or @scope/name@version
    if (trimmed.startsWith('@')) {
        const slashIdx = trimmed.indexOf('/');
        if (slashIdx < 0) return null;
        const afterSlash = trimmed.substring(slashIdx + 1);
        const atIdx = afterSlash.indexOf('@');
        if (atIdx < 0) {
            return { name: trimmed, version: null };
        }
        return {
            name: trimmed.substring(0, slashIdx + 1 + atIdx),
            version: afterSlash.substring(atIdx + 1) || null
        };
    }

    // Unscoped: name or name@version
    const atIdx = trimmed.indexOf('@');
    if (atIdx < 0) {
        return { name: trimmed, version: null };
    }
    return {
        name: trimmed.substring(0, atIdx),
        version: trimmed.substring(atIdx + 1) || null
    };
}

export function isNpmPackageSpecTrusted(packageSpec: string): boolean {
    const parsed = parseNpmPackageSpec(packageSpec);
    if (!parsed || !parsed.name) return false;
    return TRUSTED_NPM_PACKAGE_NAMES.includes(parsed.name.toLowerCase());
}

// ── Validation entry-points ────────────────────────────────────────────

export function validateGitSourceTrust(repoUrl: string, options?: TrustOverrideOptions | null): TrustValidationResult {
    const overridden = isTrustOverrideActive(options);
    if (overridden) {
        return { trusted: false, overridden: true, policy: 'overridden' };
    }
    if (isGitRepoUrlTrusted(repoUrl)) {
        return { trusted: true, overridden: false, policy: 'enforced' };
    }
    throw new Error(
        `Update source trust policy rejected git repository '${repoUrl}'. ` +
        `Only allowlisted repositories are accepted in trusted mode. ` +
        `Trusted: ${TRUSTED_GIT_REPO_URLS.join(', ')}. ` +
        `Use --trust-override or set ${TRUST_OVERRIDE_ENV_VAR}=1 to bypass.`
    );
}

export function validateNpmSourceTrust(packageSpec: string, options?: TrustOverrideOptions | null): TrustValidationResult {
    const overridden = isTrustOverrideActive(options);
    if (overridden) {
        return { trusted: false, overridden: true, policy: 'overridden' };
    }
    if (isNpmPackageSpecTrusted(packageSpec)) {
        return { trusted: true, overridden: false, policy: 'enforced' };
    }
    throw new Error(
        `Update source trust policy rejected npm package spec '${packageSpec}'. ` +
        `Only allowlisted package names are accepted in trusted mode. ` +
        `Trusted: ${TRUSTED_NPM_PACKAGE_NAMES.join(', ')}. ` +
        `Use --trust-override or set ${TRUST_OVERRIDE_ENV_VAR}=1 to bypass.`
    );
}

export function validatePathSourceTrust(sourcePath: string, options?: TrustOverrideOptions | null): TrustValidationResult {
    const overridden = isTrustOverrideActive(options);
    if (overridden) {
        return { trusted: false, overridden: true, policy: 'overridden' };
    }
    throw new Error(
        `Update source trust policy rejected local source path '${sourcePath}'. ` +
        `Local source paths are not accepted in trusted mode. ` +
        `Use --trust-override or set ${TRUST_OVERRIDE_ENV_VAR}=1 to bypass.`
    );
}
