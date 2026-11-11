import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DEMO } from '../config';
import * as chain from './chain';
import { DEMO_CONFIG, DEMO_LAUNCHES, DEMO_LOG, demoLaunch } from './demo';
import { useStore } from './store';
import type { ChainConfig, LaunchRow, LogRow, RematchRow, StakeRow } from './types';

// ---------------------------------------------------------------- generic

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const rmQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      rmQuery?.addEventListener('change', cb);
      return () => rmQuery?.removeEventListener('change', cb);
    },
    () => !!rmQuery?.matches,
    () => false,
  );
}

export function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

export function useInView<T extends Element>(opts: IntersectionObserverInit = { rootMargin: '100px' }) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), opts);
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, inView] as const;
}

/** Poll an async loader; refetches on `refresh()` from the store and when deps change. */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 15_000) {
  const refreshKey = useStore((s) => s.refreshKey);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(async () => {
    try {
      const d = await loadRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setLoading(true);
    void run();
    if (!intervalMs) return;
    const id = setInterval(() => {
      if (!document.hidden) void run();
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey, intervalMs]);
  return { data, error, loading, reload: run, setData };
}

// ---------------------------------------------------------------- router

const getHash = () => window.location.hash.replace(/^#/, '') || '/';
export function useRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    getHash,
    () => '/',
  );
}
export const go = (path: string) => {
  window.location.hash = path;
};

// ---------------------------------------------------------------- chain data

export function useChainConfig(): ChainConfig | null {
  const { data } = usePoll<ChainConfig>(() => (DEMO ? Promise.resolve(DEMO_CONFIG) : chain.fetchConfig()), [], 120_000);
  return data;
}

export function useLaunches(pollMs = 15_000) {
  const res = usePoll<LaunchRow[]>(() => (DEMO ? Promise.resolve(DEMO_LAUNCHES) : chain.fetchLaunches()), [], pollMs);
  const { data, setData } = res;

  // live updates for open launches (websocket), between polls
  const openKeys = (data ?? []).filter((l) => l.state === 'open').slice(0, 24).map((l) => l.address).join(',');
  useEffect(() => {
    if (DEMO || !openKeys) return;
    const conn = chain.connection();
    const ids = openKeys.split(',').map((addr) =>
      conn.onAccountChange(new PublicKey(addr), (info) => {
        try {
          const fresh = chain.decodeLaunchAccount(new PublicKey(addr), info.data);
          setData((rows) => rows?.map((r) => (r.address === addr ? { ...r, ...fresh, curvePctBps: r.curvePctBps, curveComplete: r.curveComplete, meta: r.meta } : r)) ?? rows);
        } catch {
          /* ignore malformed */
        }
      }),
    );
    return () => ids.forEach((id) => void conn.removeAccountChangeListener(id));
  }, [openKeys, setData]);

  return res;
}

export function useLaunch(mint: string | null) {
  const res = usePoll<LaunchRow | null>(
    async () => {
      if (!mint) return null;
      if (DEMO) return demoLaunch(mint);
      return chain.fetchLaunch(new PublicKey(mint));
    },
    [mint],
    10_000,
  );
  const { data, setData } = res;
  const addr = data && !data.demo ? data.address : null;
  useEffect(() => {
    if (!addr) return;
    const conn = chain.connection();
    const id = conn.onAccountChange(new PublicKey(addr), (info) => {
      try {
        const fresh = chain.decodeLaunchAccount(new PublicKey(addr), info.data);
        setData((r) => (r ? { ...r, ...fresh, curvePctBps: r.curvePctBps, curveComplete: r.curveComplete, meta: r.meta } : r));
      } catch {
        /* ignore */
      }
    });
    return () => void conn.removeAccountChangeListener(id);
  }, [addr, setData]);
  return res;
}

export type GuestStatus = 'disconnected' | 'checking' | 'friend' | 'not-friend';
export function useGuestStatus(): GuestStatus {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58() ?? '';
  const { data } = usePoll<boolean | null>(async () => (key ? (DEMO ? true : chain.isFriend(new PublicKey(key))) : null), [key], 60_000);
  if (!key) return 'disconnected';
  if (data === null) return 'checking';
  return data ? 'friend' : 'not-friend';
}

export function useMyStakes() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58() ?? '';
  return usePoll<StakeRow[]>(async () => (key && !DEMO ? chain.fetchStakesByOwner(new PublicKey(key)) : []), [key], 20_000);
}

export function useRematch() {
  const { publicKey } = useWallet();
  const key = publicKey?.toBase58() ?? '';
  return usePoll<RematchRow | null>(async () => (key && !DEMO ? chain.fetchRematch(new PublicKey(key)) : null), [key], 30_000);
}

export function useLog(scope?: string, limit = 150) {
  return usePoll<LogRow[]>(
    async () => {
      if (DEMO) return scope ? DEMO_LOG.filter((r) => r.launch === scope) : DEMO_LOG;
      return chain.fetchLog(limit, scope ? new PublicKey(scope) : undefined);
    },
    [scope, limit],
    30_000,
  );
}
