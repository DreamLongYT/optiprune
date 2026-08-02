import fs from 'node:fs';
import path from 'pathe';
import { parseFile } from '@swc/core';
import * as yaml from 'js-yaml';
import { readJsonFile } from './fs-utils.js';
import type { AnalysisContext, Finding, ModuleRecord } from './types.js';

export interface DtsExportGraph {
  filePath: string;
  exportedTypes: Set<string>;
  hasModuleAugmentation: boolean;
}

export interface DependencyNode {
  name: string;
  version: string;
  dependencies: Set<string>;
}

/**
 * Parses a library's entry point `.d.ts` file using SWC.
 * Handles Windows & POSIX paths natively.
 */
export async function parseDtsWithSwc(entryPointRelative: string): Promise<DtsExportGraph> {
  const absolutePath = path.resolve(entryPointRelative);

  if (!fs.existsSync(absolutePath)) {
    return { filePath: absolutePath, exportedTypes: new Set(), hasModuleAugmentation: false };
  }

  const moduleAst = await parseFile(absolutePath, {
    syntax: 'typescript',
    dts: true,
  } as any);

  const exportedTypes = new Set<string>();
  let hasModuleAugmentation = false;

  for (const item of (moduleAst as any).body as any[]) {
    if (item.type === 'ExportDeclaration') {
      if (item.declaration && 'identifier' in item.declaration) {
        exportedTypes.add((item.declaration.identifier as any).value);
      }
    } else if (item.type === 'ExportNamedDeclaration') {
      for (const spec of item.specifiers) {
        if (spec.type === 'ExportSpecifier') {
          exportedTypes.add(spec.exported?.value || spec.orig.value);
        }
      }
    }

    if (item.type === 'TsModuleDeclaration') {
      hasModuleAugmentation = true;
    }
  }

  return {
    filePath: absolutePath,
    exportedTypes,
    hasModuleAugmentation,
  };
}

/**
 * Fast-path topology extraction from lockfiles.
 */
export function buildLockfileGraph(projectRoot: string): Map<string, DependencyNode> {
  const graph = new Map<string, DependencyNode>();
  const pnpmLockPath = path.join(projectRoot, 'pnpm-lock.yaml');
  const packageLockPath = path.join(projectRoot, 'package-lock.json');

  if (fs.existsSync(packageLockPath)) {
    try {
      const raw = fs.readFileSync(packageLockPath, 'utf-8');
      const cleanRaw = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
      const parsed = JSON.parse(cleanRaw);
      const packages = parsed.packages || {};

      for (const [pkgPath, meta] of Object.entries<any>(packages)) {
        if (!pkgPath) continue;
        
        const cleanName = pkgPath.replace(/^node_modules\//, '');
        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {}))
        );

        graph.set(cleanName, {
          name: cleanName,
          version: meta.version || 'unknown',
          dependencies: deps,
        });
      }
    } catch (e) {
      // Ignore lockfile parse errors
    }
  } else if (fs.existsSync(pnpmLockPath)) {
    try {
      const raw = fs.readFileSync(pnpmLockPath, 'utf-8');
      const parsed = yaml.load(raw) as any;
      const snapshots = parsed.snapshots || {};

      for (const [pkgId, meta] of Object.entries<any>(snapshots)) {
        const nameMatch = pkgId.match(/^\/(@?[^@]+)/);
        const cleanName = (nameMatch ? nameMatch[1] : pkgId) as string;
        
        const deps = new Set<string>(
          Object.keys(meta.dependencies || {}).concat(Object.keys(meta.peerDependencies || {}))
        );

        graph.set(cleanName, {
          name: cleanName,
          version: 'pnpm-managed',
          dependencies: deps,
        });
      }
    } catch (e) {
      // Ignore lockfile parse errors
    }
  }

  return graph;
}

/**
 * Layer 6: Dependency & Boundary Engine
 * Audits package usage and refines Layer 5 protections.
 */
export async function analyzeLayer6(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const projectRoot = context.options.rootDir;
  
  // 1. Audit declared dependencies vs imported ones
  const lockfileGraph = buildLockfileGraph(projectRoot);
  const importedPackages = new Set<string>();
  
  for (const module of context.modules.values()) {
    for (const edge of module.edges) {
      if (edge.resolution === 'external') {
        const parts = edge.rawSpecifier.split('/');
        const pkgName = edge.rawSpecifier.startsWith('@') ? `${parts[0] ?? ''}/${parts[1] ?? ''}` : (parts[0] ?? '');
        importedPackages.add(pkgName);
      } else if (edge.resolution === 'resolved' && edge.target && context.options.monorepo) {
        for (const [pkgName, pkg] of context.options.monorepo.packageMap.entries()) {
          if (edge.target.startsWith(pkg.location + '/') || edge.target === pkg.location) {
            importedPackages.add(pkgName);
            break;
          }
        }
      }
    }
  }

  // Find unused direct dependencies from all package.json files
  const manifestPaths = [path.join(projectRoot, 'package.json')];
  if (context.options.monorepo) {
    for (const pkg of context.options.monorepo.packageMap.values()) {
      manifestPaths.push(pkg.manifestPath);
    }
  }

  for (const manifestPath of manifestPaths) {
    if (fs.existsSync(manifestPath)) {
      const pkg = await readJsonFile<Record<string, any>>(manifestPath);
      if (!pkg) continue;

      const declaredDeps = Object.keys(pkg.dependencies || {});
      const relativeManifest = path.posix.relative(projectRoot, manifestPath);
      
      for (const dep of declaredDeps) {
        if (!importedPackages.has(dep)) {
          findings.push({
            rule: 'unused-export',
            severity: 'warning',
            confidence: 'high',
            message: `Package '${dep}' is declared in ${relativeManifest} but never imported in /src.`,
            file: relativeManifest,
            evidence: { package: dep }
          });
        }
      }
    }
  }

  // 2. Refine Layer 5 Protection
  for (const module of context.modules.values()) {
    const isReachable = context.reachable.has(module.id) || context.maybeReachable.has(module.id);
    if (!isReachable) {
      for (const exp of module.exports) {
        if (exp.isExternalContract) {
          findings.push({
            rule: 'protected-contract',
            severity: 'info',
            confidence: 'high',
            message: `[Layer 6] Revoked protection for unreferenced contract: ${exp.exportedAs} (File is unreachable).`,
            file: module.relativePath,
            ...(exp.location !== undefined && { location: exp.location }),
            evidence: { symbol: exp.exportedAs, reason: 'unreachable-file' }
          });
          exp.isExternalContract = false;
        }
      }
    }
  }

  return findings;
}