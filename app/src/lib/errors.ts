import { sol } from './format';

/** Map any wallet / RPC / program error to a copy-deck error string. */
export function friendlyError(e: unknown, ctx: { needLamports?: number; rematchLamports?: number; maxStakeLamports?: number } = {}): string {
  const err = e as { message?: string; name?: string; logs?: string[]; code?: number; error?: { errorCode?: { code?: string } } };
  const text = [err?.name, err?.message, err?.error?.errorCode?.code, ...(err?.logs ?? [])].filter(Boolean).join(' | ');

  if (/User rejected|rejected the request|cancell?ed|WalletSignTransactionError|Approval Denied|declined/i.test(text) || err?.code === 4001)
    return 'You cancelled the signature. No harm done.';
  if (/NotOnGuestList/.test(text)) return 'This floor is guest list only.';
  if (/StakesClosed/.test(text)) return 'Stakes on this coin are closed.';
  if (/RematchExpired/.test(text)) return 'Your rematch expired.';
  if (/RematchAmountFixed/.test(text))
    return `Rematch amount is fixed at ${ctx.rematchLamports ? sol(ctx.rematchLamports) : '2x'} SOL.`;
  if (/MaxStakeExceeded|RematchAboveMax/.test(text))
    return `Max stake is ${ctx.maxStakeLamports ? sol(ctx.maxStakeLamports) : 'the'} SOL.`;
  if (/insufficient (funds|lamports)|0x1\b|Attempt to debit an account but found no record of a prior credit/i.test(text))
    return `Not enough SOL. You need ${ctx.needLamports ? sol(ctx.needLamports, 4) : 'more'} SOL including fees.`;
  if (/upload/i.test(text) && /fail|error|irys|bundlr/i.test(text)) return 'Image upload failed. Try a smaller file.';
  if (/blockhash|expired|timed? ?out|was not confirmed|429|Too Many Requests|congest/i.test(text)) return 'The network is busy. Try again in a moment.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|fetch failed|Load failed/i.test(text))
    return "Couldn't reach the RPC. Check your connection or try again.";

  const anchorMsg = text.match(/Error Message: ([^.|]+)/)?.[1];
  const reason = (anchorMsg || err?.message || String(e)).replace(/\s+/g, ' ').slice(0, 90);
  return `Transaction failed: ${reason}`;
}
