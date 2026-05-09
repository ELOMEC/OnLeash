import { onleashTools } from "./goat-plugin.js";

async function main() {
  console.log("onleash tools available to AI agents:\n");
  for (const tool of onleashTools) {
    console.log(`  • ${tool.name}`);
    console.log(`    ${tool.description}`);
    const shape = (tool.parameters as { shape?: Record<string, unknown> }).shape;
    if (shape) {
      console.log(`    params: ${Object.keys(shape).join(", ")}`);
    }
    console.log();
  }

  console.log(
    "Live exercise (requires backend running on http://localhost:3000):"
  );
  const create = onleashTools[0]; // create_agent_budget
  try {
    const result = await create.execute({
      ownerAddress: "3E8ZZJBkz82RmLSSmMZJBGuwrtkJDoCsX5UZVj26rqBr",
      mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    console.log("  create_agent_budget →", result);
  } catch (err) {
    console.log(`  create_agent_budget skipped: ${(err as Error).message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
