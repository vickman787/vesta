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
import { assessReceipt } from './receipt-outcome';

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

export type RequestStatus =
  | 'APPROVED'
  | 'REJECTED'
  | 'MANUAL_REVIEW'
  | 'PAYMENT_PENDING'
  | 'PAID';
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
  deliveryConfirmedBy: string;
  deliveryReference: string;
  reservationWindowStart: number;
  settlementReference: string;
  artifactDigest: string;
  artifactVerified: boolean;
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
  pendingTotal: bigint;
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

function optInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'undefined' || value === null) return 0;
  throw new Error(`${label} was not an integer`);
}

function optText(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'undefined' || value === null) return '';
  throw new Error(`${label} was not a string`);
}

function optBool(value: unknown): boolean {
  return value === true;
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
    pendingTotal: wei(data.pendingTotal ?? '0', 'pendingTotal'),
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
    paidAt: optText(data.paidAt, 'paidAt'),
    deliveryConfirmedBy: optText(data.deliveryConfirmedBy, 'deliveryConfirmedBy'),
    deliveryReference: optText(data.deliveryReference, 'deliveryReference'),
    reservationWindowStart: optInteger(data.reservationWindowStart, 'reservationWindowStart'),
    settlementReference: optText(data.settlementReference, 'settlementReference'),
    artifactDigest: optText(data.artifactDigest, 'artifactDigest'),
    artifactVerified: optBool(data.artifactVerified),
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
 * Send a write transaction and wait for it to FINALIZE, checking the execution
 * result before reporting anything as successful.
 *
 * Nothing here is reported as done at acceptance: a transaction is only
 * `FINALIZED` once the validator set has finished with it, and a finalize that
 * ended in `FINISHED_WITH_ERROR` or never reached a result is surfaced as an
 * error rather than success. Funding, adjudication, configuration changes, and
 * payment authorization all go through this same gate, so the UI never claims
 * a state change the chain has not confirmed.
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
    status: TransactionStatus.FINALIZED,
    interval: 1500,
    retries: 200,
  });

  const assessment = assessReceipt(receipt.statusName, receipt.txExecutionResultName);
  if (!assessment.success) {
    if (assessment.category === 'execution-error') {
      throw new Error(await executionError(client, hash));
    }
    throw new Error(assessment.message);
  }

  return { hash, status: TransactionStatus.FINALIZED };
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

// ------------------------------------------------------- finality and reconcile

/** Native GEN balance of any address, as a decimal wei string (best effort). */
export async function fetchNativeBalance(
  client: Client,
  address: string,
): Promise<bigint | null> {
  try {
    const hex = (await client.request({
      method: 'eth_getBalance',
      params: [address as `0x${string}`, 'latest'],
    })) as string;
    return typeof hex === 'string' ? BigInt(hex) : null;
  } catch {
    return null;
  }
}

/**
 * Wait for the child transaction(s) triggered by an emitted transfer to
 * finalize. Returns the finalized transfer identifiers, or an empty array when
 * the network reports no triggered transactions (e.g. the transfer finalized
 * within the parent transaction).
 */
export async function waitForTriggeredTransfersFinalized(
  client: Client,
  hash: TransactionHash,
  retries = 100,
  interval = 1500,
): Promise<TransactionHash[]> {
  let ids: TransactionHash[] = [];
  for (let attempt = 0; attempt < retries && ids.length === 0; attempt += 1) {
    try {
      ids = await client.getTriggeredTransactionIds({ hash });
    } catch {
      ids = [];
    }
    if (ids.length === 0) await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const finalized: TransactionHash[] = [];
  for (const id of ids) {
    const receipt = await client.waitForTransactionReceipt({
      hash: id,
      status: TransactionStatus.FINALIZED,
      interval,
      retries,
    });
    if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
      throw new Error(`An emitted transfer failed on the chain layer (${id}).`);
    }
    finalized.push(id);
  }
  return finalized;
}

export type PaymentReconciliation = {
  requestId: string;
  status: PaymentRequest['status'];
  paidAt: string;
  recipient: string;
  transferred: bigint;
  treasuryBalance: bigint;
  totalPaid: bigint;
  pendingTotal: bigint;
  spendInWindow: bigint;
  merchantBalance: bigint | null;
  matches: boolean;
};

/**
 * Reconcile the exact resulting contract state after a payment finalizes.
 *
 * Reads the request record and the treasury config back from the contract and
 * verifies the fields the reviewer requires: the request is PAID with a
 * paidAt, the recipient and transferred amount match the request, and the
 * treasury balance, totalPaid, pendingTotal, and spending-window debit moved by
 * exactly the transferred amount. The merchant's native balance is read
 * best-effort as an independent cross-check.
 *
 * `before` must be a snapshot captured immediately before `execute_payment` was
 * authorized (an empty object disables the delta checks).
 */
export async function reconcileFinalizedPayment(
  client: Client,
  address: string,
  requestId: string,
  before: {
    request: PaymentRequest | null;
    config: TreasuryConfig;
    merchantBalance: bigint | null;
  },
): Promise<PaymentReconciliation> {
  const request = await fetchRequests(client, address, 100).then(
    (items) => items.find((item) => item.requestId === requestId) ?? null,
  );
  const config = await fetchConfig(client, address);
  const merchantBalance = request
    ? await fetchNativeBalance(client, request.merchant)
    : null;

  const expectedRecipient = before.request?.merchant ?? '';
  const expectedAmount = before.request?.amount ?? 0n;
  const matches =
    request !== null &&
    request.status === 'PAID' &&
    request.paidAt !== '' &&
    request.merchant.toLowerCase() === expectedRecipient.toLowerCase() &&
    request.amount === expectedAmount &&
    config.totalPaid === before.config.totalPaid + expectedAmount &&
    config.pendingTotal ===
      (before.config.pendingTotal > expectedAmount
        ? before.config.pendingTotal - expectedAmount
        : 0n) &&
    (before.config.windowStart === config.windowStart
      ? config.spendInWindow === before.config.spendInWindow + expectedAmount
      : true) &&
    config.balance === before.config.balance - expectedAmount;

  return {
    requestId,
    status: request?.status ?? 'REJECTED',
    paidAt: request?.paidAt ?? '',
    recipient: request?.merchant ?? '',
    transferred: request?.amount ?? 0n,
    treasuryBalance: config.balance,
    totalPaid: config.totalPaid,
    pendingTotal: config.pendingTotal,
    spendInWindow: config.spendInWindow,
    merchantBalance,
    matches,
  };
}

export type SettlementVerification = {
  transferIds: TransactionHash[];
  matched: boolean;
  reasons: string[];
};

/**
 * Verify that a payment's external transfer was observed to finalize and that
 * the resulting state reconciles, BEFORE finalize_payment is allowed.
 *
 * This is what closes the "mark paid from a pasted reference" path: the app
 * only calls `finalize_payment` after this check passes, and it passes the
 * observed transfer identifier — never user-typed text. `before` must be a
 * snapshot captured immediately before `execute_payment`.
 */
export async function verifySettlementTransfer(
  client: Client,
  address: string,
  executeHash: string,
  requestId: string,
  before: {
    request: PaymentRequest | null;
    config: TreasuryConfig;
    merchantBalance: bigint | null;
  },
): Promise<SettlementVerification> {
  const transferIds = await waitForTriggeredTransfersFinalized(
    client,
    executeHash as TransactionHash,
  );
  const request = await fetchRequests(client, address, 100).then(
    (items) => items.find((item) => item.requestId === requestId) ?? null,
  );
  const config = await fetchConfig(client, address);

  const reasons: string[] = [];
  const expectedRecipient = before.request?.merchant ?? '';
  const expectedAmount = before.request?.amount ?? 0n;
  const expectedMerchantBalance = before.merchantBalance;
  const merchantBalance = request
    ? await fetchNativeBalance(client, request.merchant)
    : null;

  if (!request) reasons.push('The request could not be read back from the contract.');
  else {
    if (request.status !== 'PAYMENT_PENDING') {
      reasons.push(
        `Expected the request to be PAYMENT_PENDING, found ${request.status}.`,
      );
    }
    if (request.merchant.toLowerCase() !== expectedRecipient.toLowerCase()) {
      reasons.push('The recorded recipient does not match the request.');
    }
    if (request.amount !== expectedAmount) {
      reasons.push('The recorded amount does not match the request.');
    }
  }

  if (config.pendingTotal !== before.config.pendingTotal + expectedAmount) {
    reasons.push(
      `pendingTotal did not reserve ${expectedAmount} (expected ${
        before.config.pendingTotal + expectedAmount
      }, found ${config.pendingTotal}).`,
    );
  }
  if (config.totalPaid !== before.config.totalPaid) {
    reasons.push('totalPaid moved before the payment was finalized.');
  }

  // The transfer must have been *observed* to settle, one way or another:
  // through a finalized triggered transfer, or through the treasury and
  // merchant balances reflecting the exact debit and credit. A PAYMENT_PENDING
  // record with none of these is not evidence that money moved.
  const transferObserved = transferIds.length > 0;
  const treasuryDebited = config.balance === before.config.balance - expectedAmount;
  const merchantCredited =
    expectedMerchantBalance !== null &&
    merchantBalance !== null &&
    merchantBalance === expectedMerchantBalance + expectedAmount;

  if (!transferObserved && !treasuryDebited && !merchantCredited) {
    reasons.push(
      'No finalized transfer was observed and neither the treasury nor the merchant balance reflects the amount settling.',
    );
  }
  if (merchantBalance !== null && !merchantCredited) {
    reasons.push('The merchant balance does not reflect the transferred amount.');
  }

  return { transferIds, matched: reasons.length === 0, reasons };
}
