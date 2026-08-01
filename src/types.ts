export type Confidence = "high" | "medium" | "low" | "info";
export type Severity = "error" | "warning" | "info";
export type ParseStatus = "parsed" | "recovered" | "fallback";
export type EdgeKind =
  | "import"
  | "export-from"
  | "export-all"
  | "require"
  | "dynamic-literal"
  | "dynamic-pattern"
  | "unknown-dynamic";

export interface Position {
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface ParseDiagnostic {
  message: string;
  file: string;
  location?: Range;
  recovered: boolean;
}

export interface ExportRecord {
  name: string;
  exportedAs: string;
  location?: Range;
  isDefault: boolean;
  isReExport: boolean;
  isWildcard: boolean;
  isTypeOnly?: boolean;
  isExternalContract?: boolean; // Added for Layer 5: Schema Alignment
}

export interface DependencyEdge {
  source: string;
  rawSpecifier: string;
  kind: EdgeKind;
  target?: string;
  location?: Range;
  importedNames: string[];
  dynamicPattern?: DynamicPattern;
  resolution: "resolved" | "unresolved" | "external" | "unknown";
  isTypeOnly?: boolean;
}

export interface DynamicPattern {
  prefix: string;
  suffix: string;
  baseDirectory: string;
  candidates: string[];
}

export interface ModuleRecord {
  id: string;
  relativePath: string;
  parseStatus: ParseStatus;
  parseDiagnostics: ParseDiagnostic[];
  ast?: unknown;
  sourceText: string;
  exports: ExportRecord[];
  edges: DependencyEdge[];
  hasUnknownDynamicBoundary: boolean;
  hasUnresolvedCommonJsExports: boolean;
}

export interface WorkspacePackage {
  name: string;
  location: string;
  relativePath: string;
  manifestPath: string;
  dependencies: Set<string>;
  allDependencies: Set<string>;
}

export interface MonorepoGraph {
  rootPath: string;
  packageMap: Map<string, WorkspacePackage>;
  topologicalOrder: string[];
}

export interface StronglyConnectedComponent {
  id: number;
  modules: string[];
  isCycle: boolean;
}

export interface ConcolicVerificationResult {
  pathReached: boolean;
  executionTimeMs: number;
  logs: string[];
}

export interface CandidateBranch {
  file: string;
  line: number;
  instrumentedCode: string;
  seedInput: Record<string, any>;
}

export interface Finding {
  rule:
    | "unreachable-file"
    | "unused-export"
    | "unreachable-statement"
    | "constant-condition"
    | "contradictory-guard"
    | "schema-impossible-guard"
    | "parse-recovery"
    | "unresolved-import"
    | "unknown-dynamic-import"
    | "no-entry-points"
    | "unreachable-dynamic-path"
    | "protected-contract";
  severity: Severity;
  confidence: Confidence;
  message: string;
  file: string;
  location?: Range | undefined;
  evidence: Record<string, unknown>;
}

export interface AnalyzerOptions {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  reportUnusedExports?: boolean;
  schemaEnums?: Record<string, string[]>;
  externalContracts?: string[]; // Added for Layer 5: list of externally consumed symbol names
  failOn?: "high" | "medium" | "low" | "none";
  json?: boolean;
  includeConventionalEntries?: boolean;
}

export type RuleSeverity = "error" | "warning" | "off";

export interface Config {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  externalContracts?: string[];
  reportUnusedExports?: boolean;
  includeConventionalEntries?: boolean;
  failOn?: Confidence;
  json?: boolean;
  layers?: {
    smtTimeoutMs?: number;
    isolateMemoryLimitMb?: number;
    enableConcolicProof?: boolean;
  };
  rules?: Record<string, RuleSeverity>;
}

export interface ResolvedOptions {
  rootDir: string;
  entry: string[];
  extensions: string[];
  ignore: string[];
  reportUnusedExports: boolean;
  schemaEnums: Record<string, string[]>;
  failOn: Confidence;
  json: boolean;
  includeConventionalEntries: boolean;
  monorepo?: MonorepoGraph;
  externalContracts: string[];
  layers: {
    smtTimeoutMs: number;
    isolateMemoryLimitMb: number;
    enableConcolicProof: boolean;
  };
  rules: Record<string, RuleSeverity>;
}

export interface AnalysisSummary {
  filesDiscovered: number;
  filesParsed: number;
  filesRecovered: number;
  filesFallback: number;
  edges: number;
  entryPoints: number;
  stronglyConnectedComponents: number;
  cycles: number;
  findings: number;
  errors: number;
  warnings: number;
}

export interface AnalysisReport {
  version: string;
  rootDir: string;
  entryPoints: string[];
  summary: AnalysisSummary;
  findings: Finding[];
  modules: Array<{
    path: string;
    parseStatus: ParseStatus;
    exports: Array<{
      name: string;
      exportedAs: string;
      isDefault: boolean;
      isReExport: boolean;
      isWildcard: boolean;
      isTypeOnly?: boolean;
      isExternalContract?: boolean;
    }>;
    edges: Array<{
      kind: EdgeKind;
      specifier: string;
      target?: string;
      resolution: DependencyEdge["resolution"];
    }>;
  }>;
  components: Array<{
    id: number;
    modules: string[];
    isCycle: boolean;
  }>;
}

export interface AnalysisContext {
  options: ResolvedOptions;
  modules: Map<string, ModuleRecord>;
  entryPoints: Set<string>;
  reachable: Set<string>;
  maybeReachable: Set<string>;
  components: StronglyConnectedComponent[];
  usedExports: Set<string>;
  candidateBranches: CandidateBranch[];
  monorepo?: MonorepoGraph;
  semanticGraph?: any; // SemanticGraph instance
  symbolicContracts?: Map<string, any>;
}

export interface AnalyzerPlugin {
  name: string;
  analyze(context: AnalysisContext): Finding[];
}

export const CONFIDENCE_RANK: Record<Confidence | "none", number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  none: -1, // A value for 'none' to allow comparison
};

export function defineConfig(config: Config): Config {
  return config;
}
