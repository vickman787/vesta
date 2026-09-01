/**
 * GenLayer client and contract access for the Guardian treasury dashboard.
 *
 * This app targets Studionet exclusively — the hosted GenLayer Studio at
 * studio.genlayer.com. Contracts are deployed from the Studio website and this
 * dashboard reads and drives them over the same RPC.
 *
 * Studio caveats that matter here: state is temporary, transactions are gasless,
 * and there is no EVM chain layer or ghost contracts — balances are simulated in
 * Studio's own database. Native value transfers to plain addresses do work, which
 * is all this contract needs to pay a merchant.
 *
 * Two clients are used, following the standard viem split:
 *   - a read client that talks to the GenLayer RPC directly and needs no wallet
 *   - a write client that signs through the injected wallet
 *
 * The contract is the only source of truth. Every view returns JSON, which is
 * parsed and validated here so the UI never has to guess at a shape.
 */

import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';
import type { GenLayerChain, GenLayerClient, TransactionHash } from 'genlayer-js/types';

/** The only network this app talks to. */
export const NETWORK_NAME = 'studionet';
export const CHAIN = studionet as GenLayerChain;
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_GUARDIAN_CONTRACT || '').trim();

export const RPC_URL = CHAIN.rpcUrls.default.http[0];
export const STUDIO_URL = 'https://studio.genlayer.com';

// genlayer-js still points studionet at genlayer-explorer.vercel.app, which
// currently returns 503. This is the explorer that actually serves Studio state.
export const EXPLORER_URL = 'https://explorer-studio.genlayer.com';

export function explorerTransactionUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

export function injectedProvider(): Eip1193Provider | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum ?? null;
}

export type Client = GenLayerClient<GenLayerChain>;

export function readClient(): Client {
  return createClient({ chain: CHAIN });
}

export function writeClient(account: `0x${string}`): Client {
  const provider = injectedProvider();
  if (!provider) throw new Error('No injected wallet was detected.');
  return createClient({ chain: CHAIN, account, provider: provider as never });
}

/** Point the wallet at Studionet, adding the network if it is absent. */
export async function connectWalletNetwork(client: Client): Promise<void> {
  await client.connect('studionet');
}

// --------------------------------------------------------------------- domain

export type RequestStatus = 'APPROVED' | 'REJECTED' | 'MANUAL_REVIEW' | 'PAID';
export type Decision = 'approve' | 'reject' | 'manual_review';
export type DecidedBy = 'VALIDATOR_CONSENSUS' | 'POLICY_OVERRIDE' | 'HUMAN_REVIEW';

export type PaymentRequest = {
  requestId: string;
  merchant: string;
  amount: bigint;
  purpose: string;
  evidence: string[];
  expiresAt: number;
  submittedBy: string;
  submittedAt: string;
  status: RequestStatus;
  decision: Decision;
  reasoning: string;
  expectedValue: string;
  riskScore: number;
  confidence: number;
  decidedBy: DecidedBy;
  paidAt: string;
};

export type TreasuryConfig = {
  owner: string;
  pendingOwner: string;
  authorizedAgent: string;
  perTransactionLimit: bigint;
  hourlyLimit: bigint;
  windowStart: number;
  spendInWindow: bigint;
  remainingHourlyBudget: bigint;
  balance: bigint;
  totalPaid: bigint;
  paused: boolean;
  requestCount: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} was not a JSON object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} was not a string`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} was not an integer`);
  }
  return value;
}

function wei(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} was not a decimal wei string`);
  }
  return BigInt(value);
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== 'string') throw new Error(`${label} did not return a JSON string`);
  return JSON.parse(value) as unknown;
}

function toConfig(value: unknown): TreasuryConfig {
  const data = record(parseJson(value, 'get_config'), 'get_config');
  return {
    owner: text(data.owner, 'owner'),
    pendingOwner: text(data.pendingOwner, 'pendingOwner'),
    authorizedAgent: text(data.authorizedAgent, 'authorizedAgent'),
    perTransactionLimit: wei(data.perTransactionLimit, 'perTransactionLimit'),
    hourlyLimit: wei(data.hourlyLimit, 'hourlyLimit'),
    windowStart: integer(data.windowStart, 'windowStart'),
    spendInWindow: wei(data.spendInWindow, 'spendInWindow'),
    remainingHourlyBudget: wei(data.remainingHourlyBudget, 'remainingHourlyBudget'),
    balance: wei(data.balance, 'balance'),
    totalPaid: wei(data.totalPaid, 'totalPaid'),
    paused: data.paused === true,
    requestCount: integer(data.requestCount, 'requestCount'),
  };
}

function toRequest(value: unknown): PaymentRequest {
  const data = record(value, 'payment request');
  const evidence = Array.isArray(data.evidence)
    ? data.evidence.map((item, index) => text(item, `evidence[${index}]`))
    : [];
  return {
    requestId: text(data.requestId, 'requestId'),
    merchant: text(data.merchant, 'merchant'),
    amount: wei(data.amount, 'amount'),
    purpose: text(data.purpose, 'purpose'),
    evidence,
    expiresAt: integer(data.expiresAt, 'expiresAt'),
    submittedBy: text(data.submittedBy, 'submittedBy'),
    submittedAt: text(data.submittedAt, 'submittedAt'),
    status: text(data.status, 'status') as RequestStatus,
    decision: text(data.decision, 'decision') as Decision,
    reasoning: text(data.reasoning, 'reasoning'),
    expectedValue: text(data.expectedValue, 'expectedValue'),
    riskScore: integer(data.riskScore, 'riskScore'),
    confidence: integer(data.confidence, 'confidence'),
    decidedBy: text(data.decidedBy, 'decidedBy') as DecidedBy,
    paidAt: text(data.paidAt, 'paidAt'),
  };
}

// ---------------------------------------------------------------------- reads

export async function fetchConfig(client: Client, address: string): Promise<TreasuryConfig> {
  return toConfig(
    await client.readContract({
      address: address as `0x${string}`,
      functionName: 'get_config',
      args: [],
    }),
  );
}

export async function fetchRequests(
  client: Client,
  address: string,
  limit = 50,
): Promise<PaymentRequest[]> {
  const parsed = parseJson(
    await client.readContract({
      address: address as `0x${string}`,
      functionName: 'get_requests',
      args: [limit],
    }),
    'get_requests',
  );
  if (!Array.isArray(parsed)) throw new Error('get_requests did not return an array');
  return parsed.map(toRequest);
}

export async function fetchMerchantAllowed(
  client: Client,
  address: string,
  merchant: string,
): Promise<boolean> {
  const allowed = await client.readContract({
    address: address as `0x${string}`,
    functionName: 'is_merchant_allowed',
    args: [merchant],
  });
  return allowed === true;
}

// --------------------------------------------------------------------- writes

export type WriteOutcome = { hash: TransactionHash; status: TransactionStatus };

/**
 * Send a write transaction and wait for consensus to accept it.
 *
 * A transaction can be accepted by consensus and still have failed in
 * execution, so the execution result is checked separately and surfaced as an
 * error rather than reported as success.
 */
export async function write(
  client: Client,
  address: string,
  functionName: string,
  args: unknown[],
  value = 0n,
): Promise<WriteOutcome> {
  const hash = await client.writeContract({
    address: address as `0x${string}`,
    functionName,
    args: args as never,
    value,
  });

  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
  });

  if (receipt.statusName === TransactionStatus.UNDETERMINED) {
    throw new Error(
      'Validators could not agree on this transaction, so it did not change contract state.',
    );
  }
  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error(await executionError(client, hash));
  }

  return { hash, status: receipt.statusName ?? TransactionStatus.ACCEPTED };
}

/** Read the contract's own error message out of the execution trace. */
async function executionError(client: Client, hash: TransactionHash): Promise<string> {
  try {
    const trace = await client.debugTraceTransaction({ hash });
    const detail = (trace.stderr || '').trim().split('\n').filter(Boolean).at(-1);
    if (detail) return `Contract rejected the call: ${detail}`;
  } catch {
    // Tracing is best-effort; fall through to the generic message.
  }
  return 'The contract rejected this call. Check the transaction in the explorer for the reason.';
}
