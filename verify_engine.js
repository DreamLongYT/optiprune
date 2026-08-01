import { SemanticGraph } from './dist/semantic-graph.js';
import { TopologyManager } from './dist/topology-manager.js';
import { SymbolicEngine } from './dist/symbolic-engine.js';

async function verify() {
  console.log("Verifying Headless Living Graph Engine...");
  
  const graph = new SemanticGraph();
  const topology = new TopologyManager(graph);
  const symbolic = new SymbolicEngine(graph);

  // Test 1: LEI and Hash Decoupling
  const fileContent = "function test() {}";
  const lei = SemanticGraph.generateLei('file.ts', 'Function', 'test');
  const contentHash = SemanticGraph.generateContentHash(fileContent);
  graph.addNode({
    id: lei,
    contentHash: contentHash,
    type: 'Function',
    name: 'test',
    fileId: 'file.ts',
    metadata: {},
    incomingReferences: [],
    outgoingReferences: []
  });
  const node = graph.getNode(lei);
  if (node && node.id === lei && node.contentHash === contentHash) {
    console.log("✅ LEI and Hash Decoupling OK");
  } else {
    console.error("❌ LEI and Hash Decoupling Failed");
  }

  // Test 2: Soft-Delete Strategy
  topology.updateFile('file.ts', [], false); // Simulate parse failure
  if (graph.getNode(lei)?.isStale) {
    console.log("✅ Soft-Delete (Tombstone) OK");
  } else {
    console.error("❌ Soft-Delete (Tombstone) Failed");
  }

  // Test 3: SCC Detection for Cycles
  graph.addNode({ id: 'A', contentHash: 'h1', type: 'Function', name: 'A', fileId: 'f1.ts', metadata: {}, incomingReferences: [], outgoingReferences: [] });
  graph.addNode({ id: 'B', contentHash: 'h2', type: 'Function', name: 'B', fileId: 'f1.ts', metadata: {}, incomingReferences: [], outgoingReferences: [] });
  graph.addReference('A', 'B', 'CALLS');
  graph.addReference('B', 'A', 'CALLS');
  
  const deadNodes = topology.detectDeadCode();
  const deadIds = deadNodes.map(n => n.id);
  if (deadIds.includes('A') && deadIds.includes('B')) {
    console.log("✅ SCC Cycle Detection OK");
  } else {
    console.error("❌ SCC Cycle Detection Failed");
  }

  // Test 4: Symbolic Evaluation
  graph.addNode({
    id: 'dynamic-node',
    contentHash: 'h3',
    type: 'Dynamic',
    name: 'handler',
    fileId: 'app.ts',
    metadata: { dynamicType: 'property-access', objectName: 'handlers', propertyVar: 'mode' },
    incomingReferences: [],
    outgoingReferences: []
  });
  graph.addNode({
    id: 'target-admin',
    contentHash: 'h4',
    type: 'Function',
    name: 'handlers.admin',
    fileId: 'handlers.ts',
    metadata: {},
    incomingReferences: [],
    outgoingReferences: []
  });

  symbolic.registerContract({
    nodeId: 'dynamic-node',
    inputs: { mode: 'symbolic' },
    constraints: [],
    stateSpace: new Map([['mode', ['admin']]])
  });

  await symbolic.evaluateContracts({});
  const dynamicNode = graph.getNode('dynamic-node');
  if (dynamicNode.outgoingReferences.some(r => r.targetNodeId === 'target-admin')) {
    console.log("✅ Symbolic Evaluation OK");
  } else {
    console.error("❌ Symbolic Evaluation Failed");
  }

  console.log("Verification complete.");
}

verify().catch(console.error);
