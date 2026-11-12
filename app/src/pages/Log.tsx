import { useMemo } from 'react';
import { solscan } from '../components/ui';
import { DEMO } from '../config';
import { clock, pct, short, sol } from '../lib/format';
import { friendlyError } from '../lib/errors';
import { useLaunches, useLog } from '../lib/hooks';
import type { LogRow } from '../lib/types';

const evClass = (e: LogRow['event']) =>
  e === 'RESOLVED HIT' || e === 'STAKE HIT' ? 'hit' : e === 'RESOLVED MISS' || e === 'STAKE MISS' ? 'miss' : e === 'VOID' ? 'void' : 'gold';

export function LogTable({ rows, coinFor, compact = false }: { rows: LogRow[]; coinFor: (mint: string) => string; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            {!compact && <th>Coin</th>}
            <th>Wallet</th>
            <th>Amount</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono small">{clock(r.time)}</td>
              <td>
                <span className={`ev ${evClass(r.event)}`}>{r.event}</span>
                {r.evidence && (
                  <div className="mono small muted" style={{ marginTop: 4 }}>
                    curve {pct(r.evidence.pctBps)}% · migrated: {r.evidence.complete ? 'yes' : 'no'} · checked at slot {r.evidence.slot.toLocaleString()}
                  </div>
                )}
              </td>
              {!compact && (
                <td>
                  <a href={`#/coin/${r.mint}`}>{coinFor(r.mint)}</a>
                </td>
              )}
              <td className="mono small">{r.wallet === 'keeper' ? 'keeper' : DEMO ? short(r.wallet) : <a href={solscan.account(r.wallet)} target="_blank" rel="noreferrer">{short(r.wallet)}</a>}</td>
              <td className="mono small">{r.amount === null ? '—' : r.loss ? 'loss settled' : `${sol(r.amount)} SOL`}</td>
              <td className="mono small">
                {r.sig ? (
                  <a href={solscan.tx(r.sig)} target="_blank" rel="noreferrer">
                    {short(r.sig, 5)}
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Log() {
  const { data, loading, error } = useLog(undefined, 200);
  const { data: launches } = useLaunches(60_000);
  const names = useMemo(() => new Map((launches ?? []).map((l) => [l.mint, l.meta?.symbol ? `$${l.meta.symbol}` : short(l.mint)])), [launches]);
  const coinFor = (m: string) => names.get(m) ?? short(m);

  return (
    <main className="page" id="main" tabIndex={-1}>
      <div className="wrap">
        <div className="page-head">
          <h1 style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}>
            The <em>log.</em>
          </h1>
          <p className="lede">Every launch, every stake, every resolution. Public transactions, nothing off the books.</p>
        </div>
        {error && !data ? (
          <div className="empty">{friendlyError(error)}</div>
        ) : loading && !data ? (
          <div className="skeleton" style={{ minHeight: 320 }} />
        ) : data && data.length ? (
          <LogTable rows={data} coinFor={coinFor} />
        ) : (
          <div className="empty">Nothing logged yet.</div>
        )}
      </div>
    </main>
  );
}
