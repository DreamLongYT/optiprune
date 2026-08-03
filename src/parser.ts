import { parse } from "@babel/parser";
import type {
  DependencyEdge,
  ExportRecord,
  ModuleRecord,
  ParseDiagnostic,
  Position,
  Range,
  DynamicImportCandidate,
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
  dynamicExpression?: string,
): void {
  const edge: DependencyEdge = {
    source: sourceFile,
    rawSpecifier,
    kind,
    importedNames,
    resolution: "unknown",
    isTypeOnly,
    dynamicExpression,
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

function exportSpecifierNames(specifiers: unknown[], useLocal: boolean = false): string[] {
  const names: string[] = [];
  for (const specifier of specifiers) {
    if (isNode(specifier)) {
      const nameNode = useLocal ? (specifier.local || specifier.exported) : specifier.exported;
      names.push(propertyKeyName(nameNode) ?? "*");
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

function walk(node: unknown, visitor: (node: AstNode, stack: AstNode[]) => void, stack: AstNode[] = []): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, visitor, stack);
    }
    return;
  }
  if (!isNode(node)) {
    return;
  }
  
  const currentStack = [...stack, node];
  visitor(node, stack);
  
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
      walk(value, visitor, currentStack);
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
  const scannedDirectories: string[] = [];
  const dynamicImportCandidates: DynamicImportCandidate[] = [];
  const localSymbolDeps = new Map<string, Set<string>>();

  const getActiveDeclaration = (s: AstNode[]) => {
    for (let i = s.length - 1; i >= 0; i--) {
      const n = s[i];
      if (!n) continue;
      if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration" || n.type === "TSInterfaceDeclaration" || n.type === "TSTypeAliasDeclaration" || n.type === "TSEnumDeclaration") {
        return nodeIdentifierName(n.id);
      }
      if (n.type === "VariableDeclarator") {
        const names = bindingNames(n.id);
        return names[0];
      }
    }
    return undefined;
  };

  walk(ast, (node, stack) => {
    // Fix 3: Track local references
    if (node.type === "Identifier") {
      const parent = stack[stack.length - 1];
      if (parent) {
        let isRef = true;
        if ((parent.type === "FunctionDeclaration" || parent.type === "ClassDeclaration" || parent.type === "TSInterfaceDeclaration" || parent.type === "TSTypeAliasDeclaration" || parent.type === "TSEnumDeclaration" || parent.type === "VariableDeclarator") && parent.id === node) isRef = false;
        if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) isRef = false;
        if (parent.type === "ObjectProperty" && parent.key === node && !parent.computed) isRef = false;
        if (parent.type === "TSPropertySignature" && parent.key === node) isRef = false;
        if (parent.type === "TSMethodSignature" && parent.key === node) isRef = false;
        if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") isRef = false;

        if (isRef) {
          const active = getActiveDeclaration(stack);
          if (active && active !== node.name) {
            if (!localSymbolDeps.has(active)) localSymbolDeps.set(active, new Set());
            localSymbolDeps.get(active)!.add(node.name as string);
          }
        }
      }
    }

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
        const exportedNames = exportSpecifierNames(asArray(node.specifiers), false);
        const localNames = exportSpecifierNames(asArray(node.specifiers), true);
        const isTypeOnly = node.exportKind === "type";
        // Edge should use local names (names from the source module)
        addEdge(edges, file, specifier, "export-from", node, localNames, isTypeOnly);
        // Exports should use exported names (names this module provides)
        for (const exportedName of exportedNames) {
          addExport(exportsList, exportedName, node, undefined, { name: exportedName, isReExport: true, isTypeOnly: node.exportKind === "type" });
        }
      } else if (isNode(node.declaration)) {
        const declaration = node.declaration;
        if ((declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration" || declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration" || declaration.type === "TSEnumDeclaration") && nodeIdentifierName(declaration.id)) {
          // TSInterfaceDeclaration and TSTypeAliasDeclaration are pure type constructs erased
          // at compile time.
          // TSEnumDeclaration: 'const enum' is erased/inlined, but regular 'enum' emits a
          // runtime IIFE object. We only mark it as type-only if it's a 'const enum'.
          const isType =
            declaration.type === "TSInterfaceDeclaration" ||
            declaration.type === "TSTypeAliasDeclaration" ||
            (declaration.type === "TSEnumDeclaration" && (declaration as any).const === true) ||
            node.exportKind === "type";
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
      let literal = nodeStringValue(argument);
      
      // Handle pathToFileURL(path.join(...)).href
      if (!literal && isNode(argument) && argument.type === "MemberExpression" && nodeIdentifierName(argument.property) === "href") {
        const obj = argument.object;
        if (isNode(obj) && obj.type === "CallExpression" && nodeIdentifierName(obj.callee) === "pathToFileURL") {
          literal = nodeStringValue(asArray(obj.arguments)[0]);
          // Even if it's still not a literal, templateParts might handle the inner call
        }
      }

      if (literal) {
        addEdge(edges, file, literal, "dynamic-literal", node, ["*"]);
      } else {
        const parts = templateParts(argument) || (isNode(argument) && argument.type === "CallExpression" && nodeIdentifierName(argument.callee) === "pathToFileURL" ? templateParts(asArray(argument.arguments)[0]) : undefined);
        if (parts) {
          const edge: DependencyEdge = {
            source: file,
            rawSpecifier: `${parts.prefix}${"${…}"}${parts.suffix}`,
            kind: "dynamic-pattern",
            importedNames: ["*"],
            resolution: "unknown",
            dynamicPattern: {
              prefix: parts.prefix,
              suffix: parts.suffix,
              baseDirectory: "", // Would need proper calculation
              candidates: []
            }
          };
          const location = positionRange(node);
          if (location) edge.location = location;
          edges.push(edge);
        } else {
          hasUnknownDynamicBoundary = true;
          const expressionText = sourceText.slice(node.start as number, node.end as number);
          const location = positionRange(node);
          if (location) {
            // Find the containing function or block to capture local variables
            let contextCode = "";
            const scopeNode = [...stack].reverse().find(n => 
              n.type === "FunctionDeclaration" || 
              n.type === "FunctionExpression" || 
              n.type === "ArrowFunctionExpression" ||
              n.type === "ClassMethod" ||
              n.type === "ObjectMethod"
            );
            
            if (scopeNode && isNode(scopeNode.body)) {
              const body = scopeNode.body as any;
              const start = body.start;
              if (typeof start === "number" && typeof node.start === "number") {
                const bStart = (body.type === "BlockStatement" ? start + 1 : start) as number;
                const bEnd = (body.end as number) - (body.type === "BlockStatement" ? 1 : 0);
                let code = sourceText.slice(bStart, bEnd);
                
                // Prepend parameters as variables so they are defined (even if undefined)
                const params = (scopeNode as any).params;
                if (Array.isArray(params)) {
                  const paramNames = params.flatMap(p => bindingNames(p));
                  if (paramNames.length > 0) {
                    code = `var ${paramNames.join(', ')};\n${code}`;
                  }
                }
                contextCode = code;
              }
            }
            
            // In a real scenario, we might want to log this if verbose is enabled
            // However, parser.ts doesn't have easy access to options here.
            // We'll leave it as is for now to avoid breaking the signature.
            
            if (!contextCode) {
              contextCode = sourceText.slice(Math.max(0, (node.start as number) - 500), (node.end as number) + 500);
            }

            dynamicImportCandidates.push({
              file,
              line: location.start.line,
              column: location.start.column,
              expression: expressionText,
              contextCode: contextCode,
            });
          }
          addEdge(edges, file, "<unknown dynamic import>", "unknown-dynamic", node, ["*"], false, expressionText);
        }
      }
      return;
    }

    // Detect readdir / readdirSync / fs.promises.readdir with smarter path resolution
    if (node.type === "CallExpression") {
      const callee = node.callee as any;
      // Match: readdir(...), readdirSync(...), fs.readdir(...), fs.readdirSync(...),
      //        fs.promises.readdir(...), promises.readdir(...)
      const isReaddir =
        (callee.type === "Identifier" && (callee.name === "readdir" || callee.name === "readdirSync")) ||
        (callee.type === "MemberExpression" && (callee.property?.name === "readdir" || callee.property?.name === "readdirSync")) ||
        // fs.promises.readdir
        (callee.type === "MemberExpression" &&
          isNode(callee.object) &&
          callee.object.type === "MemberExpression" &&
          (callee.property?.name === "readdir" || callee.property?.name === "readdirSync"));

      if (isReaddir) {
        const arg = asArray(node.arguments)[0] as any;
        let dir = nodeStringValue(arg);

        // Handle path.join(__dirname, 'plugins') or path.resolve(..., 'dir') or similar
        if (!dir && arg?.type === "CallExpression") {
          const methodName = arg.callee?.property?.name ?? arg.callee?.name;
          if (methodName === "join" || methodName === "resolve") {
            const joinArgs = asArray(arg.arguments);
            // Collect all string literal segments (skip __dirname / __filename / variables)
            const stringParts = joinArgs
              .map((a: unknown) => nodeStringValue(a))
              .filter((s): s is string => s !== undefined && !s.startsWith("/"));
            if (stringParts.length > 0) {
              // Use the relative sub-path formed by the string literals
              dir = stringParts.join("/");
            }
          }
        }

        if (dir) {
          scannedDirectories.push(dir);
        } else {
          // If we can't resolve the directory but it's a variable,
          // we mark it as a potential dynamic scan boundary.
          hasUnknownDynamicBoundary = true;
        }
      }
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

  // Attach local references to exports
  for (const exp of exportsList) {
    const deps = localSymbolDeps.get(exp.name);
    if (deps) {
      exp.localReferences = Array.from(deps);
    }
  }

  const localSymbolMap: Record<string, string[]> = {};
  for (const [name, deps] of localSymbolDeps.entries()) {
    localSymbolMap[name] = Array.from(deps);
  }

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
    hasParseError: parserErrors.length > 0,
    hasUnresolvedCommonJsExports,
    scannedDirectories,
    dynamicImportCandidates,
    localSymbolMap,
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
  
  // 1. Detailed Import Pattern: import { a, b as c } from '...'
  const detailedImportRegex = /\bimport\s+(?:\{([^}]+)\}|([a-zA-Z_$][\w$]*)(?:\s*,\s*\{([^}]+)\})?|\*\s+as\s+([a-zA-Z_$][\w$]*))\s+from\s+["']([^"'\n]+)["']/g;
  for (const match of sourceText.matchAll(detailedImportRegex)) {
    const namedImports = match[1] || match[3];
    const defaultImport = match[2];
    const namespaceImport = match[4];
    const specifier = match[5];
    
    if (specifier) {
      const names: string[] = [];
      if (namespaceImport) names.push("*");
      if (defaultImport) names.push("default");
      if (namedImports) {
        namedImports.split(",").forEach(n => {
          const parts = n.trim().split(/\s+as\s+/i);
          const imported = parts[0]?.trim();
          if (imported) names.push(imported);
        });
      }
      
      edges.push({
        source: file,
        rawSpecifier: specifier,
        kind: "import",
        importedNames: names.length > 0 ? names : ["*"],
        resolution: "unknown",
        location: locationAtOffset(sourceText, match.index ?? 0),
      });
    }
  }

  // 2. Simple/Other Patterns
  const patterns: Array<{ regex: RegExp; kind: DependencyEdge["kind"] }> = [
    { regex: /\bimport\s+["']([^"'\n]+)["']/g, kind: "import" }, // side-effect import
    { regex: /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']/g, kind: "export-from" },
    { regex: /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g, kind: "require" },
    { regex: /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g, kind: "dynamic-literal" },
  ];
  for (const { regex, kind } of patterns) {
    for (const match of sourceText.matchAll(regex)) {
      const specifier = match[1];
      if (specifier && !edges.some(e => e.rawSpecifier === specifier && e.location?.start.line === locationAtOffset(sourceText, match.index ?? 0).start.line)) {
        edges.push({
          source: file,
          rawSpecifier: specifier,
          kind,
          importedNames: ["*"],
          resolution: "unknown",
          location: locationAtOffset(sourceText, match.index ?? 0),
        });
      }
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
  const originalMessage = reason instanceof Error ? reason.message : "Parser could not recover this file";
  return {
    id: file,
    relativePath: file,
    parseStatus: "fallback",
    parseDiagnostics: [
      {
        message: `${originalMessage} (Module parse failed, using regex fallback)`,
        file,
        recovered: false,
      },
    ],
    sourceText,
    exports: fallbackExports(sourceText, file),
    edges: fallbackEdges(sourceText, file),
    hasUnknownDynamicBoundary: false, // Parse error is not necessarily a dynamic boundary
    hasParseError: true,
    hasUnresolvedCommonJsExports: false,
    scannedDirectories: [],
    dynamicImportCandidates: [],
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