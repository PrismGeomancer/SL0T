import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResolveOverlay } from '../components/ResolveOverlay';
import { CoinImage, coinName, coinTicker, CurveBar, pumpUrl, ResolveCountdown, solscan, SplitBar, StatusChip } from '../components/ui';
import { DEMO } from '../config';
import { fetchStake } from '../lib/chain';
import { friendlyError } from '../lib/errors';
import { hhmm, pct, short, sol, toLamports } from '../lib/format';
import { go, useChainConfig, useGuestStatus, useLaunch, useLog, useNow, usePoll, useRematch } from '../lib/hooks';
import { cappedLost, rematchAmount, returnPer, stakeOutcome } from '../lib/math';
import { toast, useStore } from '../lib/store';
import type { LaunchRow, Side, StakeRow } from '../lib/types';
import { LogTable } from './Log';

const L = 1_000_000_000;

export default function Coin({ mint }: { mint: string }) {
  const valid = useMemo(() => {
    try {
      return DEMO || !!new PublicKey(mint);
    } catch {
      return false;
    }
  }, [mint]);
  const { data: launch, loading, error } = useLaunch(valid ? mint : null);

  if (!valid || (!loading && !launch && !error))
    return (
      <main className="page wrap" id="main">
        <div className="empty">No coin with that mint on SL0T.</div>
      </main>
    );
  if (!launch)
    return (
      <main className="page wrap" id="main">
        {error ? <div className="empty">{friendlyError(error)}</div> : <div className="skeleton" style={{ minHeight: 420 }} />}
      </main>
    );
  return <CoinView launch={launch} />;
}

function CoinView({ launch }: { launch: LaunchRow }) {
  const cfg = useChainConfig();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const guest = useGuestStatus();
  const now = useNow(1000);
  const refresh = useStore((s) => s.refresh);
  const { data: rematch, reload: reloadRematch } = useRematch();
  const me = wallet.publicKey?.toBase58() ?? '';
  const { data: stake, reload: reloadStake } = usePoll<StakeRow | null>(
    async () => (me && !DEMO ? fetchStake(new PublicKey(launch.address), new PublicKey(me)) : null),
    [me, launch.address],
    20_000,
  );
  const { data: activity } = useLog(launch.address, 60);

  const [side, setSide] = useState<Side>('hit');
  const [amount, setAmount] = useState('0.1');
  const [useRm, setUseRm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState(false);

  const ticker = coinTicker(launch);
  const open = launch.state === 'open';
  const stakesOpen = open && now < launch.stakeCloseAt;

  const rematchReady = !!rematch && !rematch.used && rematch.expiresAt > now && rematch.sourceLaunch !== launch.address;
  const rmLamports = rematch ? rematchAmount(rematch.amountLost) : 0;
  const usingRematch = rematchReady && useRm;
  const lamports = usingRematch ? rmLamports : toLamports(amount) ?? 0;
  const lockedSide = stake?.side ?? null;
  const effSide: Side = lockedSide ?? side;

  // resolve moment: the launch flips while you're watching and you have a position
  const prevState = useRef(launch.state);
  useEffect(() => {
    if (prevState.current === 'open' && launch.state !== 'open' && stake) setOverlay(true);
    prevState.current = launch.state;
  }, [launch.state, stake]);

  const outcome = stake ? stakeOutcome(stake, launch) : null;

  const lock = async () => {
    if (DEMO) return toast("SL0T isn't live yet, so nothing was locked.", 'info');
    if (!anchorWallet) return setVisible(true);
    if (guest !== 'friend') return toast('This floor is guest list only.', 'err');
    if (!stakesOpen) return toast('Stakes on this coin are closed.', 'err');
    if (lamports <= 0) return toast('Transaction failed: amount must be more than zero', 'err');
    if (cfg && (stake?.amount ?? 0) + lamports > cfg.maxStake) return toast(`Max stake is ${sol(cfg.maxStake)} SOL.`, 'err');
    setBusy(true);
    try {
      toast('Signing… check your wallet.');
      const { sendStake } = await import('../lib/tx');
      const sig = await sendStake(anchorWallet, launch, effSide, lamports, usingRematch);
      toast(usingRematch ? 'Rematch locked. Good luck. Actually, luck has nothing to do with it.' : `Locked ${sol(lamports)} SOL on ${effSide.toUpperCase()}.`, 'ok', { href: solscan.tx(sig), label: 'Solscan' });
      void reloadStake();
      void reloadRematch();
      refresh();
    } catch (e) {
      toast(friendlyError(e, { needLamports: lamports + 3_000_000, rematchLamports: rmLamports, maxStakeLamports: cfg?.maxStake }), 'err');
    } finally {
      setBusy(false);
    }
  };

  const claim = useCallback(async () => {
    if (!anchorWallet || !stake || !outcome || outcome.kind === 'pending') return;
    setBusy(true);
    try {
      toast('Signing… check your wallet.');
      const { claimIx, signAndSend } = await import('../lib/tx');
      const won = outcome.kind !== 'lost';
      const sig = (await signAndSend(anchorWallet, [{ ixs: [await claimIx(anchorWallet, launch, won)] }]))[0];
      if (won) toast(`Claimed ${sol(outcome.payout)} SOL.`, 'ok', { href: solscan.tx(sig), label: 'Solscan' });
      else if (cfg) {
        const rm = rematchAmount(cappedLost(stake.amount, cfg.maxStake));
        toast(`Rematch ready: ${sol(rm)} SOL · expires in ${hhmm(cfg.rematchSecs)}`, 'ok');
      }
      setOverlay(false);
      void reloadStake();
      void reloadRematch();
      refresh();
      if (!won) go('/floor');
    } catch (e) {
      toast(friendlyError(e), 'err');
    } finally {
      setBusy(false);
    }
  }, [anchorWallet, stake, outcome, launch, cfg, reloadStake, reloadRematch, refresh]);

  const closeOverlay = useCallback(() => setOverlay(false), []);

  const ret = (s: Side) => returnPer(L, s, launch.hitTotal, launch.missTotal);

  return (
    <main className="page" id="main" tabIndex={-1}>
      <div className="wrap stack" style={{ gap: 24 }}>
        <div className="coin-head">
          <CoinImage launch={launch} size="lg" />
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <h1>{coinName(launch)}</h1>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ color: 'var(--muted)' }}>${ticker}</span>
              <StatusChip state={launch.state} />
              <ResolveCountdown launch={launch} />
            </div>
          </div>
          <div className="links" style={{ marginLeft: 'auto' }}>
            {!launch.demo && (
              <>
                <a className="btn sm ghost" href={solscan.token(launch.mint)} target="_blank" rel="noreferrer">
                  Solscan
                </a>
                <a className="btn sm ghost" href={pumpUrl(launch.mint)} target="_blank" rel="noreferrer">
                  pump.fun
                </a>
              </>
            )}
            <button className="btn sm ghost" onClick={() => void navigator.clipboard?.writeText(launch.mint).then(() => toast('Copied.', 'ok'))}>
              Copy mint
            </button>
          </div>
        </div>

        <div className="panel">
          <CurveBar
            bps={launch.curvePctBps}
            complete={launch.curveComplete}
            label={launch.state === 'hit' || launch.curveComplete ? 'Graduated. The reels say HIT.' : `${pct(launch.curvePctBps)}% to graduation`}
          />
        </div>

        <div className="two-col">
          <div className="panel stack">
            <div className="row">
              <span className="mono" style={{ color: 'var(--hit)', fontSize: 18 }}>HIT {sol(launch.hitTotal)} SOL</span>
              <span className="mono" style={{ color: 'var(--miss)', fontSize: 18 }}>MISS {sol(launch.missTotal)} SOL</span>
            </div>
            <SplitBar hit={launch.hitTotal} miss={launch.missTotal} />
            <p className="small mono">If HIT wins, 1 SOL on HIT returns {sol(ret('hit'))} SOL</p>
            <p className="small mono">If MISS wins, 1 SOL on MISS returns {sol(ret('miss'))} SOL</p>
            <hr className="hr" />

            {stakesOpen ? (
              <>
                <div className="seg" role="group" aria-label="Side">
                  {(['hit', 'miss'] as Side[]).map((s) => (
                    <button key={s} type="button" className={s} aria-pressed={effSide === s} disabled={!!lockedSide && lockedSide !== s} onClick={() => setSide(s)}>
                      {s.toUpperCase()}
                    </button>
                  ))}
                </div>
                {rematchReady && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="chip rematch">REMATCH READY</span>
                    <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" checked={useRm} onChange={(e) => setUseRm(e.target.checked)} /> use it here
                    </label>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="amt">Amount</label>
                  <div className="input-suffix">
                    <input
                      id="amt"
                      className="input mono"
                      inputMode="decimal"
                      value={usingRematch ? sol(rmLamports, 9) : amount}
                      readOnly={usingRematch}
                      aria-readonly={usingRematch}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <span>SOL</span>
                  </div>
                  {usingRematch && <span className="hint">Rematch amount is fixed at {sol(rmLamports)} SOL.</span>}
                  {cfg && <span className="hint">Max stake per pull: {sol(cfg.maxStake)} SOL.</span>}
                </div>
                {!wallet.publicKey && !DEMO ? (
                  <button className="btn primary block" onClick={() => setVisible(true)}>
                    Connect wallet
                  </button>
                ) : (
                  <button className={`btn primary block ${effSide === 'hit' ? 'green' : ''}`} disabled={busy} onClick={() => void lock()}>
                    Lock {sol(lamports)} SOL on {effSide.toUpperCase()}
                  </button>
                )}
                {guest === 'not-friend' && <p className="small">This floor is guest list only.</p>}
              </>
            ) : open ? (
              <p className="lede">Stakes are closed. Now we wait.</p>
            ) : (
              <p className="lede">Resolved {launch.state.toUpperCase()}.</p>
            )}
          </div>

          <div className="stack">
            <div className="panel stack" aria-live="polite">
              <p className="label">Your position</p>
              {!wallet.publicKey ? (
                <p className="muted">Connect a wallet to see your position.</p>
              ) : !stake ? (
                <p className="muted">{DEMO ? 'No positions yet.' : 'No position on this coin.'}</p>
              ) : outcome?.kind === 'pending' ? (
                <p className="lede">
                  You have {sol(stake.amount)} SOL on {stake.side.toUpperCase()}
                  {stake.isRematch ? ' (rematch)' : ''}.
                </p>
              ) : outcome?.kind === 'won' || outcome?.kind === 'refund' ? (
                <>
                  <p className="lede">{outcome.kind === 'won' ? `You won ${sol(outcome.payout)} SOL` : `Refund ready: ${sol(outcome.payout)} SOL`}</p>
                  <button className="btn green primary" disabled={busy} onClick={() => void claim()}>
                    {outcome.kind === 'won' ? 'Claim' : 'Claim refund'}
                  </button>
                </>
              ) : outcome?.kind === 'lost' ? (
                <>
                  <p className="lede">You lost {sol(outcome.amount)} SOL. Run it back?</p>
                  <button className="btn gold primary" disabled={busy} onClick={() => void claim()}>
                    Run it back
                  </button>
                </>
              ) : null}
            </div>
            {launch.state !== 'open' && (
              <div className="panel small mono">
                curve {pct(launch.evidencePctBps)}% · migrated: {launch.evidenceComplete ? 'yes' : 'no'} · checked at slot {launch.evidenceSlot.toLocaleString()}
              </div>
            )}
            <div className="panel small">
              Creator <span className="mono">{short(launch.creator)}</span>
            </div>
          </div>
        </div>

        <section aria-labelledby="act-h" className="stack">
          <h3 id="act-h">Activity</h3>
          {activity && activity.length ? <LogTable rows={activity} coinFor={() => `$${ticker}`} compact /> : <div className="empty">Nothing logged yet.</div>}
        </section>
      </div>

      {overlay && launch.state !== 'open' && (
        <ResolveOverlay
          state={launch.state}
          ticker={ticker}
          payout={outcome && outcome.kind !== 'pending' && outcome.kind !== 'lost' ? outcome.payout : 0}
          canRematch={outcome?.kind === 'lost'}
          onClaim={() => void claim()}
          onRematch={() => void claim()}
          onClose={closeOverlay}
        />
      )}
    </main>
  );
}
