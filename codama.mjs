import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idlPath = resolve(__dirname, "target/idl/onleash.json");
const outDir = resolve(__dirname, "src/generated");

const idl = JSON.parse(readFileSync(idlPath, "utf-8"));
const codama = createFromRoot(rootNodeFromAnchor(idl));

codama.accept(renderVisitor(outDir, { formatCode: false }));

console.log(`✓ Generated client at ${outDir}`);
