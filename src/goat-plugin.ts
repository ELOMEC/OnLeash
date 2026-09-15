import { createTool } from "@goat-sdk/core";
import { z } from "zod";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

async function backendPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `onleash backend ${path}: ${res.status} ${await res.text()}`
    );
  }
  return res.json() as Promise<T>;
}

async function backendGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) {
    throw new Error(
      `onleash backend ${path}: ${res.status} ${await res.text()}`
    );
  }
  return res.json() as Promise<T>;
}

const CreateAgentSchema = z.object({
  ownerAddress: z.string().describe("Solana address of the budget owner"),
  mintAddress: z
    .string()
    .describe("SPL Token mint that the agent will spend (e.g. USDC mint)"),
});

const PaySchema = z.object({
  agentId: z
    .string()
    .uuid()
    .describe("Agent ID returned by create_agent_budget"),
  ownerAddress: z.string().describe("Solana address of the budget owner"),
  mintAddress: z.string().describe("SPL Token mint"),
  recipientAta: z
    .string()
    .describe("Associated token account of the payment recipient"),
  amount: z
    .string()
    .describe(
      "Token amount in raw units (1000000 = 1 USDC at 6 decimals). Pass as string to preserve u64 precision."
    ),
});

const GetAgentSchema = z.object({
  agentId: z.string().uuid().describe("Agent ID"),
});

export const onleashTools = [
  createTool(
    {
      name: "create_agent_budget",
      description:
        "Create a new on-chain agent budget. Returns { id, delegateAddress }. The budget owner must subsequently call initialize_budget on Solana with the returned delegate address to fund and authorize the agent.",
      parameters: CreateAgentSchema,
    },
    async (params) => backendPost("/agents", params)
  ),
  createTool(
    {
      name: "pay_from_agent_budget",
      description:
        "Spend from an agent's budget. Backend signs with the delegate keypair; the on-chain onleash program enforces per-tx, daily, total-allowance, paused, and expiration limits. Returns the Solana tx signature on success.",
      parameters: PaySchema,
    },
    async (params) =>
      backendPost(`/agents/${params.agentId}/pay`, {
        ownerAddress: params.ownerAddress,
        mintAddress: params.mintAddress,
        recipientAta: params.recipientAta,
        amount: params.amount,
      })
  ),
  createTool(
    {
      name: "get_agent_budget_state",
      description:
        "Fetch current on-chain state of an agent budget: remaining allowance, daily spend, paused status, nonce.",
      parameters: GetAgentSchema,
    },
    async (params) => backendGet(`/agents/${params.agentId}`)
  ),
] as const;

export type OnleashTool = (typeof onleashTools)[number];
