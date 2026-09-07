'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatGen, parseGen } from '@/lib/gen';
import {
  CHAIN,
  CONTRACT_ADDRESS,
  RPC_URL,
  STUDIO_URL,
  connectWalletNetwork,
  explorerAddressUrl,
  explorerTransactionUrl,
  fetchConfig,
  fetchMerchantAllowed,
  fetchNativeBalance,
  fetchRequests,
  injectedProvider,
  readClient,
  verifySettlementTransfer,
  write,
  writeClient,
  type PaymentRequest,
  type TreasuryConfig,
} from '@/lib/genlayer';

const EMPTY_CONFIG: TreasuryConfig = {
  owner: '',
  pendingOwner: '',
  authorizedAgent: '',
  perTransactionLimit: 0n,
  hourlyLimit: 0n,
  windowStart: 0,
  spendInWindow: 0n,
  remainingHourlyBudget: 0n,
  balance: 0n,
  totalPaid: 0n,
  pendingTotal: 0n,
  paused: false,
  requestCount: 0,
};

const DIGEST_HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const DIGEST_REF = `sha256:${DIGEST_HEX}`;

type PaymentSnapshot = {
  request: PaymentRequest | null;
  config: TreasuryConfig;
  merchantBalance: bigint | null;
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

type ContractState = 'missing' | 'loading' | 'online' | 'error';
type Notice = { text: string; bad?: boolean; hash?: string };

const short = (value: string) => (value ? `${value.slice(0, 6)}...${value.slice(-4)}` : 'Not set');
const gen = (value: bigint) => formatGen(value);
const sameAddress = (a: string, b: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function Dashboard() {
  const [contractAddress, setContractAddress] = useState(CONTRACT_ADDRESS);
  const [addressDraft, setAddressDraft] = useState(CONTRACT_ADDRESS);
  const [account, setAccount] = useState('');
  const [treasury, setTreasury] = useState(EMPTY_CONFIG);
  const [contractState, setContractState] = useState<ContractState>('missing');
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);

  const [fundAmount, setFundAmount] = useState('0.05');
  const [merchant, setMerchant] = useState('');
  const [merchantName, setMerchantName] = useState('AI compute provider');
  const [requestAmount, setRequestAmount] = useState('0.002');
  const [purpose, setPurpose] = useState(
    'Rent inference capacity for the customer support evaluation run',
  );
  const [evidence, setEvidence] = useState(
    `ticket=OPS-204; quote=Q-8821; vendor=acme-compute; digest=${DIGEST_REF}`,
  );
  const [agentDraft, setAgentDraft] = useState('');
  const [perTxDraft, setPerTxDraft] = useState('0.01');
  const [hourlyDraft, setHourlyDraft] = useState('0.05');
  const [reviewReason, setReviewReason] = useState('');
  const [deliveryRef, setDeliveryRef] = useState(`delivery=invoice INV-8821`);
  const [artifactDigest, setArtifactDigest] = useState(DIGEST_HEX);
  const [artifactRef, setArtifactRef] = useState('invoice Q-8821');
  const [pendingAuth, setPendingAuth] = useState<{
    requestId: string;
    hash: string;
    snapshot: PaymentSnapshot;
  } | null>(null);

  const selected = requests.find((item) => item.requestId === selectedId) ?? requests[0] ?? null;
  const isOwner = sameAddress(account, treasury.owner);
  const isAgent = sameAddress(account, treasury.authorizedAgent);
  const isMerchant = Boolean(selected && sameAddress(account, selected.merchant));
  const online = contractState === 'online';

  const note = useCallback((text: string, bad = false, hash?: string) => {
    setNotices((items) => [{ text, bad, hash }, ...items].slice(0, 12));
  }, []);

  const loadTreasury = useCallback(
    async (address = contractAddress) => {
      if (!ADDRESS_PATTERN.test(address)) {
        setContractState('missing');
        setTreasury(EMPTY_CONFIG);
        setRequests([]);
        return;
      }
      setContractState('loading');
      try {
        const client = readClient();
        const [config, queue] = await Promise.all([
          fetchConfig(client, address),
          fetchRequests(client, address),
        ]);
        setTreasury(config);
        setRequests(queue);
        setAgentDraft(config.authorizedAgent);
        setPerTxDraft(formatGen(config.perTransactionLimit, 18));
        setHourlyDraft(formatGen(config.hourlyLimit, 18));
        setContractState('online');
      } catch (error) {
        setContractState('error');
        note(message(error, 'Could not read the Guardian contract'), true);
      }
    },
    [contractAddress, note],
  );

  const loadAccount = useCallback(async () => {
    const provider = injectedProvider();
    if (!provider) return;
    const accounts = await provider.request({ method: 'eth_accounts' });
    setAccount(Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '');
  }, []);

  useEffect(() => {
    void loadAccount();
    const provider = injectedProvider();
    const changed = () => void loadAccount();
    provider?.on?.('accountsChanged', changed);
    return () => provider?.removeListener?.('accountsChanged', changed);
  }, [loadAccount]);

  useEffect(() => {
    void loadTreasury();
  }, [loadTreasury]);

  async function connect() {
    const provider = injectedProvider();
    if (!provider) {
      note('No injected wallet detected. Install MetaMask to operate this treasury.', true);
      return;
    }
    setBusy('connect');
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      const connected = accounts?.[0];
      if (!connected) throw new Error('The wallet returned no account');
      await connectWalletNetwork(writeClient(connected as `0x${string}`));
      setAccount(connected);
      note(`Wallet connected on ${CHAIN.name}.`);
    } catch (error) {
      note(message(error, 'Wallet connection was rejected'), true);
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    const provider = injectedProvider();
    // EIP-2255 revocation; not universally supported, so a failure is harmless.
    try {
      await provider?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    } catch {
      /* wallet does not support revocation; clearing local state is enough */
    }
    setAccount('');
    note('Wallet disconnected.');
  }

  /**
   * Run a contract write and refresh state only once the transaction has
   * FINALIZED with a successful execution. Nothing is reported as done at
   * acceptance: `write` waits for finalization and re-checks the execution
   * result before returning.
   */
  async function send(label: string, functionName: string, args: unknown[], value = 0n) {
    if (!account) {
      note('Connect a wallet first.', true);
      return false;
    }
    if (!ADDRESS_PATTERN.test(contractAddress)) {
      note('Connect a valid Guardian contract first.', true);
      return false;
    }
    setBusy(label);
    try {
      const client = writeClient(account as `0x${string}`);
      note(`${label}: submitted to consensus...`);
      const outcome = await write(client, contractAddress, functionName, args, value);
      note(`${label}: finalized and confirmed on-chain`, false, outcome.hash);
      await loadTreasury();
      return true;
    } catch (error) {
      note(`${label}: ${message(error, 'failed')}`, true);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function confirmDelivery() {
    if (!selected) return;
    const ok = await send('Delivery confirmation', 'confirm_delivery', [
      selected.requestId,
      deliveryRef.trim(),
    ]);
    if (ok) setSelectedId(selected.requestId);
  }

  async function commitArtifact() {
    const ok = await send('Artifact commit', 'commit_artifact', [
      artifactDigest.trim(),
      artifactRef.trim(),
    ]);
    if (ok) setSelectedId(selected?.requestId ?? '');
  }

  async function authorizePaymentExecute() {
    if (!selected) return;
    const client = writeClient(account as `0x${string}`);
    const rc = readClient();
    const snapshotRequest = await fetchRequests(rc, contractAddress, 100).then(
      (items) => items.find((item) => item.requestId === selected.requestId) ?? null,
    );
    const snapshotConfig = await fetchConfig(rc, contractAddress).catch(() => treasury);
    const merchantBalance = snapshotRequest
      ? await fetchNativeBalance(rc, snapshotRequest.merchant)
      : null;

    setBusy('Payment authorization');
    try {
      note('Payment authorization: submitted to consensus...');
      const outcome = await write(client, contractAddress, 'execute_payment', [
        selected.requestId,
      ]);
      setPendingAuth({
        requestId: selected.requestId,
        hash: outcome.hash,
        snapshot: {
          request: snapshotRequest,
          config: snapshotConfig,
          merchantBalance,
        },
      });
      note(
        'Payment authorized and finalized on-chain. It is PAYMENT_PENDING — nothing is paid yet. Finalize only after the transfer settles and reconciles.',
        false,
        outcome.hash,
      );
      await loadTreasury();
    } catch (error) {
      note(`Payment authorization: ${message(error, 'failed')}`, true);
    } finally {
      setBusy('');
    }
  }

  async function finalizeVerified() {
    if (!selected || !pendingAuth || pendingAuth.requestId !== selected.requestId) {
      note(
        'No tracked authorization for this request. Execute it from this console first so the transfer can be observed.',
        true,
      );
      return;
    }
    setBusy('Verify & finalize');
    try {
      const verification = await verifySettlementTransfer(
        readClient(),
        contractAddress,
        pendingAuth.hash,
        selected.requestId,
        pendingAuth.snapshot,
      );
      if (!verification.matched) {
        note(`Refusing to finalize: ${verification.reasons.join(' ')}`, true);
        return;
      }
      const reference = verification.transferIds[0] ?? (pendingAuth.hash as string);
      const ok = await send('Settlement finalization', 'finalize_payment', [
        selected.requestId,
        reference,
      ]);
      if (ok) setPendingAuth(null);
    } catch (error) {
      note(`Verify & finalize: ${message(error, 'failed')}`, true);
    } finally {
      setBusy('');
    }
  }

  async function unwindPayment() {
    if (!selected) return;
    const ok = await send('Pending payment unwind', 'resolve_pending_payment', [
      selected.requestId,
    ]);
    if (ok) {
      setPendingAuth(null);
      setSelectedId(selected.requestId);
    }
  }

  async function submitRequest() {
    if (!ADDRESS_PATTERN.test(merchant)) {
      note('Enter a valid merchant address.', true);
      return;
    }
    let amount: bigint;
    try {
      amount = parseGen(requestAmount);
    } catch (error) {
      note(message(error, 'Invalid amount'), true);
      return;
    }

    const allowed = await fetchMerchantAllowed(readClient(), contractAddress, merchant).catch(
      () => false,
    );
    if (!allowed) {
      note(
        'This merchant is not allowlisted. The request will be submitted and the contract will reject it — allowlist the merchant first to get an approvable request.',
      );
    }

    const requestId = `svc-${Date.now()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const ok = await send('Adjudicate request', 'submit_request', [
      requestId,
      merchant,
      amount,
      purpose,
      evidence,
      expiresAt,
    ]);
    if (ok) setSelectedId(requestId);
  }

  async function review(approve: boolean) {
    if (!selected) return;
    const reasoning =
      reviewReason.trim() ||
      (approve
        ? 'Owner reviewed the evidence and approved bounded execution.'
        : 'Owner rejected the business justification.');
    const ok = await send(approve ? 'Owner approval' : 'Owner rejection', 'review_request', [
      selected.requestId,
      approve,
      reasoning,
    ]);
    if (ok) setReviewReason('');
  }

  const utilization = useMemo(() => {
    if (treasury.hourlyLimit === 0n) return 0;
    return Number((treasury.spendInWindow * 10000n) / treasury.hourlyLimit) / 100;
  }, [treasury.hourlyLimit, treasury.spendInWindow]);

  const ownerLink = explorerAddressUrl(contractAddress);

  return (
    <main className="min-h-screen bg-[#080b0d] text-[#f3f5f0]">
      <nav className="border-b border-white/10 px-4 py-4 md:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-[13px] bg-[#0b0f11] ring-1 ring-white/10">
              <svg viewBox="0 0 64 64" fill="none" className="size-9" aria-hidden="true">
                <defs>
                  <linearGradient id="vestaFlameGrad" x1="16" y1="12" x2="48" y2="52" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#d8ff3e" />
                    <stop offset="1" stopColor="#51e49f" />
                  </linearGradient>
                </defs>
                <path
                  d="M32 10 C43 22 47 33 42.5 44.5 C40 49.5 36 53 32 53 C28 53 24 49.5 21.5 44.5 C17 33 21 22 32 10 Z"
                  fill="url(#vestaFlameGrad)"
                />
                <path
                  d="M32 25 C36 30 37.5 35.5 35.5 41 C34.5 43.5 33 45.5 32 45.5 C31 45.5 29.5 43.5 28.5 41 C26.5 35.5 28 30 32 25 Z"
                  fill="#0b0f11"
                />
              </svg>
            </div>
            <div>
              <strong className="text-sm tracking-wide">VESTA</strong>
              <p className="text-[11px] text-white/40">Treasury Guardian / {CHAIN.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className={`size-2 ${online ? 'bg-[#51e49f]' : 'bg-[#ff655f]'}`} />
            <span>{account ? short(account) : 'Wallet disconnected'}</span>
            {!account && (
              <button className="action" onClick={connect} disabled={Boolean(busy)}>
                {busy === 'connect' ? 'Connecting...' : 'Connect wallet'}
              </button>
            )}
            {account && (
              <button className="link-action" onClick={disconnect}>
                Disconnect
              </button>
            )}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-col justify-between gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-end">
          <div>
            <p className="mb-2 font-mono text-xs uppercase text-[#d8ff3e]">
              AI-native treasury control
            </p>
            <h1 className="text-4xl font-black leading-none sm:text-5xl">
              Bound the agent.
              <br />
              Move real GEN.
            </h1>
          </div>
          <div className="max-w-xl text-sm leading-6 text-white/50">
            Validator consensus adjudicates each purchase request inside the Intelligent Contract.
            The same contract then enforces merchant, amount, window, expiry, and pause policy on
            its own — and refuses payments the validators were willing to approve.
          </div>
        </header>

        <section className="mb-5 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Treasury balance"
            value={`${gen(treasury.balance)} GEN`}
            detail={online ? short(contractAddress) : 'Contract not connected'}
          />
          <Metric
            label="Remaining this hour"
            value={`${gen(treasury.remainingHourlyBudget)} GEN`}
            detail={`${utilization.toFixed(1)}% used`}
          />
          <Metric
            label="Per transaction"
            value={`${gen(treasury.perTransactionLimit)} GEN`}
            detail="Contract-enforced ceiling"
          />
          <Metric
            label="Autonomy state"
            value={treasury.paused ? 'PAUSED' : online ? 'ACTIVE' : 'OFFLINE'}
            detail={
              treasury.authorizedAgent ? `Agent ${short(treasury.authorizedAgent)}` : 'Awaiting contract'
            }
            danger={treasury.paused}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1.45fr_1fr]">
          <div className="space-y-5">
            <Panel title="Guardian connection" kicker="01 / Network authority">
              {online ? (
                <div className="connected-row">
                  <span className="good">&#10003; Connected</span>
                  <code>{short(contractAddress)}</code>
                </div>
              ) : (
                <>
                  <label>
                    Contract address
                    <input
                      value={addressDraft}
                      onChange={(event) => setAddressDraft(event.target.value)}
                      placeholder="0x..."
                    />
                  </label>
                  <button
                    className="action-wide"
                    onClick={() => {
                      const next = addressDraft.trim();
                      if (!ADDRESS_PATTERN.test(next)) {
                        note('Invalid Guardian address.', true);
                        return;
                      }
                      setContractAddress(next);
                    }}
                  >
                    {contractState === 'loading' ? 'Connecting...' : 'Connect contract'}
                  </button>
                </>
              )}
              <div className="facts">
                <span>Network</span>
                <strong>Studionet</strong>
                <span>RPC</span>
                <strong>{RPC_URL.replace(/^https?:\/\//, '')}</strong>
                <span>Status</span>
                <strong className={online ? 'good' : 'warn'}>{contractState}</strong>
                <span>Owner</span>
                <strong>{short(treasury.owner)}</strong>
              </div>
              {online && (
                <p className="hint">
                  <a href={ownerLink} target="_blank" rel="noreferrer">
                    Open the contract in the Studio explorer
                  </a>
                </p>
              )}
              {!ADDRESS_PATTERN.test(contractAddress) && (
                <p className="hint">
                  Deploy <code>contracts/guardian_budget.py</code> at{' '}
                  <a href={STUDIO_URL} target="_blank" rel="noreferrer">
                    studio.genlayer.com
                  </a>
                  , then paste the address above or set
                  <code> NEXT_PUBLIC_GUARDIAN_CONTRACT</code>. Fund your account with the 💧 button
                  in Studio&apos;s account selector.
                </p>
              )}
            </Panel>

            <Panel title="Treasury controls" kicker="02 / Owner signed">
              <label>
                Fund amount (GEN)
                <input value={fundAmount} onChange={(event) => setFundAmount(event.target.value)} />
              </label>
              <button
                className="action-wide"
                disabled={!online || Boolean(busy)}
                onClick={() => {
                  try {
                    void send('Treasury funding', 'fund', [], parseGen(fundAmount));
                  } catch (error) {
                    note(message(error, 'Invalid amount'), true);
                  }
                }}
              >
                Fund treasury
              </button>
              <button
                className={`action-wide ${treasury.paused ? 'resume' : 'danger'}`}
                disabled={!isOwner || Boolean(busy)}
                onClick={() =>
                  void send(
                    treasury.paused ? 'Resume autonomy' : 'Emergency pause',
                    'set_emergency_pause',
                    [!treasury.paused],
                  )
                }
              >
                {treasury.paused ? 'Resume autonomous execution' : 'Emergency stop'}
              </button>
              {!isOwner && (
                <p className="hint warn">
                  Anyone may fund the treasury. Pausing requires the contract owner.
                </p>
              )}
            </Panel>

            <Panel title="Policy settings" kicker="03 / Contract configuration">
              <label>
                Authorized agent
                <input
                  value={agentDraft}
                  onChange={(event) => setAgentDraft(event.target.value)}
                  placeholder="0x..."
                />
              </label>
              <button
                className="action-wide muted"
                disabled={!isOwner || Boolean(busy)}
                onClick={() => void send('Agent rotation', 'set_authorized_agent', [agentDraft.trim()])}
              >
                Rotate agent
              </button>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  Per tx GEN
                  <input value={perTxDraft} onChange={(event) => setPerTxDraft(event.target.value)} />
                </label>
                <label>
                  Hourly GEN
                  <input value={hourlyDraft} onChange={(event) => setHourlyDraft(event.target.value)} />
                </label>
              </div>
              <button
                className="action-wide muted"
                disabled={!isOwner || Boolean(busy)}
                onClick={() => {
                  try {
                    void send('Policy update', 'set_spending_limits', [
                      parseGen(perTxDraft),
                      parseGen(hourlyDraft),
                    ]);
                  } catch (error) {
                    note(message(error, 'Invalid limit'), true);
                  }
                }}
              >
                Update limits
              </button>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Merchant payment request" kicker="04 / Untrusted business input">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  Merchant label
                  <input
                    value={merchantName}
                    onChange={(event) => setMerchantName(event.target.value)}
                  />
                </label>
                <label>
                  Amount (GEN)
                  <input
                    value={requestAmount}
                    onChange={(event) => setRequestAmount(event.target.value)}
                  />
                </label>
              </div>
              <label>
                Merchant address
                <input
                  value={merchant}
                  onChange={(event) => setMerchant(event.target.value)}
                  placeholder="0x..."
                />
              </label>
              <label>
                Business purpose
                <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} />
              </label>
              <label>
                Evidence, separated by semicolons
                <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  className="action-wide muted"
                  disabled={!isOwner || !ADDRESS_PATTERN.test(merchant) || Boolean(busy)}
                  onClick={() =>
                    void send('Merchant allowlist', 'set_merchant_allowed', [merchant.trim(), true])
                  }
                >
                  Allowlist merchant
                </button>
                <button
                  className="action-wide"
                  disabled={!online || Boolean(busy)}
                  onClick={submitRequest}
                >
                  {busy === 'Adjudicate request' ? 'Validators judging...' : 'Submit for adjudication'}
                </button>
              </div>
              <p className="hint">
                Fixture label: {merchantName}. The purpose and evidence reach the validators as
                fenced, untrusted data, and the contract re-checks policy regardless of the verdict.
                For an autonomous approval the evidence&apos;s sha256 digest must have been committed
                on-chain by the merchant of record — requester-typed markers are not verification.
              </p>
            </Panel>

            <Panel title="Artifact registry" kicker="04b / Independent evidence">
              <label>
                Digest (sha256 hex)
                <input value={artifactDigest} onChange={(event) => setArtifactDigest(event.target.value)} />
              </label>
              <label>
                Reference
                <input value={artifactRef} onChange={(event) => setArtifactRef(event.target.value)} />
              </label>
              <button
                className="action-wide muted"
                disabled={!online || Boolean(busy)}
                onClick={commitArtifact}
              >
                Commit artifact (as this account)
              </button>
              <p className="hint">
                The issuer — the merchant of record — commits the deliverable digest here. It is an
                attributable, on-chain commitment a requester cannot fabricate. Connect the merchant
                account to commit its digest before submitting a request that cites it.
              </p>
            </Panel>

            <Panel title="Decision queue" kicker="05 / On-chain record">
              <div className="queue">
                {requests.length === 0 && (
                  <p className="empty">
                    No requests yet. Submit the fixture above to start the business loop.
                  </p>
                )}
                {requests.map((item) => (
                  <button
                    key={item.requestId}
                    onClick={() => setSelectedId(item.requestId)}
                    className={`queue-item ${selected?.requestId === item.requestId ? 'selected' : ''}`}
                  >
                    <span>
                      <strong>{item.purpose}</strong>
                      <small>
                        {item.requestId} / {short(item.merchant)}
                      </small>
                    </span>
                    <span className={`status ${item.status.toLowerCase()}`}>
                      {item.status.replaceAll('_', ' ')}
                    </span>
                    <b>{gen(item.amount)} GEN</b>
                  </button>
                ))}
              </div>
            </Panel>

            {selected && (
              <Panel
                title="Adjudicated decision"
                kicker={`06 / ${selected.decidedBy.replaceAll('_', ' ')}`}
              >
                <div className="decision-head">
                  <span className={`decision-mark ${selected.decision}`}>{selected.decision}</span>
                  <span>
                    Risk <strong>{selected.riskScore} / 100</strong>
                  </span>
                  <span>
                    Confidence <strong>{selected.confidence}%</strong>
                  </span>
                </div>
                <p className="reasoning">{selected.reasoning}</p>
                <p className="expected">
                  <span>Expected value</span>
                  {selected.expectedValue}
                </p>
                <div className="evidence-list">
                  {selected.evidence.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <div className="facts">
                  <span>Submitted by</span>
                  <strong>{short(selected.submittedBy)}</strong>
                  <span>Expires</span>
                  <strong>{new Date(selected.expiresAt * 1000).toLocaleString()}</strong>
                  {selected.deliveryConfirmedBy &&
                    sameAddress(selected.deliveryConfirmedBy, selected.merchant) && (
                      <>
                        <span>Delivery confirmed</span>
                        <strong>{short(selected.deliveryConfirmedBy)}</strong>
                      </>
                    )}
                  {selected.settlementReference && (
                    <>
                      <span>Settlement ref</span>
                      <strong>{short(selected.settlementReference)}</strong>
                    </>
                  )}
                  {selected.artifactDigest && (
                    <>
                      <span>Artifact digest</span>
                      <strong className={selected.artifactVerified ? 'good' : 'warn'}>
                        {selected.artifactVerified ? 'merchant-committed' : 'unverified'}
                      </strong>
                    </>
                  )}
                  {selected.paidAt && (
                    <>
                      <span>Paid</span>
                      <strong>{new Date(selected.paidAt).toLocaleString()}</strong>
                    </>
                  )}
                </div>

                {selected.status === 'MANUAL_REVIEW' && (
                  <>
                    <label>
                      Review reasoning
                      <textarea
                        value={reviewReason}
                        onChange={(event) => setReviewReason(event.target.value)}
                        placeholder="Why are you approving or rejecting this?"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        className="action-wide"
                        disabled={!isOwner || Boolean(busy)}
                        onClick={() => void review(true)}
                      >
                        Owner approve
                      </button>
                      <button
                        className="action-wide danger"
                        disabled={!isOwner || Boolean(busy)}
                        onClick={() => void review(false)}
                      >
                        Owner reject
                      </button>
                    </div>
                    {!isOwner && (
                      <p className="hint warn">Only the contract owner can resolve a manual review.</p>
                    )}
                  </>
                )}

                {selected.status === 'APPROVED' && (
                  <>
                    {isMerchant && (
                      <>
                        <label>
                          Delivery reference
                          <textarea
                            value={deliveryRef}
                            onChange={(event) => setDeliveryRef(event.target.value)}
                            placeholder="Attach the verifiable deliverable, e.g. delivery=invoice INV-8821"
                          />
                        </label>
                        <button
                          className="action-wide muted"
                          disabled={!isMerchant || Boolean(busy)}
                          onClick={confirmDelivery}
                        >
                          Confirm delivery (merchant)
                        </button>
                        {!isOwner && !isAgent && (
                          <p className="hint">
                            Confirming delivery is what releases the authorized agent to execute this payment.
                          </p>
                        )}
                      </>
                    )}
                    {selected.deliveryConfirmedBy &&
                      sameAddress(selected.deliveryConfirmedBy, selected.merchant) && (
                        <button
                          className="action-wide"
                          disabled={!isAgent || Boolean(busy)}
                          onClick={() => void authorizePaymentExecute()}
                        >
                          Execute payment (agent)
                        </button>
                      )}
                    {isAgent &&
                      !(
                        selected.deliveryConfirmedBy &&
                        sameAddress(selected.deliveryConfirmedBy, selected.merchant)
                      ) && (
                        <p className="hint warn">
                          Delivery is not yet confirmed by the merchant, so the agent cannot execute.
                          An approved narrative alone does not authorize a payment.
                        </p>
                      )}
                    {isOwner && (
                      <button
                        className="action-wide"
                        disabled={!isOwner || Boolean(busy)}
                        onClick={() => void authorizePaymentExecute()}
                      >
                        Execute as owner (override)
                      </button>
                    )}
                    {!isOwner && !isAgent && !isMerchant && (
                      <p className="hint warn">
                        Connect the authorized agent, the merchant, or the owner to move this request forward.
                      </p>
                    )}
                  </>
                )}

                {selected.status === 'PAYMENT_PENDING' && (
                  <>
                    <p className="hint warn">
                      Payment is authorized and the transfer is settling on the chain layer — it is
                      not yet reported as paid. Nothing here is finalized on a typed reference: the
                      owner must verify that the triggered transfer was observed to finalize and that
                      the state reconciles, and only then finalize.
                    </p>
                    {pendingAuth && pendingAuth.requestId === selected.requestId && isOwner && (
                      <button
                        className="action-wide"
                        disabled={Boolean(busy)}
                        onClick={() => void finalizeVerified()}
                      >
                        Verify transfer and finalize
                      </button>
                    )}
                    {isOwner && (
                      <button
                        className="action-wide danger"
                        disabled={Boolean(busy)}
                        onClick={unwindPayment}
                      >
                        Mark transfer failed (unwind)
                      </button>
                    )}
                    {!isOwner && (
                      <p className="hint warn">
                        Only the owner can finalize or unwind a pending payment after verifying the
                        transfer. The merchant confirms delivery; the owner settles.
                      </p>
                    )}
                    {isOwner && (!pendingAuth || pendingAuth.requestId !== selected.requestId) && (
                      <p className="hint">
                        To finalize, the authorization must have been executed from this console so its
                        triggered transfer can be observed. Select that request and use &quot;Execute&quot;,
                        then come back here.
                      </p>
                    )}
                  </>
                )}
              </Panel>
            )}
          </div>

          <div className="space-y-5">
            <Panel title="Spending window" kicker="07 / Fixed one hour">
              <div className="window-number">
                {gen(treasury.spendInWindow)} <span>/ {gen(treasury.hourlyLimit)} GEN</span>
              </div>
              <div className="bar">
                <i style={{ width: `${Math.min(utilization, 100)}%` }} />
              </div>
              <div className="facts">
                <span>Window start</span>
                <strong>
                  {treasury.windowStart
                    ? new Date(treasury.windowStart * 1000).toLocaleTimeString()
                    : '-'}
                </strong>
                <span>Remaining</span>
                <strong>{gen(treasury.remainingHourlyBudget)} GEN</strong>
                <span>In flight (pending)</span>
                <strong>{gen(treasury.pendingTotal)} GEN</strong>
                <span>Total paid (finalized)</span>
                <strong>{gen(treasury.totalPaid)} GEN</strong>
              </div>
            </Panel>

            <Panel title="Session activity" kicker="08 / Verifiable outcomes">
              <div className="timeline">
                {notices.map((item, index) => (
                  <div key={`${item.text}-${index}`}>
                    <i className={item.bad ? 'bad' : ''} />
                    <span>
                      <strong>{item.bad ? 'Failure' : 'Event'}</strong>
                      <small>
                        {item.text}
                        {item.hash && (
                          <>
                            <br />
                            <a
                              href={explorerTransactionUrl(item.hash)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open explorer transaction
                            </a>
                          </>
                        )}
                      </small>
                    </span>
                  </div>
                ))}
                {notices.length === 0 && <p className="empty">Transaction events appear here.</p>}
              </div>
            </Panel>

            <Panel title="Rejection paths to try" kicker="09 / Contract over model">
              <ul className="checks">
                <li>Submit an amount over the per-transaction limit</li>
                <li>Repeat an identical merchant, amount, and purpose</li>
                <li>Submit for a merchant that is not allowlisted</li>
                <li>Submit narrative-only evidence with no verifiable artifact</li>
                <li>Try to execute as the agent before the merchant confirms delivery</li>
                <li>Approve a request, de-allowlist the merchant, then execute it</li>
                <li>Pause the treasury, then execute an approved request</li>
                <li>Submit evidence containing instruction-like text</li>
              </ul>
            </Panel>
          </div>
        </section>

        <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-white/10 py-5 font-mono text-[10px] uppercase text-white/35 sm:flex-row">
          <span>
            {CHAIN.name} / Chain {CHAIN.id} / Native GEN / Testnet
          </span>
          <span>{treasury.requestCount} adjudicated requests on-chain</span>
          <span>Decisions by validator LLM consensus</span>
        </footer>
      </div>
    </main>
  );
}

function Panel({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  danger,
}: {
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={danger ? 'text-[#ff655f]' : ''}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
