import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useMemo, useState } from 'react';
import { coinTicker, solscan, StatusChip } from '../components/ui';
import { DEMO } from '../config';
import { friendlyError } from '../lib/errors';
import { hhmm, signedSol, sol } from '../lib/format';
import { useLaunches, useLog, useMyStakes, useNow, useRematch } from '../lib/hooks';
import { stakeOutcome } from '../lib/math';
import { toast, useStore } from '../lib/store';

export default function Me() {
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const now = useNow(1000);
  const refresh = useStore((s) => s.refresh);
  const { data: launches } = useLaunches(30_000);
  const { data: stakes, reload: reloadStakes } = useMyStakes();
  const { data: rematch, reload: reloadRematch } = useRematch();
  const { data: log } = useLog(undefined, 300);
  const [busy, setBusy] = useState(false);
  const me = publicKey?.toBase58() ?? '';

  const byAddr = useMemo(() => new Map((launches ?? []).map((l) => [l.address, l])), [launches]);
  const mine = (launches ?? []).filter((l) => l.creator === me && !l.demo);
  const net = (log ?? []).filter((r) => r.wallet === me && r.payout !== undefined).reduce((a, r) => a + (r.payout ?? 0), 0);

  const rematchReady = !!rematch && !rematch.used && rematch.expiresAt > now;

  const positions = (stakes ?? []).map((s) => ({ stake: s, launch: byAddr.get(s.launch) })).filter((x) => x.launch);
  const resolved = positions.filter((p) => p.launch!.state !== 'open');
  const claimItems = resolved
    .map((p) => ({ ...p, outcome: stakeOutcome(p.stake, p.launch!) }))
    // settling a loss writes your one rematch slot: don't overwrite a live rematch from "Claim all"
    .filter((p) => p.outcome.kind !== 'lost' || !rematchReady);
  const claimTotal = claimItems.reduce((a, p) => a + (p.outcome.kind === 'won' || p.outcome.kind === 'refund' ? p.outcome.payout : 0), 0);

  const claimAll = async () => {
    if (!anchorWallet || !claimItems.length) return;
    setBusy(true);
    try {
      toast('Signing… check your wallet.');
      const { buildClaimBatches, signAndSend } = await import('../lib/tx');
      const batches = await buildClaimBatches(
        anchorWallet,
        claimItems.map((p) => ({ launch: p.launch!, stake: p.stake, won: p.outcome.kind !== 'lost' })),
      );
      const sigs = await signAndSend(anchorWallet, batches);
      toast(`Claimed ${sol(claimTotal)} SOL.`, 'ok', { href: solscan.tx(sigs[sigs.length - 1]), label: 'Solscan' });
      void reloadStakes();
      void reloadRematch();
      refresh();
    } catch (e) {
      toast(friendlyError(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" id="main" tabIndex={-1}>
      <div className="wrap stack" style={{ gap: 24 }}>
        <div className="page-head">
          <h1 style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}>
            Your <em>pulls.</em>
          </h1>
        </div>
        {DEMO ? (
          <div className="empty">Demo mode: your pulls show up here once the program is live.</div>
        ) : !publicKey ? (
          <div className="panel gate">
            <p className="lede">Connect a wallet to see your pulls.</p>
            <button className="btn primary" onClick={() => setVisible(true)}>
              Connect wallet
            </button>
          </div>
        ) : (
          <>
            <div className="stats">
              <div className="card stat">
                <div className="k">Launched</div>
                <div className="n">{mine.length}</div>
              </div>
              <div className="card stat">
                <div className="k">Hits</div>
                <div className="n" style={{ color: 'var(--hit)' }}>{mine.filter((l) => l.state === 'hit').length}</div>
              </div>
              <div className="card stat">
                <div className="k">Misses</div>
                <div className="n" style={{ color: 'var(--miss)' }}>{mine.filter((l) => l.state === 'miss').length}</div>
              </div>
              <div className="card stat">
                <div className="k">Net</div>
                <div className="n mono">{signedSol(net)} SOL</div>
              </div>
            </div>

            <div className="two-col">
              <div className="panel stack" aria-live="polite">
                <p className="label">Rematch</p>
                {rematchReady ? (
                  <>
                    <p className="lede">
                      <span className="chip rematch" style={{ marginRight: 10 }}>
                        REMATCH READY
                      </span>
                      Rematch ready: {sol(rematch!.amountLost * 2)} SOL · expires in {hhmm(rematch!.expiresAt - now)}
                    </p>
                    <a className="btn gold" href="#/floor">
                      Run it back
                    </a>
                  </>
                ) : (
                  <p className="lede muted">No rematch waiting.</p>
                )}
              </div>
              <div className="panel stack">
                <p className="label">Claims</p>
                <p className="lede">
                  {claimItems.length} claims waiting · {sol(claimTotal)} SOL
                </p>
                <button className="btn green primary" disabled={!claimItems.length || busy} onClick={() => void claimAll()}>
                  Claim all
                </button>
                {rematchReady && resolved.some((p) => stakeOutcome(p.stake, p.launch!).kind === 'lost') && (
                  <p className="small">Losses wait until your current rematch is used or expires, so it isn't overwritten.</p>
                )}
              </div>
            </div>

            <section className="stack" aria-labelledby="pos-h">
              <h3 id="pos-h">Positions</h3>
              {positions.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Coin</th>
                        <th>State</th>
                        <th>Side</th>
                        <th>Amount</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map(({ stake, launch }) => {
                        const o = stakeOutcome(stake, launch!);
                        return (
                          <tr key={stake.address}>
                            <td>
                              <a href={`#/coin/${launch!.mint}`}>${coinTicker(launch!)}</a>
                            </td>
                            <td>
                              <StatusChip state={launch!.state} />
                            </td>
                            <td className="mono">
                              {stake.side.toUpperCase()}
                              {stake.isRematch ? ' · rematch' : ''}
                            </td>
                            <td className="mono">{sol(stake.amount)} SOL</td>
                            <td className="mono">
                              {o.kind === 'pending' ? 'spinning' : o.kind === 'lost' ? `lost ${sol(o.amount)}` : `${o.kind === 'won' ? 'won' : 'refund'} ${sol(o.payout)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">You haven't pulled yet.</div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
