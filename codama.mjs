import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlPath = resolve(__dirname, "target/idl/onleash.json");
const outDirs = [
  resolve(__dirname, "src/generated"),
  resolve(__dirname, "frontend/lib/onleash-program"),
];

const idl = JSON.parse(readFileSync(idlPath, "utf-8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));

for (const outDir of outDirs) {
  codama.accept(renderVisitor(outDir, { formatCode: false }));
  console.log(`✓ Generated client at ${outDir}`);
}
