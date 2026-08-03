import { promises as fs } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { parseModule, walkAst } from "./parser.js";
import { buildGraph, contextWithGraph, buildImportUsage } from "./graph.js";
import { analyzeLayer2 } from "./layer2.js";
import { analyzeLayer3 } from "./layer3.js";
import { analyzeLayer4 } from "./layer4.js";
import { analyzeLayer5 } from "./layer5.js";
import { analyzeLayer6 } from "./layer6.js";
import { analyzeLayer7 } from "./layer7.js";
import { SemanticGraph } from "./semantic-graph.js";
import { TopologyManager } from "./topology-manager.js";
import { SymbolicEngine } from "./symbolic-engine.js";
import { buildMonorepoTopology } from "./workspace.js";
import { PluginEngine, ZodPlugin } from "./engine.js";
import { ReactPlugin, NextjsPlugin, NuxtPlugin } from "./framework-plugins.js";
import { loadCache, saveCache, getFileHash, isCacheValid } from "./cache.js";
import { formatTerminal, formatSarif } from "./reporters.js";
import {
  compileGlobs,
  conventionalEntryPatterns,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  discoverPackageEntryPatterns,
  discoverSourceFiles,
  expandEntryPatterns,
  ingestTsConfigPaths,
  normalizeAbsolute,
  readJsonFile,
  relativeDisplayPath,
  rootLooksValid,
} from "./fs-utils.js";
import type {
  AnalysisContext,
  AnalyzerOptions,
  AnalysisReport,
  AnalysisSummary,
  Finding,
  ModuleRecord,
  ResolvedOptions,
} from "./types.js";
import { CONFIDENCE_RANK } from "./types.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (await readJsonFile(path.join(__dirname, "..", "package.json"))) as { version?: string } | null;
const VERSION = pkg?.version ?? "1.8.2";

import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config-loader.js";

async function resolveOptions(options: AnalyzerOptions): Promise<ResolvedOptions> {
  const rootDir = normalizeAbsolute(options.rootDir ?? process.cwd());
  const userConfig = await loadConfig(rootDir);
  
  const merged = mergeConfig(DEFAULT_CONFIG, {
    ...userConfig,
    ...options,
    rootDir,
  } as import('./types.js').Config);

  // Map top-level skip flags from CLI/Options to layers object
  if (options.skip3 !== undefined) merged.layers.skip3 = options.skip3;
  if (options.skip4 !== undefined) merged.layers.skip4 = options.skip4;

  const { paths: pathAliases, baseUrl } = await ingestTsConfigPaths(rootDir);

  return {
    ...merged,
    entry: merged.entry?.map((entry) => normalizeAbsolute(path.resolve(rootDir, entry))) ?? [],
    ignore: [...DEFAULT_IGNORE, ...(merged.ignore ?? [])],
    pathAliases,
    baseUrl,
  } as ResolvedOptions;
}

export async function analyze(options: AnalyzerOptions): Promise<AnalysisReport> {
  const resolvedOptions = await resolveOptions(options);
  const cache = loadCache(resolvedOptions.rootDir);
  const newCache = { version: "1.0", entries: {} as any };
  
  // Phase 1: Core Graph & AST (Instant)
  
  // Discover Monorepo Topology
  let hasMonorepo = false;
  try {
    resolvedOptions.monorepo = await buildMonorepoTopology(resolvedOptions.rootDir);
    hasMonorepo = !!resolvedOptions.monorepo;
  } catch (e) {
    // console.error(`[Monorepo] Discovery failed: ${e}`);
  }

  const { rootDir, extensions, ignore, entry, includeConventionalEntries } = resolvedOptions;
  const compiledIgnorePatterns = compileGlobs(ignore);

  if (!(await rootLooksValid(rootDir))) {
    throw new Error(`Root directory does not exist: ${rootDir}`);
  }

  const allSourceFiles = await discoverSourceFiles(rootDir, extensions, compiledIgnorePatterns);
  const modules = new Map<string, ModuleRecord>();
  const semanticGraph = new SemanticGraph();
  const topologyManager = new TopologyManager(semanticGraph);
  const symbolicEngine = new SymbolicEngine(semanticGraph);

  let filesParsed = 0;
  let filesRecovered = 0;
  let filesFallback = 0;
  let hasFrameworkNodes = false;

  for (const file of allSourceFiles) {
    let rawText: string;
    try {
      // BOM-safe file reader to prevent Babel/TS AST parse recovery warnings
      rawText = await fs.readFile(file, "utf8");
    } catch (e: any) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const sourceText = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;

    const currentHash = getFileHash(sourceText);
    
    let moduleRecord: ModuleRecord;
    const cached = cache.entries[file];
    
    if (cached && isCacheValid(cached, sourceText)) {
      moduleRecord = cached.moduleRecord;
      newCache.entries[file] = cached;
    } else {
      moduleRecord = parseModule(sourceText, file);
      newCache.entries[file] = {
        hash: currentHash,
        moduleRecord,
        timestamp: Date.now()
      };
    }
    
    modules.set(file, moduleRecord);
    
    if (moduleRecord.parseStatus === "parsed") {
      filesParsed += 1;
      // Quick framework detection for Layer 5 gating
      // ✅ FIXED FRAMEWORK DETECTION
      if (!hasFrameworkNodes && moduleRecord.ast) {
        walkAst(moduleRecord.ast, (rawNode) => {
          const node = rawNode as any;
          const isDecorator = !!node.decorators || (Array.isArray(node.modifiers) && node.modifiers.some((m: any) => m.type === 'Decorator' || m.kind === 'Decorator'));
          const isZodCall = node.type === "CallExpression" && (
            (node.callee?.type === "MemberExpression" && (node.callee.object?.name === "z" || node.callee.object?.name === "zod")) ||
            (node.callee?.type === "Identifier" && (node.callee.name === "z" || node.callee.name.startsWith("zod")))
          );

          if (isDecorator || isZodCall) {
            hasFrameworkNodes = true;
            return true;
          }
        });
      }
    } else if (moduleRecord.parseStatus === "recovered") {
      filesRecovered += 1;
    } else {
      filesFallback += 1;
    }
  }
  
  saveCache(resolvedOptions.rootDir, newCache);

let entryPoints = new Set<string>();
  if (entry.length > 0) {
    for (const pattern of entry) {
      const expanded = expandEntryPatterns(allSourceFiles, rootDir, [pattern]);
      for (const e of expanded) {
        entryPoints.add(path.normalize(e));
      }
    }
  }

  const publicEntryPoints = new Set<string>();
  if (includeConventionalEntries) {
    const rootPackageEntries = await discoverPackageEntryPatterns(rootDir);
    for (const pattern of [...rootPackageEntries, ...conventionalEntryPatterns()]) {
      for (const expanded of expandEntryPatterns(allSourceFiles, rootDir, [pattern])) {
        entryPoints.add(path.normalize(expanded));
      }
    }

    // In a monorepo, we do NOT add all workspace entry points to the reachability 'entryPoints'.
    // Instead, they are added to 'publicEntryPoints' to protect their exports, 
    // but their files are only 'reachable' if imported by a root entry point or another reachable workspace.
    if (resolvedOptions.monorepo) {
      for (const pkg of resolvedOptions.monorepo.packageMap.values()) {
        const pkgEntries = await discoverPackageEntryPatterns(pkg.location);
        for (const pattern of [...pkgEntries, ...conventionalEntryPatterns()]) {
          const relativeToRoot = path.posix.relative(rootDir, pkg.location);
          const adjustedPattern = pattern.startsWith('/') ? pattern : path.posix.join(relativeToRoot, pattern);
          for (const expanded of expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern])) {
            // Only add to publicEntryPoints, NOT to reachability entryPoints
            publicEntryPoints.add(path.normalize(expanded));
          }
        }
      }
    }
  }

  const findings: Finding[] = [];

  if (entryPoints.size === 0) {
    findings.push({
      rule: "no-entry-points",
      severity: "warning",
      confidence: "info",
      message: "No entry points found or configured. All files will be considered unreachable.",
      file: rootDir,
      evidence: {},
    });
  }

  if (includeConventionalEntries) {
    const rawPackageEntries = await discoverPackageEntryPatterns(rootDir);
    const rootPackageEntries = rawPackageEntries.flatMap(entry => {
      // If the entry points to dist/, also look for the corresponding src/ file
      if (entry.startsWith('dist/')) {
        const srcEntry = entry.replace('dist/', 'src/').replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
        return [entry, srcEntry];
      }
      return [entry];
    });

    // Include both package.json entries and conventional entries (index, main, cli, etc.)
    for (const pattern of [...rootPackageEntries, ...conventionalEntryPatterns()]) {
      for (const expanded of expandEntryPatterns(allSourceFiles, rootDir, [pattern])) {
        publicEntryPoints.add(path.normalize(expanded));
      }
    }
  }

  const context = contextWithGraph(modules, entryPoints, resolvedOptions);
  (context as any).publicEntryPoints = publicEntryPoints;
  context.semanticGraph = semanticGraph;
  context.symbolicContracts = new Map();

  // Gated Layer 2: Plugin-based Instruction Engine (Hardening)
  const pluginEngine = new PluginEngine();
  pluginEngine.register(ZodPlugin);
  pluginEngine.register(ReactPlugin);
  pluginEngine.register(NextjsPlugin);
  pluginEngine.register(NuxtPlugin);
  const pluginFindings = await pluginEngine.run(context);
  findings.push(...pluginFindings);

  // Headless Living Graph Engine: Initial Ingestion
  for (const module of modules.values()) {
    // In a full implementation, we would extract semantic nodes from the AST here.
    // For now, we create a representative FileNode.
    const fileNode = {
      id: SemanticGraph.generateLei(module.id, 'File'),
      contentHash: SemanticGraph.generateContentHash(module.sourceText),
      type: 'File' as const,
      name: module.id,
      fileId: module.id,
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    };
    semanticGraph.addNode(fileNode);
  }

  // Gated Layer 5: Schema Alignment
  if (hasFrameworkNodes || resolvedOptions.externalContracts?.length) {
    await analyzeLayer5(context);
  }
  
  // Gated Layer 6: Dependency & Boundary Engine
  if (hasMonorepo || allSourceFiles.some(f => f.endsWith('.d.ts'))) {
    const layer6Findings = await analyzeLayer6(context);
    findings.push(...layer6Findings);
  }

  for (const module of modules.values()) {
    for (const diagnostic of module.parseDiagnostics) {
      findings.push({
        rule: "parse-recovery",
        severity: diagnostic.recovered ? "info" : "error",
        confidence: diagnostic.recovered ? "low" : "high",
        message: "Parse " + (diagnostic.recovered ? "recovered with errors" : "failed") + ": " + diagnostic.message,
        file: diagnostic.file,
        ...(diagnostic.location && { location: diagnostic.location }),
        evidence: {},
      });
    }

    for (const edge of module.edges) {
      if (edge.resolution === "unresolved") {
        findings.push({
          rule: "unresolved-import",
          severity: "warning",
          confidence: "high",
          message: "Unresolved import specifier: '" + edge.rawSpecifier + "'",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
      if (edge.kind === "unknown-dynamic") {
        findings.push({
          rule: "unknown-dynamic-import",
          severity: "warning",
          confidence: "medium",
          message: "Unknown dynamic import pattern: '" + edge.rawSpecifier + "'. This may hide reachable code.",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
    }
  }

  // Layer 2: Control Flow Graph (CFG)
  const layer2Findings = analyzeLayer2(context);
  findings.push(...layer2Findings);

  // Phase 2: Layer 3 (Conditional Z3 SMT)
  if (!resolvedOptions.layers.skip3) {
    const layer3Findings = await analyzeLayer3(context);
    findings.push(...layer3Findings);
  }
  
  // Phase 3: Layer 4 (node:vm sandbox)
  if (!resolvedOptions.layers.skip4) {
    const layer4Findings = await analyzeLayer4(context);
    findings.push(...layer4Findings);
  }
  
  // Phase 4: Layer 7 (Non-Standard Entry & Implicit Binding Engine)
  const layer7Findings = await analyzeLayer7(context);
  findings.push(...layer7Findings);

  // Phase 5: Headless Living Graph Engine (Symbolic Evaluation)
  const symbolicFindings = await symbolicEngine.evaluateContracts(context);
  findings.push(...symbolicFindings);

  // Final Reporting Phase: Unused Exports & Unreachable Files
  // We do this at the end so all layers (Layer 4, 7, etc.) have a chance to refine reachability and usage.
  if (resolvedOptions.reportUnusedExports) {
    const importUsage = buildImportUsage(modules);
    for (const module of modules.values()) {
      if (context.reachable.has(module.id) || context.maybeReachable.has(module.id)) {
        for (const exp of module.exports) {
          if (exp.isExternalContract) continue;
          if ((context as any).publicEntryPoints?.has(module.id)) continue;

          const isExportUsed = context.usedExports.has(`${module.id}:${exp.exportedAs}`);
          
          let confidence: import('./types.js').Confidence = "high";
          if (context.maybeReachable.has(module.id)) confidence = "medium";
          if (context.hasReachableUnknownDynamicBoundary) confidence = "low";

          if (context.hasReachableUnknownDynamicBoundary && isExportUsed) continue;
          
          let isEffectivelyUsed = isExportUsed;
          if (isExportUsed) {
            const usage = importUsage.get(module.id);
            if (usage && usage.reExportOnly) {
              const hasRealConsumer = Array.from(usage.consumers).some(c => {
                const cUsage = importUsage.get(c);
                return context.entryPoints.has(c) || (cUsage && !cUsage.reExportOnly);
              });
              if (!hasRealConsumer) {
                isEffectivelyUsed = false;
              }
            }
          }

          if (!isEffectivelyUsed && exp.exportedAs !== "default") {
            findings.push({
              rule: "unused-export",
              severity: "warning",
              confidence: confidence,
              message: "Export '" + exp.exportedAs + "' is never imported or referenced.",
              file: module.id,
              ...(exp.location && { location: exp.location }),
              evidence: { exportName: exp.exportedAs },
            });
          }
        }
      }
    }
  }

  for (const module of modules.values()) {
    if (!context.reachable.has(module.id) && !context.maybeReachable.has(module.id)) {
      const fileComponent = context.components.find((c) => c.modules.includes(module.id));
      findings.push({
        rule: "unreachable-file",
        severity: "warning",
        confidence: module.hasUnknownDynamicBoundary ? "medium" : "high",
        message: fileComponent?.isCycle
          ? "File is part of an isolated circular dependency cycle (" + fileComponent.id + ") and is unreachable from entry points."
          : "File is not reachable from any entry point.",
        file: module.id,
        evidence: {
          entryPoints: [...context.entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
          componentId: fileComponent?.id,
          cycleSize: fileComponent?.modules.length,
        },
      });
    }
  }

  const summary: AnalysisSummary = {
    filesDiscovered: allSourceFiles.length,
    filesParsed,
    filesRecovered,
    filesFallback,
    edges: [...modules.values()].reduce((sum, module) => sum + module.edges.length, 0),
    entryPoints: entryPoints.size,
    stronglyConnectedComponents: context.components.length,
    cycles: context.components.filter((c) => c.isCycle).length,
    findings: findings.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };

  return {
    version: VERSION,
    rootDir,
    entryPoints: [...entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
    summary,
    findings: findings.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.location && b.location) {
        if (a.location.start.line !== b.location.start.line) return a.location.start.line - b.location.start.line;
        return a.location.start.column - b.location.start.column;
      }
      return 0;
    }),
    modules: [...modules.values()].map((module) => ({
      path: relativeDisplayPath(rootDir, module.id),
      parseStatus: module.parseStatus,
      exports: module.exports.map((e) => ({
        name: e.name,
        exportedAs: e.exportedAs,
        isDefault: e.isDefault,
        isReExport: e.isReExport,
        isWildcard: e.isWildcard,
        isTypeOnly: e.isTypeOnly ?? false,
        isExternalContract: e.isExternalContract ?? false,
      })),
      edges: module.edges.map((edge) => ({
        kind: edge.kind,
        specifier: edge.rawSpecifier,
        ...(edge.target && { target: relativeDisplayPath(rootDir, edge.target) }),
        resolution: edge.resolution,
      })),
    })),
    components: context.components.map((c) => ({
      id: c.id,
      modules: c.modules.map((m) => relativeDisplayPath(rootDir, m)),
      isCycle: c.isCycle,
    })),
  };
}

export function shouldFail(report: AnalysisReport, failOn: ResolvedOptions["failOn"]): boolean {
  if (failOn === "none") {
    return false;
  }

  const failThreshold = CONFIDENCE_RANK[failOn];
  return report.findings.some((f) => CONFIDENCE_RANK[f.confidence] >= failThreshold);
}
