/**
 * Single source of truth for the site. Values set here win; the VITE_* build
 * variables (repo secrets / vars in pages.yml, or app/.env.local) fill in
 * whatever is left empty.
 *
 * - rpcUrl: your Helius URL. It ships to every visitor's browser, so restrict
 *   the key to your Pages domain in the Helius dashboard.
 * - programId: empty = DEMO MODE (sample launches, every write explains it's a demo).
 * - links: an empty link hides its button.
 */
export type Cluster = 'devnet' | 'mainnet-beta';

const env = import.meta.env;
const pick = (v: string, e: string | undefined) => (v || e || '').trim();

export const CONFIG = {
  cluster: (pick('', env.VITE_CLUSTER) || 'devnet') as Cluster,
  rpcUrl: pick('', env.VITE_RPC_URL),
  programId: pick('', env.VITE_PROGRAM_ID),
  keeperAddress: pick('', env.VITE_KEEPER_ADDRESS),
  links: {
    x: 'https://x.com/SL0T_LAUNCH',
    github: '',
  },
  feeLine: "pump.fun's standard trading fees apply, and the creator fees go to the coin's creator as usual",
};

export const DEMO = !CONFIG.programId;
export const IS_DEVNET = CONFIG.cluster === 'devnet';

/** Program link for "Read the program": the repo if set, else the explorer. */
export const programSourceUrl = () =>
  CONFIG.links.github ? `${CONFIG.links.github.replace(/\/$/, '')}/tree/main/programs/sl0t` : '';
