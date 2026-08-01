import { runAnalysis } from "./src/index.js";
import path from "pathe";

async function test() {
  console.log("🚀 Starting Refactored OptiPrune Test...");
  const repoPath = "/home/ubuntu/hard-repo";
  const entryFiles = ["index.ts"];

  try {
    const findings = await runAnalysis(repoPath, entryFiles);
    
    console.log("\n--- Analysis Results ---");
    console.log(`Total findings: ${findings.length}`);
    
    const unusedExports = findings.filter(f => f.rule === "unused-export");
    const unreachableFiles = findings.filter(f => f.rule === "unreachable-file");

    console.log(`\nUnused Exports (${unusedExports.length}):`);
    unusedExports.forEach(f => {
      console.log(` - [${path.relative(repoPath, f.file)}] ${f.message}`);
    });

    console.log(`\nUnreachable Files (${unreachableFiles.length}):`);
    unreachableFiles.forEach(f => {
      console.log(` - ${path.relative(repoPath, f.file)}`);
    });

    // Verification of the bug fix
    const uiComponentFinding = unusedExports.find(f => f.evidence.name === "UIComponent");
    if (uiComponentFinding) {
      console.error("\n❌ BUG PERSISTS: UIComponent (dynamic import) is still marked as unused!");
    } else {
      console.log("\n✅ BUG FIXED: UIComponent (dynamic import) is correctly identified as used.");
    }

    const zodFinding = unusedExports.find(f => f.evidence.name === "UserSchema");
    if (zodFinding) {
      console.error("❌ BUG PERSISTS: UserSchema (Zod) is still marked as unused!");
    } else {
      console.log("✅ PLUGIN WORKING: UserSchema (Zod) is correctly identified as used via Plugin.");
    }

    const deadBranchFinding = unusedExports.find(f => f.evidence.name === "usedInDeadBranch");
    if (deadBranchFinding) {
      console.log("✅ HARDENING SUCCESS: usedInDeadBranch correctly identified as unused (Dead Branch Analysis).");
    } else {
      console.error("❌ HARDENING FAILED: usedInDeadBranch was NOT identified as unused!");
      const deadBranchModule = Array.from(findings).find(f => f.file.includes('dead-branches.ts'));
      // Note: findings don't include references. I should check context in runAnalysis.
    }

  } catch (error) {
    console.error("Test failed:", error);
  }
}

test();
