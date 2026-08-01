import { transformSync } from "@babel/core";
import instrumentationPlugin from "./instrumentation-plugin.js";

export function instrumentCode(code: string, filename: string): string | null {
  const result = transformSync(code, {
    filename,
    plugins: [
      [instrumentationPlugin, { filename, coverageVariable: "__coverage__" }],
      ["@babel/plugin-transform-typescript", { isTSX: true }],

    ],
    presets: [["@babel/preset-env", { targets: { node: "current" } }]],
    retainLines: true, // Important for accurate line numbers
    ast: false,
    code: true,
    parserOpts: {
      plugins: ["decorators-legacy", "typescript"],
    },
  });

  return result?.code || null;
}
