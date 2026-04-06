import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { BOOLEAN_FALSE_VALUES, BOOLEAN_TRUE_VALUES, DEFAULT_BUNDLE_NAME } from '../core/constants';

export interface ResolvePathOptions {
    allowMissing?: boolean;
}

export interface ToStringArrayOptions {
    trimValues?: boolean;
}

export interface ProtectedControlPlaneManifest {
    schema_version: 1;
    event_source: 'refresh-protected-control-plane-manifest';
    timestamp_utc: string;
    workspace_root: string;
    orchestrator_root: string;
    protected_roots: string[];
    protected_snapshot: Record<string, string>;
    is_source_checkout: boolean;
}

export interface ProtectedControlPlaneManifestEvidence {
    status: 'MISSING' | 'INVALID' | 'MATCH' | 'DRIFT';
    manifest_path: string;
    changed_files: string[];
    manifest: ProtectedControlPlaneManifest | null;
}

/**
 * Normalize a path to Unix-style, trimming whitespace and stripping leading ./
 */
export function normalizePath(pathValue: unknown): string {
    if (pathValue == null) return '';
    let text = String(pathValue).trim().replace(/\\/g, '/');
    text = text.replace(/^\.\//, '');
    text = text.replace(/\/+/g, '/');
    return text;
}

/**
 * Convert any path to POSIX forward-slash style.
 */
export function toPosix(pathValue: unknown): string {
    if (pathValue == null) return '';
    return String(pathValue).replace(/\\/g, '/');
}

/**
 * Resolve project root from a script directory by walking up to find the bundle.
 */
export function resolveProjectRoot(startDir: string): string {
    let current = path.resolve(startDir);
    for (let i = 0; i < 20; i++) {
        if (fs.existsSync(path.join(current, 'MANIFEST.md')) && fs.existsSync(path.join(current, 'VERSION'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return path.resolve(startDir);
}

/**
 * Convert unknown value to a plain object record or null.
 */
export function toPlainRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/**
 * Detect whether repoRoot is the orchestrator source checkout itself.
 */
export function isOrchestratorSourceCheckout(repoRoot: string): boolean {
    const packageJsonPath = path.join(path.resolve(repoRoot), 'package.json');
    if (!fs.existsSync(packageJsonPath) || !fs.statSync(packageJsonPath).isFile()) {
        return false;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
        return String(parsed.name || '').trim() === 'octopus-agent-orchestrator';
    } catch {
        return false;
    }
}

/**
 * Return protected control-plane roots for this workspace.
 * Ordinary workspaces protect only the deployed bundle.
 * The orchestrator source checkout additionally protects root-level runtime sources.
 */
export function getProtectedControlPlaneRoots(repoRoot: string): string[] {
    const roots = [
        `${DEFAULT_BUNDLE_NAME}/src/bin`,
        `${DEFAULT_BUNDLE_NAME}/src/cli`,
        `${DEFAULT_BUNDLE_NAME}/src/gates`,
        `${DEFAULT_BUNDLE_NAME}/src/gate-runtime`,
        `${DEFAULT_BUNDLE_NAME}/src/lifecycle`,
        `${DEFAULT_BUNDLE_NAME}/src/materialization`,
        `${DEFAULT_BUNDLE_NAME}/bin`,
        `${DEFAULT_BUNDLE_NAME}/dist`,
        `${DEFAULT_BUNDLE_NAME}/live/docs/agent-rules`
    ];

    if (isOrchestratorSourceCheckout(repoRoot)) {
        roots.push(
            'src/bin',
            'src/cli',
            'src/gates',
            'src/gate-runtime',
            'src/lifecycle',
            'src/materialization',
            'bin',
            'dist',
            'live/docs/agent-rules'
        );
    }

    return normalizeRootPrefixes(roots);
}

/**
 * Scan protected roots recursively and return a map of path -> sha256 hash.
 */
export function scanProtectedPathHashes(repoRoot: string, protectedRoots: string[]): Record<string, string> {
    const results: Record<string, string> = {};

    const scan = (currentDir: string) => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = normalizePath(path.relative(repoRoot, fullPath));

            if (entry.isDirectory()) {
                scan(fullPath);
            } else if (entry.isFile()) {
                try {
                    const hash = fileSha256(fullPath);
                    if (hash) {
                        results[relPath] = hash;
                    }
                } catch {
                    results[relPath] = '<error>';
                }
            }
        }
    };

    for (const root of protectedRoots) {
        const normalizedRoot = normalizePath(root).replace(/\/$/, '');
        if (!normalizedRoot) {
            continue;
        }
        const fullRoot = path.resolve(repoRoot, normalizedRoot);
        if (!fs.existsSync(fullRoot)) {
            continue;
        }
        const stat = fs.statSync(fullRoot);
        if (stat.isDirectory()) {
            scan(fullRoot);
        } else if (stat.isFile()) {
            const relPath = normalizePath(path.relative(repoRoot, fullRoot));
            const hash = fileSha256(fullRoot);
            if (hash) {
                results[relPath] = hash;
            }
        }
    }

    return results;
}

/**
 * Resolve the persisted protected control-plane manifest path.
 */
export function resolveProtectedControlPlaneManifestPath(repoRoot: string): string {
    return joinOrchestratorPath(repoRoot, path.join('runtime', 'protected-control-plane-manifest.json'));
}

/**
 * Build the current trusted protected control-plane manifest from the workspace.
 */
export function buildProtectedControlPlaneManifest(repoRoot: string): ProtectedControlPlaneManifest {
    const normalizedRepoRoot = path.resolve(repoRoot);
    const protectedRoots = getProtectedControlPlaneRoots(normalizedRepoRoot);
    const manifestPath = resolveProtectedControlPlaneManifestPath(normalizedRepoRoot);
    return {
        schema_version: 1,
        event_source: 'refresh-protected-control-plane-manifest',
        timestamp_utc: new Date().toISOString(),
        workspace_root: normalizePath(normalizedRepoRoot),
        orchestrator_root: normalizePath(path.dirname(path.dirname(manifestPath))),
        protected_roots: protectedRoots,
        protected_snapshot: scanProtectedPathHashes(normalizedRepoRoot, protectedRoots),
        is_source_checkout: isOrchestratorSourceCheckout(normalizedRepoRoot)
    };
}

/**
 * Persist the trusted protected control-plane manifest after a lifecycle action.
 */
export function writeProtectedControlPlaneManifest(repoRoot: string): string {
    const manifestPath = resolveProtectedControlPlaneManifestPath(repoRoot);
    const manifest = buildProtectedControlPlaneManifest(repoRoot);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    return manifestPath;
}

/**
 * Compare the current protected snapshot with the last trusted lifecycle manifest.
 */
export function evaluateProtectedControlPlaneManifest(
    repoRoot: string,
    currentSnapshot?: Record<string, string> | null
): ProtectedControlPlaneManifestEvidence {
    const manifestPath = resolveProtectedControlPlaneManifestPath(repoRoot);
    const normalizedManifestPath = normalizePath(manifestPath);
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
        return {
            status: 'MISSING',
            manifest_path: normalizedManifestPath,
            changed_files: [],
            manifest: null
        };
    }

    let manifestObject: ProtectedControlPlaneManifest;
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        if (
            !parsed
            || typeof parsed !== 'object'
            || Array.isArray(parsed)
            || !parsed.protected_snapshot
            || typeof parsed.protected_snapshot !== 'object'
            || Array.isArray(parsed.protected_snapshot)
        ) {
            return {
                status: 'INVALID',
                manifest_path: normalizedManifestPath,
                changed_files: [],
                manifest: null
            };
        }
        manifestObject = parsed as unknown as ProtectedControlPlaneManifest;
    } catch {
        return {
            status: 'INVALID',
            manifest_path: normalizedManifestPath,
            changed_files: [],
            manifest: null
        };
    }

    const snapshot = currentSnapshot || scanProtectedPathHashes(repoRoot, getProtectedControlPlaneRoots(repoRoot));
    const manifestSnapshot = manifestObject.protected_snapshot || {};
    const changedFiles: string[] = [];
    const allProtectedPaths = new Set([...Object.keys(manifestSnapshot), ...Object.keys(snapshot)]);
    for (const protectedPath of allProtectedPaths) {
        if (manifestSnapshot[protectedPath] !== snapshot[protectedPath]) {
            changedFiles.push(protectedPath);
        }
    }

    return {
        status: changedFiles.length > 0 ? 'DRIFT' : 'MATCH',
        manifest_path: normalizedManifestPath,
        changed_files: changedFiles.sort(),
        manifest: manifestObject
    };
}

/**
 * Join orchestrator-relative path: if repoRoot already ends with the bundle name
 * use it directly; otherwise prefer a deployed bundle when present and fall back
 * to the workspace root when the bundle has not been materialized yet.
 */
export function joinOrchestratorPath(repoRoot: string, relativePath: string): string {
    const repoRootResolved = path.resolve(repoRoot);
    const deployedRoot = path.resolve(repoRootResolved, DEFAULT_BUNDLE_NAME);
    const looksLikeBundleRoot = (candidatePath: string): boolean => (
        fs.existsSync(path.join(candidatePath, 'MANIFEST.md'))
        && fs.existsSync(path.join(candidatePath, 'VERSION'))
    );

    let orchestratorRoot = repoRootResolved;
    if (looksLikeBundleRoot(deployedRoot)) {
        orchestratorRoot = deployedRoot;
    } else if (looksLikeBundleRoot(repoRootResolved)) {
        orchestratorRoot = repoRootResolved;
    } else if (fs.existsSync(deployedRoot)) {
        orchestratorRoot = deployedRoot;
    }

    let normalizedRelativePath = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalizedRelativePath.toLowerCase().startsWith(`${DEFAULT_BUNDLE_NAME.toLowerCase()}/`)) {
        normalizedRelativePath = normalizedRelativePath.slice(DEFAULT_BUNDLE_NAME.length + 1);
    }

    if (!normalizedRelativePath.trim()) {
        return path.resolve(orchestratorRoot);
    }
    return path.resolve(orchestratorRoot, normalizedRelativePath);
}

/**
 * Get orchestrator-relative path as a posix string.
 */
export function orchestratorRelativePath(repoRoot: string, relativePath: string): string {
    return toPosix(joinOrchestratorPath(repoRoot, relativePath));
}

/**
 * Resolve a path inside the repo root. If relative, resolve against repoRoot.
 */
export function resolvePathInsideRepo(pathValue: string, repoRoot: string, options: ResolvePathOptions = {}): string | null {
    const allowMissing = options.allowMissing || false;
    const text = String(pathValue).trim();
    if (!text) return null;

    let resolved;
    if (path.isAbsolute(text)) {
        resolved = path.resolve(text);
    } else {
        resolved = path.resolve(repoRoot, text);
    }

    if (!allowMissing && !fs.existsSync(resolved)) {
        throw new Error(`Path not found: ${resolved}`);
    }

    return resolved;
}

/**
 * Resolve task ID from explicit value or output path hint.
 */
export function resolveTaskId(explicitTaskId: unknown, outputPathHint: unknown): string | null {
    if (explicitTaskId && String(explicitTaskId).trim()) {
        return String(explicitTaskId).trim();
    }
    if (!outputPathHint || !String(outputPathHint).trim()) {
        return null;
    }
    const baseName = path.basename(String(outputPathHint), path.extname(String(outputPathHint)));
    const candidate = baseName.replace(/-preflight$/, '').trim();
    return candidate || null;
}

/**
 * Parse boolean-like values, matching Python/PS parse_bool.
 */
export function parseBool(value: unknown, defaultValue = false): boolean {
    if (value == null) return !!defaultValue;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(text)) return true;
    if (BOOLEAN_FALSE_VALUES.includes(text)) return false;
    return !!defaultValue;
}

/**
 * SHA-256 hash of a string.
 */
export function stringSha256(value: unknown): string | null {
    if (value == null) return null;
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toLowerCase();
}

/**
 * SHA-256 hash of a file.
 */
export function fileSha256(filePath: string): string | null {
    if (!filePath) return null;
    try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
        const content = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(content).digest('hex').toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Count non-empty lines in a file.
 */
export function countFileLines(filePath: string): number {
    try {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return 0;
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n').filter(line => line.trimEnd() !== '').length;
    } catch {
        return 0;
    }
}

/**
 * Normalize root prefixes: ensure trailing /, deduplicate, sort.
 */
export function normalizeRootPrefixes(prefixes: unknown[] | null | undefined): string[] {
    const set = new Set<string>();
    for (const prefix of (prefixes || [])) {
        let value = normalizePath(prefix);
        if (!value) continue;
        if (!value.endsWith('/')) value += '/';
        set.add(value);
    }
    return [...set].sort();
}

/**
 * Test if a path starts with any of the given prefixes (case-insensitive).
 */
export function testPathPrefix(pathValue: string, prefixes: string[]): boolean {
    const lower = pathValue.toLowerCase();
    for (const prefix of prefixes) {
        if (lower.startsWith(prefix.toLowerCase())) return true;
    }
    return false;
}

/**
 * Append a JSON line to a metrics file.
 */
export function appendMetricsEvent(metricsPath: string, eventObject: Record<string, unknown>, emitMetrics: boolean): void {
    if (!emitMetrics || !metricsPath) return;
    try {
        fs.mkdirSync(path.dirname(String(metricsPath)), { recursive: true });
        fs.appendFileSync(String(metricsPath), JSON.stringify(eventObject) + '\n', 'utf8');
    } catch {
        // metrics are best-effort
    }
}

/**
 * Convert value(s) to a flat string array, matching gate_utils.to_string_array.
 */
export function toStringArray(value: unknown, options: ToStringArrayOptions = {}): string[] {
    const trimValues = options.trimValues || false;
    if (value == null) return [];
    if (typeof value === 'string') {
        const text = trimValues ? value.trim() : value;
        return (text && text.trim()) ? [text] : [];
    }
    if (Array.isArray(value)) {
        const result = [];
        for (const item of value) {
            if (item == null) continue;
            let text = String(item);
            if (trimValues) text = text.trim();
            if (!text || !text.trim()) continue;
            result.push(text);
        }
        return result;
    }
    const text = trimValues ? String(value).trim() : String(value);
    return (text && text.trim()) ? [text] : [];
}

/**
 * Resolve git root from a repo root.
 */
export function resolveGitRoot(repoRoot: string): string {
    const resolved = path.resolve(repoRoot);
    if (fs.existsSync(path.join(resolved, '.git'))) return resolved;
    const bundleCandidate = path.resolve(resolved, DEFAULT_BUNDLE_NAME);
    if (fs.existsSync(path.join(bundleCandidate, '.git'))) return bundleCandidate;
    return resolved;
}
