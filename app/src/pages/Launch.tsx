import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lever } from '../components/Lever';
import { HIT_SET, Reels, type ReelsHandle } from '../components/Reels';
import { BulbBorder, solscan } from '../components/ui';
import { DEMO } from '../config';
import { connection } from '../lib/chain';
import { friendlyError } from '../lib/errors';
import { short, sol, toLamports } from '../lib/format';
import { go, useChainConfig, useGuestStatus } from '../lib/hooks';
import { toast, useStore } from '../lib/store';
import { sfx } from '../lib/sound';
import { MAX_IMAGE_BYTES } from '../lib/upload';

const TYPES = ['image/png', 'image/jpeg', 'image/gif'];
type Phase = 'idle' | 'spinning' | 'live';

export default function Launch() {
  const cfg = useChainConfig();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const guest = useGuestStatus();
  const refresh = useStore((s) => s.refresh);

  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [desc, setDesc] = useState('');
  const [buy, setBuy] = useState('0');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState('');
  const [rent, setRent] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reels = useRef<ReelsHandle>(null);

  // the overlay reels spin while the transaction confirms
  useEffect(() => {
    if (phase !== 'spinning') return;
    let on = true;
    const loop = async () => {
      while (on) {
        if (reels.current) await reels.current.spin(HIT_SET, { duration: 2200 });
        else await new Promise((r) => setTimeout(r, 50));
      }
    };
    const t = setTimeout(loop, 30);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [phase]);

  const buyLamports = toLamports(buy || '0');
  useEffect(() => {
    let live = true;
    import('../lib/tx')
      .then(({ estimateLaunchRent }) => estimateLaunchRent((buyLamports ?? 0) > 0))
      .then((r) => live && setRent(r))
      .catch(() => live && setRent(null));
    return () => {
      live = false;
    };
  }, [buyLamports]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Give it a name.';
    else if (new TextEncoder().encode(name.trim()).length > 32) e.name = 'Up to 32 characters';
    if (!/^[A-Za-z0-9]{2,10}$/.test(ticker)) e.ticker = '2–10 characters, letters and numbers';
    if (!file) e.image = 'Add an image.';
    if (buyLamports === null) e.buy = 'Enter an amount in SOL.';
    return e;
  }, [name, ticker, file, buyLamports]);

  const fee = cfg?.launchFee ?? 0;
  const est = (rent ?? 0) + 2_000_000; // + upload headroom
  const total = fee + est + (buyLamports ?? 0);

  const pickFile = (f: File | undefined | null) => {
    if (!f) return;
    if (!TYPES.includes(f.type) || f.size > MAX_IMAGE_BYTES) {
      toast('Image upload failed. Try a smaller file.', 'err');
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    setTouched(true);
    if (DEMO) {
      toast('Demo mode: no program is configured yet, so nothing is launched or charged.', 'info');
      return;
    }
    if (!wallet.publicKey || !anchorWallet) return setVisible(true);
    if (guest !== 'friend') return toast('This floor is guest list only.', 'err');
    if (Object.keys(errors).length || !file || !cfg) return;
    if (cfg.paused) return toast('Transaction failed: SL0T is paused', 'err');

    setPhase('spinning');
    try {
      const balance = await connection().getBalance(wallet.publicKey);
      if (balance < total) throw Object.assign(new Error('insufficient funds'), { need: total });

      setStep('Uploading image…');
      const { uploadTokenMetadata } = await import('../lib/upload');
      const uri = await uploadTokenMetadata(wallet, { name: name.trim(), symbol: ticker.toUpperCase(), description: desc.trim(), image: file });
      toast('Upload done.', 'ok');

      setStep('Signing… check your wallet.');
      toast('Signing… check your wallet.');
      const { buildLaunchTxs, signAndSend } = await import('../lib/tx');
      const { mint, txs } = await buildLaunchTxs(anchorWallet, { name: name.trim(), symbol: ticker.toUpperCase(), uri, firstBuyLamports: buyLamports ?? 0 });
      setStep('Spinning up…');
      let launchSig = '';
      try {
        await signAndSend(anchorWallet, txs, (sig, i) => {
          if (i === 0) launchSig = sig;
        });
      } catch (e) {
        // the coin may be live even if the optional first buy failed
        if (launchSig && txs.length > 1) {
          const info = await connection().getAccountInfo((await import('../lib/chain')).pda.launch(mint));
          if (info) {
            toast(`Coin launched, but the first buy failed: ${friendlyError(e)}`, 'err');
          } else throw e;
        } else throw e;
      }
      sfx.chime();
      setPhase('live');
      setStep("It's live");
      toast('Coin launched. The reels are spinning.', 'ok', launchSig ? { href: solscan.tx(launchSig), label: 'Solscan' } : undefined);
      refresh();
      setTimeout(() => go(`/coin/${mint.toBase58()}`), 1400);
    } catch (e) {
      setPhase('idle');
      setStep('');
      toast(friendlyError(e, { needLamports: total }), 'err');
    }
  };

  const err = (k: string) => (touched && errors[k] ? <span className="err-text">{errors[k]}</span> : null);

  return (
    <main className="page" id="main" tabIndex={-1}>
      <div className="wrap">
        <div className="page-head">
          <h1 style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}>
            Pull the <em>lever.</em>
          </h1>
          <p className="lede">One signature launches your coin and puts your launch fee on HIT.</p>
        </div>

        {guest === 'not-friend' && wallet.publicKey && (
          <div className="panel gate" style={{ marginBottom: 20 }}>
            <p className="lede">This floor is guest list only. Ask the host to add {short(wallet.publicKey.toBase58())}.</p>
          </div>
        )}

        <form
          className="two-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div className="panel stack">
            <div className="field">
              <label htmlFor="f-name">Coin name</label>
              <input id="f-name" className="input" placeholder="Frog Of Wall Street" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} aria-describedby="h-name" />
              <span className="hint" id="h-name">
                Up to 32 characters
              </span>
              {err('name')}
            </div>
            <div className="field">
              <label htmlFor="f-tick">Ticker</label>
              <input
                id="f-tick"
                className="input mono"
                placeholder="FROG"
                maxLength={10}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                aria-describedby="h-tick"
              />
              <span className="hint" id="h-tick">
                2–10 characters, letters and numbers
              </span>
              {err('ticker')}
            </div>
            <div className="field">
              <span style={{ fontWeight: 600, fontSize: 14 }} id="l-img">
                Image
              </span>
              <div
                className={`drop ${over ? 'over' : ''}`}
                role="button"
                tabIndex={0}
                aria-labelledby="l-img"
                aria-describedby="h-img"
                onClick={() => fileInput.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.current?.click())}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
              >
                {preview ? <img src={preview} alt="Coin image preview" /> : <span>Drop an image or click to upload</span>}
                {file && <span className="small">{file.name}</span>}
              </div>
              <input ref={fileInput} type="file" accept={TYPES.join(',')} hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              <span className="hint" id="h-img">
                PNG, JPG or GIF, max 2 MB. You pay the tiny upload fee from your wallet.
              </span>
              {err('image')}
            </div>
            <div className="field">
              <label htmlFor="f-desc">Description (optional)</label>
              <textarea id="f-desc" className="textarea" placeholder="One line. Make it count." maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-buy">First buy (optional)</label>
              <div className="input-suffix">
                <input id="f-buy" className="input mono" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} aria-describedby="h-buy" />
                <span>SOL</span>
              </div>
              <span className="hint" id="h-buy">
                Buy some of your own coin in the same signature, right after it launches
              </span>
              {err('buy')}
            </div>
          </div>

          <div className="stack" style={{ position: 'sticky', top: 'calc(var(--nav-h) + 16px)' }}>
            <div className="panel summary" aria-live="polite">
              <div className="row">
                <span>Launch fee (on HIT)</span>
                <span className="mono">{cfg ? sol(fee) : '…'} SOL</span>
              </div>
              <div className="row">
                <span>Upload + rent + network</span>
                <span className="mono">~{rent === null ? '…' : sol(est, 4)} SOL</span>
              </div>
              <div className="row">
                <span>First buy</span>
                <span className="mono">{sol(buyLamports ?? 0)} SOL</span>
              </div>
              <div className="row">
                <span>Total</span>
                <span className="mono">{cfg && rent !== null ? sol(total, 4) : '…'} SOL</span>
              </div>
            </div>
            <div className="panel" style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
              {!wallet.publicKey && !DEMO ? (
                <button type="button" className="btn primary block" onClick={() => setVisible(true)}>
                  Connect wallet
                </button>
              ) : (
                <>
                  <Lever onPull={() => void submit()} label={phase === 'idle' ? 'PULL' : phase === 'live' ? "IT'S LIVE" : 'SPINNING UP…'} disabled={phase !== 'idle'} ariaLabel="Pull: launch the coin" />
                  <button type="submit" className="btn primary block" disabled={phase !== 'idle'}>
                    {phase === 'idle' ? 'Pull' : phase === 'live' ? "It's live" : 'Spinning up…'}
                  </button>
                </>
              )}
              {DEMO && <p className="small">Demo mode: the lever works, nothing is sent.</p>}
            </div>
          </div>
        </form>
      </div>

      {phase !== 'idle' && (
        <div className="overlay dim" role="alertdialog" aria-modal="true" aria-label="Launching">
          <div className="spin-screen">
            <BulbBorder spacing={28} style={{ width: 'min(420px, 86vw)' }}>
              <Reels ref={reels} height={100} initial={['bar', 'cherry', 'bell']} />
            </BulbBorder>
            <h2 className={phase === 'live' ? 'accent' : ''} style={{ fontSize: 'clamp(32px, 6vw, 56px)' }} aria-live="assertive">
              {phase === 'live' ? "It's live" : 'Spinning up…'}
            </h2>
            <p className="mono small muted">{step}</p>
          </div>
        </div>
      )}
    </main>
  );
}
