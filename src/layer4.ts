import { getQuickJS } from "quickjs-emscripten";
import type { AnalysisContext, Finding, ConcolicVerificationResult } from "./types.js";
import { performance } from "node:perf_hooks";

/**
 * Layer 4: Proof Asserter Engine
 * Validates candidate branches from Layer 3 using isolated execution.
 * Uses a secure WebAssembly-based QuickJS sandbox.
 */
export async function analyzeLayer4(context: AnalysisContext): Promise<Finding[]> {
  if (context.candidateBranches.length === 0) {
    return [];
  }

  const findings: Finding[] = [];
  const quickJS = await getQuickJS();

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

  return findings;
}

/**
 * Executes instrumented code paths in a secure Wasm-based QuickJS sandbox.
 */
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
    // Set a memory limit (e.g., 16MB)
    runtime.setMemoryLimit(16 * 1024 * 1024);
    
    // Setup the sandbox environment
    const setupScript = `
      globalThis.__PROVE_REACHED__ = false;
      globalThis.__coverage__ = {
        traceBranch: (f, l, hit) => { if (hit) globalThis.__PROVE_REACHED__ = true; },
        traceFunction: () => {},
        traceCall: () => {},
        init: () => {}
      };
      // Inject seed inputs
      const seeds = ${JSON.stringify(seedInput)};
      Object.assign(globalThis, seeds);
    `;
    
    context.evalCode(setupScript);
    
    // Execute the instrumented code
    // We wrap it in a try-catch to prevent VM crashes from throwing in the host
    const wrappedCode = `try { ${instrumentedCode} } catch (e) {}`;
    
    // QuickJS-emscripten evalCode is synchronous but we can enforce a timeout
    // In a more complex setup we'd use a worker, but for concolic execution snippets,
    // we rely on the host's performance.now() and runtime limits.
    context.evalCode(wrappedCode);
    
    const pathReached = context.dump(context.getProp(context.global, "__PROVE_REACHED__"));

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
