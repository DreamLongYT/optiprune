import { getQuickJS, QuickJSContext, QuickJSHandle } from "quickjs-emscripten";
import type { AnalysisContext, Finding, ConcolicVerificationResult } from "./types.js";
import { performance } from "node:perf_hooks";
import path from "pathe";

/**
 * Layer 4: Proof Asserter Engine
 * Validates candidate branches from Layer 3 using isolated execution.
 * Uses a secure WebAssembly-based QuickJS sandbox.
 * Now also resolves dynamic imports by simulating their path construction.
 */
export async function analyzeLayer4(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const quickJS = await getQuickJS();

  // 1. Resolve Dynamic Imports
  if (context.dynamicImportCandidates.length > 0) {
    await resolveDynamicImports(context, quickJS);
  }

  // 2. Validate Candidate Branches
  if (context.candidateBranches.length > 0) {
    for (const branch of context.candidateBranches) {
      const result = await verifyPathInWasmSandbox(
        quickJS,
        branch.instrumentedCode,
        branch.seedInput,
        context.options.layers.smtTimeoutMs
      );

      if (result.pathReached) {
        // If reached, it's PROVEN alive.
        continue;
      }

      findings.push({
        rule: "unreachable-dynamic-path",
        severity: "warning",
        confidence: "medium",
        message: `[Proof Asserter] Branch at line ${branch.line} could not be reached with SMT-generated seeds.`,
        file: branch.file,
        location: {
          start: { line: branch.line, column: 0 },
          end: { line: branch.line, column: 0 }
        },
        evidence: {
          engine: "wasm-quickjs",
          executionTimeMs: result.executionTimeMs,
          seedInput: branch.seedInput,
          status: "SUSPECT_UNREACHABLE"
        },
      });
    }
  }

  return findings;
}

/**
 * Simulates dynamic import expressions in a QuickJS sandbox to resolve targets.
 */
async function resolveDynamicImports(context: AnalysisContext, quickJS: any) {
  // Group candidates by file to avoid redundant simulations
  const candidatesByFile = new Map<string, any[]>();
  for (const candidate of context.dynamicImportCandidates) {
    const list = candidatesByFile.get(candidate.file) || [];
    list.push(candidate);
    candidatesByFile.set(candidate.file, list);
  }

  for (const [file, candidates] of candidatesByFile.entries()) {
    for (const candidate of candidates) {
      const runtime = quickJS.newRuntime();
      const vm = runtime.newContext();
      
      try {
        runtime.setMemoryLimit(context.options.layers.isolateMemoryLimitMb * 1024 * 1024);
        
        // Setup Mocks
        setupQuickJSMocks(vm, candidate, context);

        const globalHandle = vm.global;
        const targetsHandle = vm.newArray();
        vm.setProp(globalHandle, "__OPTIPRUNE_TARGETS__", targetsHandle);

        const importMockFn = vm.newFunction("__optiprune_import", (arg: QuickJSHandle) => {
          const target = vm.dump(arg);
          const currentTargets = vm.getProp(globalHandle, "__OPTIPRUNE_TARGETS__");
          const lenHandle = vm.getProp(currentTargets, "length");
          const len = vm.dump(lenHandle);
          vm.setProp(currentTargets, len, vm.newString(String(target)));
          lenHandle.dispose();
          currentTargets.dispose();
          return vm.newObject(); // Dummy module
        });
        vm.setProp(globalHandle, "__optiprune_import", importMockFn);
        importMockFn.dispose();
        targetsHandle.dispose();
        globalHandle.dispose();

        // Clean up code for QuickJS (strip common TS syntax)
        const clean = (code: string) => code
          .replace(/import\.meta\.url/g, '("file://" + __filename)')
          .replace(/\bimport\s*\(/g, '__optiprune_import(')
          // 1. Remove "as any", "as string", etc.
          .replace(/\s+as\s+[a-zA-Z0-9_<>\[\]|& ]+(?=[,;=)]|$)/g, '')
          // 2. Remove type annotations including arrays and common types
          .replace(/:\s*(?:[a-zA-Z0-9_<>|& ]+(?:\[\])*)(?=\s*[,;=)]|$)/g, (match) => {
            // Protect ternary colons and object properties
            if (match.includes('null') || match.includes('undefined') || match.includes('true') || match.includes('false')) {
              return match;
            }
            // Check if it's a common type or starts with Uppercase (Interface/Class)
            const typePart = match.slice(1).trim();
            const commonTypes = ['string', 'number', 'boolean', 'any', 'void', 'unknown', 'never', 'string[]', 'any[]', 'Config', 'ModuleRecord', 'AnalysisContext'];
            if (commonTypes.includes(typePart) || /^[A-Z]/.test(typePart)) {
              return '';
            }
            return match;
          })
          // 3. Remove interface/type imports
          .replace(/import\s+type\s+.*?;/g, '');

        const processedContext = clean(candidate.contextCode);

        const simulationScript = `
          (async function() {
            const __dirname = path.dirname(__filename);
            try {
              ${processedContext}
            } catch (e) {
              if (globalThis.__VERBOSE__) {
                console.log("[QuickJS Runtime Error] " + (e instanceof Error ? e.message : String(e)));
              }
            }
          }).call(globalThis);
        `;

        if (context.options.verbose) {
          console.log(`[Layer 4] Simulation Script for ${file}:\n${simulationScript}`);
        }

        const evalResult = vm.evalCode(simulationScript);
        if (evalResult.error) {
          if (context.options.verbose) {
            console.log(`[Layer 4] Simulation Syntax Error in ${file}:`, vm.dump(evalResult.error));
            console.log(`[Layer 4] Script was:\n${simulationScript}`);
          }
          evalResult.error.dispose();
        } else {
          evalResult.value.dispose();
          let deadline = 1000;
          while (deadline-- > 0) {
            if (runtime.executePendingJobs() === 0) break;
          }
        }
        
        const finalGlobalHandle = vm.global;
        const finalTargetsHandle = vm.getProp(finalGlobalHandle, "__OPTIPRUNE_TARGETS__");
        const targets = vm.dump(finalTargetsHandle) as any[];
        finalTargetsHandle.dispose();
        finalGlobalHandle.dispose();

        if (Array.isArray(targets) && targets.length > 0) {
          // Mark the corresponding edge as resolved to suppress the warning
          const module = context.modules.get(file);
          if (module) {
            if (context.options.verbose) {
              console.log(`[Layer 4] Searching for edge in ${file} at ${candidate.line}:${candidate.column}`);
              module.edges.forEach(e => {
                if (e.kind === "unknown-dynamic") {
                  console.log(`[Layer 4] Found unknown-dynamic edge at ${e.location?.start.line}:${e.location?.start.column}`);
                }
              });
            }
            const edge = module.edges.find(e => 
              e.kind === "unknown-dynamic" && 
              e.location?.start.line === candidate.line && 
              e.location?.start.column === candidate.column
            );
            if (edge) {
              edge.resolution = "resolved";
            }
          }

          for (const rawTarget of targets) {
            if (typeof rawTarget === 'string') {
              resolveAndMarkTarget(rawTarget, file, context);
            }
          }
        }
      } catch (err) {
        // Simulation failed
      } finally {
        vm.dispose();
        runtime.dispose();
      }
    }
  }
}

function setupQuickJSMocks(vm: QuickJSContext, candidate: any, context: AnalysisContext) {
  const globalHandle = vm.global;

  // 1. __dirname and __filename
  const fileDir = path.dirname(candidate.file);
  const dirnameHandle = vm.newString(fileDir);
  const filenameHandle = vm.newString(candidate.file);
  vm.setProp(globalHandle, "__dirname", dirnameHandle);
  vm.setProp(globalHandle, "__filename", filenameHandle);
  dirnameHandle.dispose();
  filenameHandle.dispose();

  // 2. path mock using host's pathe
  const pathMock = vm.newObject();
  const joinFn = vm.newFunction("join", (...args: QuickJSHandle[]) => {
    const parts = args.map(arg => vm.dump(arg));
    const result = vm.newString(path.join(...parts));
    return result;
  });
  const dirnameFn = vm.newFunction("dirname", (arg: QuickJSHandle) => {
    const result = vm.newString(path.dirname(vm.dump(arg)));
    return result;
  });
  vm.setProp(pathMock, "join", joinFn);
  vm.setProp(pathMock, "dirname", dirnameFn);
  vm.setProp(globalHandle, "path", pathMock);
  joinFn.dispose();
  dirnameFn.dispose();
  pathMock.dispose();

  // 3. url mock
  const urlMock = vm.newObject();
  const pathToFileURLFn = vm.newFunction("pathToFileURL", (arg: QuickJSHandle) => {
    const p = vm.dump(arg);
    const obj = vm.newObject();
    const hrefValue = vm.newString(`file://${p}`);
    vm.setProp(obj, "href", hrefValue);
    hrefValue.dispose();
    return obj;
  });
  const fileURLToPathFn = vm.newFunction("fileURLToPath", (arg: QuickJSHandle) => {
    const urlStr = vm.dump(arg);
    const p = urlStr.startsWith('file://') ? urlStr.slice(7) : urlStr;
    return vm.newString(p);
  });
  vm.setProp(urlMock, "pathToFileURL", pathToFileURLFn);
  vm.setProp(urlMock, "fileURLToPath", fileURLToPathFn);
  vm.setProp(globalHandle, "url", urlMock);
  vm.setProp(globalHandle, "pathToFileURL", pathToFileURLFn);
  vm.setProp(globalHandle, "fileURLToPath", fileURLToPathFn);
  urlMock.dispose();
  pathToFileURLFn.dispose();
  fileURLToPathFn.dispose();

  // 4. fs mock
  const fsMock = vm.newObject();
  const readdirFn = vm.newFunction("readdir", (arg: QuickJSHandle) => {
    const rawDir = vm.dump(arg);
    const cleanPath = String(rawDir).replace(/^file:\/\//, '');
    const dir = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(fileDir, cleanPath);
    
    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.readdir called for: "${rawDir}" -> normalized: "${dir}"`);
    }

    const files = Array.from(context.modules.keys())
      .filter(f => {
        const parent = path.dirname(f);
        return parent === dir || parent === dir.replace(/\/$/, '');
      })
      .map(f => path.basename(f));
    
    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.readdir returned:`, files);
    }

    const arr = vm.newArray();
    files.forEach((f, i) => {
      const val = vm.newString(f);
      vm.setProp(arr, i, val);
      val.dispose();
    });
    return arr;
  });
  const existsSyncFn = vm.newFunction("existsSync", (arg: QuickJSHandle) => {
    const rawP = vm.dump(arg);
    const cleanPath = String(rawP).replace(/^file:\/\//, '');
    const p = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(fileDir, cleanPath);
    const exists = context.modules.has(p);
    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.existsSync("${rawP}") -> ${exists}`);
    }
    return exists ? vm.true : vm.false;
  });
  vm.setProp(fsMock, "readdir", readdirFn);
  vm.setProp(fsMock, "readdirSync", readdirFn);
  vm.setProp(fsMock, "existsSync", existsSyncFn);
  vm.setProp(globalHandle, "fs", fsMock);
  fsMock.dispose();
  readdirFn.dispose();
  existsSyncFn.dispose();

  // 5. console mock
  const consoleMock = vm.newObject();
  const logFn = vm.newFunction("log", (...args: QuickJSHandle[]) => {
    if (context.options.verbose) {
      console.log(`[QuickJS Console]`, ...args.map(a => vm.dump(a)));
    }
    return vm.undefined;
  });
  const warnFn = vm.newFunction("warn", (...args: QuickJSHandle[]) => {
    if (context.options.verbose) {
      console.warn(`[QuickJS Console]`, ...args.map(a => vm.dump(a)));
    }
    return vm.undefined;
  });
  const errorFn = vm.newFunction("error", (...args: QuickJSHandle[]) => {
    console.error(`[QuickJS Console Error]`, ...args.map(a => vm.dump(a)));
    return vm.undefined;
  });
  vm.setProp(consoleMock, "log", logFn);
  vm.setProp(consoleMock, "warn", warnFn);
  vm.setProp(consoleMock, "error", errorFn);
  vm.setProp(globalHandle, "console", consoleMock);
  
  if (context.options.verbose) {
    vm.setProp(globalHandle, "__VERBOSE__", vm.true);
  }
  
  consoleMock.dispose();
  logFn.dispose();
  warnFn.dispose();
  errorFn.dispose();

  globalHandle.dispose();
}

function resolveAndMarkTarget(specifier: string, sourceFile: string, context: AnalysisContext) {
  let cleanSpecifier = specifier;
  if (specifier.startsWith('file://')) {
    cleanSpecifier = specifier.slice(7);
  }

  const sourceDir = path.dirname(sourceFile);
  const absolutePath = path.isAbsolute(cleanSpecifier) 
    ? cleanSpecifier 
    : path.resolve(sourceDir, cleanSpecifier);
  
  let targetModule = context.modules.get(absolutePath);
  
  if (!targetModule) {
    for (const ext of context.options.extensions) {
      const withExt = absolutePath + ext;
      targetModule = context.modules.get(withExt);
      if (targetModule) break;
    }
  }

  if (targetModule) {
    console.log(`[Layer 4] Marking reachable: ${targetModule.id}`);
    context.reachable.add(targetModule.id);
    for (const exp of targetModule.exports) {
      context.usedExports.add(`${targetModule.id}:${exp.exportedAs}`);
    }
  } else {
    console.log(`[Layer 4] Could not resolve target: ${absolutePath}`);
  }
}

async function verifyPathInWasmSandbox(
  quickJS: any,
  instrumentedCode: string,
  seedInput: Record<string, any>,
  timeoutMs = 50
): Promise<ConcolicVerificationResult> {
  const startTime = performance.now();
  const runtime = quickJS.newRuntime();
  const context = runtime.newContext();
  
  try {
    runtime.setMemoryLimit(16 * 1024 * 1024);
    
    const setupScript = `
      globalThis.__PROVE_REACHED__ = false;
      globalThis.__coverage__ = {
        traceBranch: (f, l, hit) => { if (hit) globalThis.__PROVE_REACHED__ = true; },
        traceFunction: () => {},
        traceCall: () => {},
        init: () => {}
      };
      const seeds = ${JSON.stringify(seedInput)};
      Object.assign(globalThis, seeds);
    `;
    
    const setupResult = context.evalCode(setupScript);
    setupResult.dispose();
    
    const wrappedCode = `try { ${instrumentedCode} } catch (e) {}`;
    const evalResult = context.evalCode(wrappedCode);
    evalResult.dispose();
    
    const globalHandle = context.global;
    const reachedHandle = context.getProp(globalHandle, "__PROVE_REACHED__");
    const pathReached = context.dump(reachedHandle);
    reachedHandle.dispose();
    globalHandle.dispose();

    return {
      pathReached: Boolean(pathReached),
      executionTimeMs: performance.now() - startTime,
      logs: []
    };
  } catch (err) {
    return {
      pathReached: false,
      executionTimeMs: performance.now() - startTime,
      logs: [(err as Error).message]
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
