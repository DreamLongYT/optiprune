import * as t from "@babel/types";
import { NodePath } from "@babel/traverse";
import { declare } from "@babel/helper-plugin-utils";

interface InstrumentationState {
  opts: {
    filename: string;
    coverageVariable: string;
  };
}

/**
 * A Babel plugin to instrument code for concolic execution.
 * It injects tracing hooks around conditional branches and function calls.
 */
export default (declare as any)((api: any) => {
  api.assertVersion("^7.0.0 || ^8.0.0-0");

  return {
    name: "optiprune-instrumentation",
    visitor: {
      Program: {
        enter(path: NodePath<t.Program>, state: InstrumentationState) {
          const { filename, coverageVariable } = state.opts;
          const fileId = t.stringLiteral(filename);

          // Initialize coverage variable at the beginning of the program
          const initCoverage = t.expressionStatement(
            t.callExpression(t.memberExpression(t.identifier(coverageVariable), t.identifier("init")), [fileId])
          );
          // Mark the injected node to prevent re-instrumentation
          ((initCoverage.expression as any).callee as any)._concolicInstrumented = true;
          path.node.body.unshift(initCoverage);
        },
      },

      // Instrument IfStatement
      IfStatement(path: NodePath<t.IfStatement>, state: InstrumentationState) {
        const { filename, coverageVariable } = state.opts;
        const fileId = t.stringLiteral(filename);
        const line = t.numericLiteral(path.node.loc?.start.line || 0);

        const traceCall = t.callExpression(t.memberExpression(t.identifier(coverageVariable), t.identifier("traceBranch")), [
            fileId,
            line,
            path.node.test,
          ]);
        (traceCall.callee as any)._concolicInstrumented = true;

        // Wrap the test condition with the tracing call
        path.node.test = t.sequenceExpression([traceCall, path.node.test]);
      },

      // Instrument FunctionDeclaration and FunctionExpression
      "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>, state: InstrumentationState) {
        const { filename, coverageVariable } = state.opts;
        const fileId = t.stringLiteral(filename);
        const line = t.numericLiteral(path.node.loc?.start.line || 0);
        const node = path.node as t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression;
        const functionName = t.stringLiteral((node as any).id && t.isIdentifier((node as any).id) ? (node as any).id.name : "anonymous");

        const traceCall = t.expressionStatement(
          t.callExpression(t.memberExpression(t.identifier(coverageVariable), t.identifier("traceFunction")), [
            fileId,
            line,
            functionName,
          ])
        );
        ((traceCall.expression as any).callee as any)._concolicInstrumented = true;

        if (t.isBlockStatement(path.node.body)) {
          path.node.body.body.unshift(traceCall);
        } else { // ArrowFunctionExpression with implicit return
          path.node.body = t.blockStatement([
            traceCall,
            t.returnStatement(path.node.body as t.Expression),
          ]);
        }
      },

      // Instrument CallExpression
      CallExpression(path: NodePath<t.CallExpression>, state: InstrumentationState) {
        // Avoid re-instrumenting our own injected calls
        if ((path.node.callee as any)._concolicInstrumented) {
          return;
        }

        const { filename, coverageVariable } = state.opts;
        const fileId = t.stringLiteral(filename);
        const line = t.numericLiteral(path.node.loc?.start.line || 0);

        const calleeName = t.stringLiteral(
          t.isIdentifier(path.node.callee) ? path.node.callee.name : "unknown"
        );

        // Create a helper function call that traces and then executes the original call
        const tracedCall = t.callExpression(
          t.memberExpression(t.identifier(coverageVariable), t.identifier("traceAndExecuteCall")), [
            fileId,
            line,
            calleeName,
            path.node.callee as t.Expression, // Pass the original callee
            t.arrayExpression(path.node.arguments.map(arg => t.cloneNode(arg as t.Expression))) // Pass cloned arguments
          ]
        );
        (tracedCall.callee as any)._concolicInstrumented = true;

        path.replaceWith(tracedCall);
      },
    },
  };
});
