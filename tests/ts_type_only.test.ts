/**
 * Regression tests: TypeScript type-only exports must NOT be reported as unused-export.
 *
 * Background
 * ----------
 * TypeScript interfaces, type aliases, and enums (as well as any export annotated
 * with the `export type` keyword) are erased by the compiler before the JavaScript
 * runtime ever sees them.  A graph-based analyser like OptiPrune cannot reliably
 * track *type-level* consumers across files, so reporting these as "unused" produces
 * false positives that confuse users and erode trust in the tool.
 *
 * What is tested
 * --------------
 * 1. `interface` declarations exported without `export type` are NOT flagged.
 * 2. `type` alias declarations are NOT flagged.
 * 3. `enum` declarations are NOT flagged (they are TS-specific; treated as type-only
 *    in the graph layer even though they emit an IIFE at runtime).
 * 4. Explicit `export type { … }` re-exports are NOT flagged.
 * 5. A regular *value* export that is genuinely unused IS still flagged (sanity check
 *    that the guard does not accidentally suppress all findings).
 * 6. Parser unit: `isTypeOnly` is set correctly on each construct.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { analyze } from "../src/index.js";
import { parseModule } from "../src/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helper: create a temporary directory with in-memory files
// ---------------------------------------------------------------------------
async function withTempDir(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-ts-type-only-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Parser-level unit tests
// ---------------------------------------------------------------------------
describe("Parser: isTypeOnly flag", () => {
  it("marks TSInterfaceDeclaration exports as isTypeOnly", () => {
    const src = `export interface Foo { bar: string; }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Foo");
    expect(exp, "export 'Foo' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("marks TSTypeAliasDeclaration exports as isTypeOnly", () => {
    const src = `export type Bar = "a" | "b";`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Bar");
    expect(exp, "export 'Bar' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("marks const TSEnumDeclaration exports as isTypeOnly", () => {
    const src = `export const enum Direction { Up, Down, Left, Right }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Direction");
    expect(exp, "export 'Direction' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("does NOT mark regular TSEnumDeclaration exports as isTypeOnly", () => {
    const src = `export enum Direction { Up, Down, Left, Right }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Direction");
    expect(exp, "export 'Direction' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("marks `export type { … }` specifiers as isTypeOnly", () => {
    const src = `
      interface Hidden { x: number }
      export type { Hidden };
    `;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Hidden");
    expect(exp, "export 'Hidden' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("does NOT mark plain value exports as isTypeOnly", () => {
    const src = `export const VERSION = "1.0.0";`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "VERSION");
    expect(exp, "export 'VERSION' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("does NOT mark class exports as isTypeOnly", () => {
    const src = `export class MyService { run() {} }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "MyService");
    expect(exp, "export 'MyService' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("does NOT mark function exports as isTypeOnly", () => {
    const src = `export function doWork(): void {}`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "doWork");
    expect(exp, "export 'doWork' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Analyser-level integration tests (end-to-end via analyze())
// ---------------------------------------------------------------------------
describe("Analyser: TypeScript type-only exports do not produce unused-export findings", () => {
  it("does not flag an unused interface as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export interface CacheEntry { key: string; value: unknown; }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "CacheEntry",
        );
        expect(typeFindings).toHaveLength(0);
      },
    );
  });

  it("does not flag an unused type alias as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export type Confidence = "high" | "medium" | "low";`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Confidence",
        );
        expect(typeFindings).toHaveLength(0);
      },
    );
  });

  it("does not flag an unused CONST enum as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export const enum Status { Active = "active", Inactive = "inactive" }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Status",
        );
        expect(typeFindings).toHaveLength(0);
      },
    );
  });

  it("DOES flag a regular unused enum as unused-export (because it emits runtime code)", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export enum Status { Active = "active", Inactive = "inactive" }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const enumFinding = report.findings.find(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Status",
        );
        expect(enumFinding, "Regular unused enum should be flagged").toBeDefined();
      },
    );
  });

  it("does not flag an `export type { … }` re-export as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `
          interface DynamicPattern { prefix: string; suffix: string; }
          export type { DynamicPattern };
        `,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "DynamicPattern",
        );
        expect(typeFindings).toHaveLength(0);
      },
    );
  });

  it("does not flag multiple mixed type-only constructs in a single file", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `
          export interface Position { line: number; column: number; }
          export type EdgeKind = "import" | "export-from" | "require";
          export const enum ParseStatus { Parsed = "parsed", Recovered = "recovered" }
          export type Nullable<T> = T | null;
        `,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeOnlyNames = ["Position", "EdgeKind", "ParseStatus", "Nullable"];
        for (const name of typeOnlyNames) {
          const found = report.findings.filter(
            (f) => f.rule === "unused-export" && f.evidence.exportName === name,
          );
          expect(found, `'${name}' should not be reported as unused-export`).toHaveLength(0);
        }
      },
    );
  });

  it("still flags a genuinely unused VALUE export (sanity check)", async () => {
    await withTempDir(
      {
        "entry.ts": `import './lib.js'; export const x = 1;`,
        "lib.ts": `
          export const unusedValue = 42;
          export interface SafeType { id: string; }
        `,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        // The value export must still be flagged
        const valueFinding = report.findings.find(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "unusedValue",
        );
        expect(valueFinding, "unusedValue should be reported as unused-export").toBeDefined();

        // But the interface must NOT be flagged
        const typeFinding = report.findings.find(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "SafeType",
        );
        expect(typeFinding, "SafeType interface should NOT be reported as unused-export").toBeUndefined();
      },
    );
  });

  it("uses the fixture directory: all type-only exports in types.ts are not flagged", async () => {
    const fixtureDir = path.join(__dirname, "fixtures", "ts-type-only-test");

    const report = await analyze({
      rootDir: fixtureDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
    });

    // These are all type-only exports in the fixture – none should appear in findings
    const typeOnlyNames = ["CacheEntry", "Confidence", "Status", "DynamicPattern", "Repository"];
    for (const name of typeOnlyNames) {
      const found = report.findings.filter(
        (f) => f.rule === "unused-export" && f.evidence.exportName === name,
      );
      expect(found, `'${name}' should not be reported as unused-export`).toHaveLength(0);
    }

    // VERSION is a value export that IS used in entry.ts – it must not be flagged either
    const versionFinding = report.findings.find(
      (f) => f.rule === "unused-export" && f.evidence.exportName === "VERSION",
    );
    expect(versionFinding, "VERSION is used and should not be flagged").toBeUndefined();
  });
});
