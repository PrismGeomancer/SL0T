import { sol } from '../lib/format';
import type { LaunchRow } from '../lib/types';
import { CardCountdown, CoinImage, coinName, coinTicker, CurveBar, StatusChip } from './ui';

export function LaunchCard({ launch }: { launch: LaunchRow }) {
  return (
    <a className="card lcard" href={`#/coin/${launch.mint}`} aria-label={`${coinName(launch)}, ${launch.state === 'open' ? 'spinning' : launch.state}. Open`}>
      <div className="lcard-head">
        <CoinImage launch={launch} />
        <div style={{ minWidth: 0 }}>
          <div className="lcard-name">{coinName(launch)}</div>
          <div className="lcard-tick">${coinTicker(launch)}</div>
        </div>
        <div className="lcard-chips">
          <StatusChip state={launch.state} />
        </div>
      </div>
      <CurveBar bps={launch.curvePctBps} complete={launch.curveComplete} />
      <div className="row">
        <span className="mono small">
          HIT {sol(launch.hitTotal)} SOL · MISS {sol(launch.missTotal)} SOL
        </span>
        <CardCountdown launch={launch} />
      </div>
      <span className="btn sm ghost" style={{ justifySelf: 'start' }} aria-hidden>
        Open
      </span>
    </a>
  );
}

export function CardSkeletons({ n = 6 }: { n?: number }) {
  return (
    <div className="grid" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}
