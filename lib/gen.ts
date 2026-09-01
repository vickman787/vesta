/**
 * GEN amount formatting.
 *
 * GEN uses 18 decimals, like ether. These two helpers replace a viem import so
 * the app does not take a direct dependency on it purely for unit conversion.
 */

const DECIMALS = 18n;
const ONE = 10n ** DECIMALS;

/** Parse a decimal GEN string into wei. Throws on anything malformed. */
export function parseGen(value: string): bigint {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`"${value}" is not a positive decimal amount`);
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > Number(DECIMALS)) {
    throw new Error(`Amounts support at most ${DECIMALS} decimal places`);
  }
  return BigInt(whole) * ONE + BigInt(fraction.padEnd(Number(DECIMALS), '0') || '0');
}

/** Format wei as a GEN string, trimmed to `precision` decimal places. */
export function formatGen(value: bigint, precision = 5): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / ONE;
  const fraction = (magnitude % ONE).toString().padStart(Number(DECIMALS), '0').slice(0, precision).replace(/0+$/, '');
  const rendered = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${rendered}` : rendered;
}
