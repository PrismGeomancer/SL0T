/**
 * Token image + metadata JSON upload.
 *
 * pump.fun's own upload endpoint refuses cross-origin requests (403 from a
 * GitHub Pages origin), so SL0T uploads to Irys with the creator's wallet
 * paying. Files under 100 KiB are free on Irys mainnet; on devnet the fee is
 * paid in devnet SOL and devnet uploads are not permanent.
 */
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { CONFIG, IS_DEVNET } from '../config';
import { connection } from './chain';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const gateway = () => (IS_DEVNET ? 'https://devnet.irys.xyz' : 'https://gateway.irys.xyz');

async function irysFor(wallet: WalletContextState) {
  const [{ WebUploader }, { WebSolana }] = await Promise.all([import('@irys/web-upload'), import('@irys/web-upload-solana')]);
  let b = WebUploader(WebSolana).withProvider(wallet).withRpc(connection().rpcEndpoint);
  if (IS_DEVNET) b = b.devnet();
  return await b.build();
}

/** Upload image (if a File) and the metadata JSON; returns the metadata URI. */
export async function uploadTokenMetadata(
  wallet: WalletContextState,
  m: { name: string; symbol: string; description: string; image: File },
  onStep?: (s: string) => void,
): Promise<string> {
  try {
    const irys = await irysFor(wallet);
    const json = (image: string) =>
      JSON.stringify({ name: m.name, symbol: m.symbol, description: m.description, image, showName: true, createdOn: CONFIG.links.github || 'SL0T' });
    const total = m.image.size + new TextEncoder().encode(json('x'.repeat(80))).length;
    const price = await irys.getPrice(total);
    const balance = await irys.getLoadedBalance();
    if (balance.lt(price)) {
      onStep?.('fund');
      await irys.fund(price.minus(balance).multipliedBy(1.2).integerValue());
    }
    onStep?.('image');
    const img = await irys.uploadFile(m.image, { tags: [{ name: 'Content-Type', value: m.image.type || 'image/png' }] });
    const imageUrl = `${gateway()}/${img.id}`;
    onStep?.('metadata');
    const meta = await irys.upload(json(imageUrl), { tags: [{ name: 'Content-Type', value: 'application/json' }] });
    return `${gateway()}/${meta.id}`;
  } catch (e) {
    const err = new Error(`upload failed: ${(e as Error)?.message ?? e}`);
    (err as Error & { cause?: unknown }).cause = e;
    throw err;
  }
}
