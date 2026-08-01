import { parse } from "@babel/parser";
import type {
  DependencyEdge,
  ExportRecord,
  ModuleRecord,
  ParseDiagnostic,
  Position,
  Range,
} from "./types.js";

interface AstNode {
  type?: string;
  start?: number;
  end?: number;
  loc?: {
    start?: Position;
    end?: Position;
  };
  [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return value !== null && typeof value === "object" && typeof (value as AstNode).type === "string";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function positionRange(node: AstNode | undefined): Range | undefined {
  const start = node?.loc?.start;
  const end = node?.loc?.end;
  if (!start || !end) {
    return undefined;
  }
  return {
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
  };
}

function locationAtOffset(source: string, offset: number): Range {
  const before = source.slice(0, Math.max(0, offset));
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  const column = lastNewline === -1 ? before.length : before.length - lastNewline - 1;
  return {
    start: { line, column },
    end: { line, column: column + 1 },
  };
}

function nodeStringValue(node: unknown): string | undefined {
  if (!isNode(node)) {
    return undefined;
  }
  if ((node.type === "StringLiteral" || node.type === "Literal") && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function nodeIdentifierName(node: unknown): string | undefined {
  if (!isNode(node)) {
    return undefined;
  }
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  return undefined;
}

function propertyKeyName(node: unknown): string | undefined {
  if (!isNode(node)) {
    return undefined;
  }
  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }
  if ((node.type === "StringLiteral" || node.type === "NumericLiteral" || node.type === "Literal") && node.value !== undefined) {
    return String(node.value);
  }
  return undefined;
}

function bindingNames(node: unknown): string[] {
  if (!isNode(node)) {
    return [];
  }
  if (node.type === "Identifier") {
    return typeof node.name === "string" ? [node.name] : [];
  }
  if (node.type === "ObjectPattern") {
    return asArray(node.properties).flatMap((property) => {
      if (!isNode(property)) {
        return [];
      }
      if (property.type === "RestElement") {
        return bindingNames(property.argument);
      }
      return bindingNames(property.value);
    });
  }
  if (node.type === "ArrayPattern") {
    return asArray(node.elements).flatMap((element) => bindingNames(element));
  }
  if (node.type === "RestElement" || node.type === "AssignmentPattern") {
    return bindingNames(node.left ?? node.argument);
  }
  return [];
}

function addExport(
  exportsList: ExportRecord[],
  exportedAs: string,
  node: AstNode,
  identifierNode?: AstNode,
  options: Partial<Pick<ExportRecord, "name" | "isDefault" | "isReExport" | "isWildcard" | "isTypeOnly">> = {},
): void {
  const candidate: ExportRecord = {
    name: options.name ?? exportedAs,
    exportedAs,
    isDefault: options.isDefault ?? false,
    isReExport: options.isReExport ?? false,
    isWildcard: options.isWildcard ?? false,
    isTypeOnly: options.isTypeOnly ?? false,
  };
  // Use precise identifier node location if provided, otherwise default to full node
  const location = positionRange(identifierNode) ?? positionRange(node);
  if (location) {
    candidate.location = location;
  }
  if (!exportsList.some((item) => item.exportedAs === candidate.exportedAs && item.name === candidate.name)) {
    exportsList.push(candidate);
  }
}

function addEdge(
  edges: DependencyEdge[],
  sourceFile: string,
  rawSpecifier: string,
  kind: DependencyEdge["kind"],
  node: AstNode,
  importedNames: string[] = [],
  isTypeOnly: boolean = false,
): void {
  const edge: DependencyEdge = {
    source: sourceFile,
    rawSpecifier,
    kind,
    importedNames,
    resolution: "unknown",
    isTypeOnly,
  };
  const location = positionRange(node);
  if (location) {
    edge.location = location;
  }
  edges.push(edge);
}

function importSpecifierNames(specifiers: unknown[]): string[] {
  const names: string[] = [];
  for (const specifier of specifiers) {
    if (!isNode(specifier)) {
      continue;
    }
    if (specifier.type === "ImportDefaultSpecifier") {
      names.push("default");
    } else if (specifier.type === "ImportNamespaceSpecifier") {
      names.push("*");
    } else if (specifier.type === "ImportSpecifier") {
      names.push(propertyKeyName(specifier.imported) ?? "*");
    }
  }
  return names;
}

function exportSpecifierNames(specifiers: unknown[]): string[] {
  const names: string[] = [];
  for (const specifier of specifiers) {
    if (isNode(specifier)) {
      names.push(propertyKeyName(specifier.exported) ?? "*");
    }
  }
  return names;
}

function isRequireCall(node: AstNode): boolean {
  return node.type === "CallExpression" && nodeIdentifierName(node.callee) === "require";
}

function isDynamicImportCall(node: AstNode): boolean {
  return (
    node.type === "ImportExpression" ||
    (node.type === "CallExpression" && isNode(node.callee) && node.callee.type === "Import")
  );
}

function dynamicArgument(node: AstNode): unknown {
  if (node.type === "ImportExpression") {
    return node.source;
  }
  return asArray(node.arguments)[0];
}

function templateParts(node: unknown): { prefix: string; suffix: string } | undefined {
  if (!isNode(node) || node.type !== "TemplateLiteral") {
    return undefined;
  }
  const expressions = asArray(node.expressions);
  const quasis = asArray(node.quasis);
  if (expressions.length === 0 || quasis.length < 2) {
    return undefined;
  }
  const first = quasis[0];
  const last = quasis[quasis.length - 1];
  const firstValue = isNode(first) && isNode(first.value) && typeof first.value.cooked === "string" ? first.value.cooked : "";
  const lastValue = isNode(last) && isNode(last.value) && typeof last.value.cooked === "string" ? last.value.cooked : "";
  return { prefix: firstValue, suffix: lastValue };
}

function walk(node: unknown, visitor: (node: AstNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visitor);
    }
    return;
  }
  if (!isNode(node)) {
    return;
  }
  visitor(node);
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "tokens" ||
      key === "comments" ||
      key === "errors" ||
      key === "extra"
    ) {
      continue;
    }
    if (Array.isArray(value) || isNode(value)) {
      walk(value, visitor);
    }
  }
}

function extractAstModule(sourceText: string, file: string, ast: AstNode, parserErrors: unknown[]): ModuleRecord {
  const exportsList: ExportRecord[] = [];
  const edges: DependencyEdge[] = [];
  const parseDiagnostics: ParseDiagnostic[] = parserErrors.map((error) => {
    const candidate = error as { message?: unknown; loc?: { line?: unknown; column?: unknown } };
    const diagnostic: ParseDiagnostic = {
      message: typeof candidate.message === "string" ? candidate.message : "Recoverable parser error",
      file,
      recovered: true,
    };
    if (typeof candidate.loc?.line === "number" && typeof candidate.loc?.column === "number") {
      diagnostic.location = {
        start: { line: candidate.loc.line, column: candidate.loc.column },
        end: { line: candidate.loc.line, column: candidate.loc.column + 1 },
      };
    }
    return diagnostic;
  });
  let hasUnknownDynamicBoundary = false;
  let hasUnresolvedCommonJsExports = false;

  walk(ast, (node) => {
    if (node.type === "ImportDeclaration") {
      const specifier = nodeStringValue(node.source);
      if (specifier) {
        const isTypeOnly = node.importKind === "type";
        addEdge(edges, file, specifier, "import", node, importSpecifierNames(asArray(node.specifiers)), isTypeOnly);
      }
      return;
    }

    if (node.type === "ExportNamedDeclaration") {
      const specifier = nodeStringValue(node.source);
      if (specifier) {
        const names = exportSpecifierNames(asArray(node.specifiers));
        const isTypeOnly = node.exportKind === "type";
        addEdge(edges, file, specifier, "export-from", node, names, isTypeOnly);
        for (const exportedName of names) {
          addExport(exportsList, exportedName, node, undefined, { name: exportedName, isReExport: true, isTypeOnly: node.exportKind === "type" });
        }
      } else if (isNode(node.declaration)) {
        const declaration = node.declaration;
        if ((declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration" || declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSEnumDeclaration") && nodeIdentifierName(declaration.id)) {
          const isType = declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration" || node.exportKind === "type";
          addExport(exportsList, nodeIdentifierName(declaration.id) ?? "unknown", node, declaration.id as AstNode, { isTypeOnly: isType });
        } else if (declaration.type === "VariableDeclaration") {
          for (const declarator of asArray(declaration.declarations)) {
            if (isNode(declarator)) {
              for (const name of bindingNames(declarator.id)) {
                addExport(exportsList, name, node, declarator.id as AstNode, { isTypeOnly: node.exportKind === "type" });
              }
            }
          }
        }
      } else {
        for (const exportedName of exportSpecifierNames(asArray(node.specifiers))) {
          addExport(exportsList, exportedName, node, undefined, { isTypeOnly: node.exportKind === "type" });
        }
      }
      return;
    }

    if (node.type === "ExportDefaultDeclaration") {
      addExport(exportsList, "default", node, undefined, { name: "default", isDefault: true, isTypeOnly: node.exportKind === "type" });
      return;
    }

    if (node.type === "ExportAllDeclaration") {
      const specifier = nodeStringValue(node.source);
      if (specifier) {
        addEdge(edges, file, specifier, "export-all", node, ["*"], node.exportKind === "type");
        addExport(exportsList, "*", node, undefined, { name: "*", isReExport: true, isWildcard: true, isTypeOnly: node.exportKind === "type" });
      }
      return;
    }

    if (isRequireCall(node)) {
      const specifier = nodeStringValue(asArray(node.arguments)[0]);
      if (specifier) {
        addEdge(edges, file, specifier, "require", node, ["*"]);
      } else {
        hasUnknownDynamicBoundary = true;
      }
      return;
    }

    if (isDynamicImportCall(node)) {
      const argument = dynamicArgument(node);
      const literal = nodeStringValue(argument);
      if (literal) {
        addEdge(edges, file, literal, "dynamic-literal", node, ["*"]);
      } else {
        const parts = templateParts(argument);
        if (parts) {
          addEdge(edges, file, `${parts.prefix}${"${…}"}${parts.suffix}`, "dynamic-pattern", node, ["*"]);
        } else {
          hasUnknownDynamicBoundary = true;
          addEdge(edges, file, "<unknown dynamic import>", "unknown-dynamic", node, ["*"]);
        }
      }
      return;
    }

    if (node.type === "AssignmentExpression" && isNode(node.left) && node.left.type === "MemberExpression") {
      const objectName = nodeIdentifierName(node.left.object);
      const property = node.left.computed ? propertyKeyName(node.left.property) : nodeIdentifierName(node.left.property);
      if (objectName === "exports" && property) {
        addExport(exportsList, property, node);
      } else if (objectName === "exports") {
        hasUnresolvedCommonJsExports = true;
      } else if (objectName === "module" && property === "exports") {
        hasUnresolvedCommonJsExports = true;
      } else if (isNode(node.left.object) && node.left.object.type === "MemberExpression") {
        const moduleName = nodeIdentifierName(node.left.object.object);
        const moduleProperty = nodeIdentifierName(node.left.object.property);
        if (moduleName === "module" && moduleProperty === "exports" && property) {
          addExport(exportsList, property, node);
        }
      } else if ((node.left as any).name === "exports") {
        hasUnresolvedCommonJsExports = true;
      }
    }
  });

  const module: ModuleRecord = {
    id: file,
    relativePath: file,
    parseStatus: parserErrors.length > 0 ? "recovered" : "parsed",
    parseDiagnostics,
    ast,
    sourceText,
    exports: exportsList,
    edges,
    hasUnknownDynamicBoundary,
    hasUnresolvedCommonJsExports,
  };
  return module;
}

function fallbackExports(sourceText: string, file: string): ExportRecord[] {
  const found: ExportRecord[] = [];
  const regex = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)|\bexport\s+default\b|\bexport\s*\{([^}]+)\}/g;
  for (const match of sourceText.matchAll(regex)) {
    const location = locationAtOffset(sourceText, match.index ?? 0);
    if (match[1]) {
      found.push({ name: match[1], exportedAs: match[1], isDefault: false, isReExport: false, isWildcard: false, location });
    } else if (match[0].includes("export default")) {
      found.push({ name: "default", exportedAs: "default", isDefault: true, isReExport: false, isWildcard: false, location });
    } else if (match[2]) {
      for (const part of match[2].split(",")) {
        const exportedAs = part.trim().split(/\s+as\s+/i).at(-1)?.trim();
        if (exportedAs) {
          found.push({ name: exportedAs, exportedAs, isDefault: exportedAs === "default", isReExport: false, isWildcard: false, location });
        }
      }
    }
  }
  return found;
}

function fallbackEdges(sourceText: string, file: string): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const patterns: Array<{ regex: RegExp; kind: DependencyEdge["kind"] }> = [
    { regex: /\bimport\s+(?:[\w*$\s{},]+\s+from\s+)?["']([^"'\n]+)["']/g, kind: "import" },
    { regex: /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g, kind: "export-from" },
    { regex: /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g, kind: "require" },
    { regex: /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g, kind: "dynamic-literal" },
  ];
  for (const { regex, kind } of patterns) {
    for (const match of sourceText.matchAll(regex)) {
      const edge: DependencyEdge = {
        source: file,
        rawSpecifier: match[1] ?? "<unknown>",
        kind,
        importedNames: ["*"],
        resolution: "unknown",
        location: locationAtOffset(sourceText, match.index ?? 0),
      };
      edges.push(edge);
    }
  }
  for (const match of sourceText.matchAll(/\bimport\s*\(\s*`([^`]*)`\s*\)/g)) {
    const raw = match[1] ?? "";
    const expressionIndex = raw.indexOf("${");
    const closeIndex = raw.lastIndexOf("}");
    if (expressionIndex >= 0 && closeIndex > expressionIndex) {
      edges.push({
        source: file,
        rawSpecifier: `${raw.slice(0, expressionIndex)}${"${…}"}${raw.slice(closeIndex + 1)}`,
        kind: "dynamic-pattern",
        importedNames: ["*"],
        resolution: "unknown",
        location: locationAtOffset(sourceText, match.index ?? 0),
      });
    }
  }
  return edges;
}

function fallbackModule(sourceText: string, file: string, reason: unknown): ModuleRecord {
  const message = reason instanceof Error ? reason.message : "Parser could not recover this file";
  return {
    id: file,
    relativePath: file,
    parseStatus: "fallback",
    parseDiagnostics: [
      {
        message,
        file,
        recovered: false,
      },
    ],
    sourceText,
    exports: fallbackExports(sourceText, file),
    edges: fallbackEdges(sourceText, file),
    hasUnknownDynamicBoundary: /\b(?:import|require)\s*\(\s*(?!["'`])/.test(sourceText),
    hasUnresolvedCommonJsExports: /\bmodule\.exports\s*=|\bexports\s*\[/.test(sourceText),
  };
}

export function parseModule(sourceText: string, file: string): ModuleRecord {
  try {
    const parsed = parse(sourceText, {
      sourceType: "unambiguous",
      errorRecovery: true,
      attachComment: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      plugins: [
        "typescript",
        "jsx",
        ["decorators", { decoratorsBeforeExport: true }],
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "topLevelAwait",
        "dynamicImport",
        "importMeta",
        "optionalChaining",
        "nullishCoalescingOperator",
        "objectRestSpread",
        "numericSeparator",
        "logicalAssignment",
        "asyncGenerators",
        "exportDefaultFrom",
        "exportNamespaceFrom",
      ] as never,
    }) as unknown as AstNode & { errors?: unknown[] };
    return extractAstModule(sourceText, file, parsed, Array.isArray(parsed.errors) ? parsed.errors : []);
  } catch (error) {
    return fallbackModule(sourceText, file, error);
  }
}

export function getNodeRange(node: unknown): Range | undefined {
  return isNode(node) ? positionRange(node) : undefined;
}

export function getNodeType(node: unknown): string | undefined {
  return isNode(node) ? node.type : undefined;
}

export function getNodeProperty(node: unknown, property: string): unknown {
  return isNode(node) ? node[property] : undefined;
}

export function getStringLiteral(node: unknown): string | undefined {
  return nodeStringValue(node);
}

export function getIdentifier(node: unknown): string | undefined {
  return nodeIdentifierName(node);
}

export function isAstNode(node: unknown): boolean {
  return isNode(node);
}

export function walkAst(node: unknown, visitor: (node: AstNode) => void): void {
  walk(node, visitor);
}

export type { AstNode };