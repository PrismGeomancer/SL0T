import { useWallet } from '@solana/wallet-adapter-react';
import { useMemo, useState } from 'react';
import { CardSkeletons, LaunchCard } from '../components/LaunchCard';
import { DEMO } from '../config';
import { friendlyError } from '../lib/errors';
import { useLaunches, useMyStakes } from '../lib/hooks';
import type { LaunchState } from '../lib/types';

type Filter = 'all' | LaunchState | 'mine';
const FILTERS: [Filter, string][] = [
  ['open', 'Spinning'],
  ['hit', 'Hit'],
  ['miss', 'Miss'],
  ['mine', 'Mine'],
];

export default function Floor() {
  const { data, loading, error } = useLaunches(15_000);
  const { publicKey } = useWallet();
  const { data: myStakes } = useMyStakes();
  const [filter, setFilter] = useState<Filter>('all');

  const me = publicKey?.toBase58();
  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === 'all') return all;
    if (filter === 'mine') {
      const staked = new Set((myStakes ?? []).map((s) => s.launch));
      return all.filter((l) => l.creator === me || staked.has(l.address));
    }
    return all.filter((l) => l.state === filter);
  }, [data, filter, me, myStakes]);

  return (
    <main className="page" id="main" tabIndex={-1}>
      <div className="wrap">
        <div className="page-head">
          <h1 style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}>
            The <em>floor.</em>
          </h1>
          <p className="lede">Every coin launched on SL0T, live. Open ones are still spinning.</p>
        </div>
        <div className="filters" role="group" aria-label="Filter launches">
          {FILTERS.map(([f, label]) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(filter === f ? 'all' : f)}>
              {label}
            </button>
          ))}
        </div>
        {error && !data ? (
          <div className="empty">{friendlyError(error)}</div>
        ) : loading && !data ? (
          <CardSkeletons />
        ) : rows.length ? (
          <div className="grid">
            {rows.map((l) => (
              <LaunchCard key={l.address} launch={l} />
            ))}
          </div>
        ) : filter === 'mine' ? (
          <div className="empty">{DEMO ? 'Demo mode: connect on the live floor to see your pulls.' : "You haven't pulled yet."}</div>
        ) : (
          <div className="empty">No coins on the floor yet. Somebody has to go first.</div>
        )}
      </div>
    </main>
  );
}
