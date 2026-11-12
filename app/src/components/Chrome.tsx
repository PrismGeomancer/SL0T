import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEffect, useRef, useState } from 'react';
import { CONFIG, DEMO, IS_DEVNET, programSourceUrl } from '../config';
import { short } from '../lib/format';
import { useGuestStatus, useRoute } from '../lib/hooks';
import { toast, useStore } from '../lib/store';
import { solscan } from './ui';

const base = import.meta.env.BASE_URL;

export function WalletButton() {
  const { publicKey, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const status = useGuestStatus();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) =>
      !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!publicKey)
    return (
      <button
        className='btn sm wallet-btn'
        onClick={() => setVisible(true)}
        disabled={connecting}
      >
        Connect wallet
      </button>
    );

  const addr = publicKey.toBase58();
  const notFriend = status === 'not-friend';
  return (
    <div className='wallet-wrap' ref={wrap}>
      <button
        className={`btn sm ghost wallet-btn tip`}
        data-tip={notFriend ? 'Not on the guest list' : undefined}
        aria-label={`${short(addr)}${notFriend ? ', not on the guest list' : status === 'friend' ? ', on the guest list' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {short(addr)}
        <span
          className={`dot ${status === 'friend' ? 'green' : notFriend ? 'red' : 'grey'}`}
        />
      </button>
      {open && (
        <div className='wallet-menu' role='menu'>
          <a href='#/me' role='menuitem' onClick={() => setOpen(false)}>
            Your pulls
          </a>
          <button
            role='menuitem'
            onClick={() => {
              void navigator.clipboard
                ?.writeText(addr)
                .then(() => toast('Copied.', 'ok'));
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <button
            role='menuitem'
            onClick={() => {
              setOpen(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Wallet connect / disconnect toasts. */
export function WalletToasts() {
  const { publicKey } = useWallet();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const now = publicKey?.toBase58() ?? null;
    if (now && !prev.current) toast('Wallet connected.', 'ok');
    if (!now && prev.current) toast('Wallet disconnected.');
    prev.current = now;
  }, [publicKey]);
  return null;
}

export function Nav() {
  const route = useRoute();
  const sound = useStore((s) => s.sound);
  const toggleSound = useStore((s) => s.toggleSound);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [route]);
  const links: [string, string][] = [
    ['How it works', '#/how'],
    ['Run it back', '#/run-it-back'],
    ['The floor', '#/floor'],
    ['Log', '#/log'],
  ];
  return (
    <header className='nav'>
      <div className='wrap'>
        <a className='nav-logo' href='#/' aria-label='SL0T home'>
          <img src={`${base}favicon.svg`} alt='' width={30} height={30} />
          <span className='neon-red'>SL0T</span>
        </a>
        <nav className={`nav-links ${menu ? 'open' : ''}`} aria-label='Main'>
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              aria-current={route === href.slice(1) ? 'page' : undefined}
            >
              {label}
            </a>
          ))}
          <button
            className='nav-sound nav-sound-menu'
            aria-pressed={sound}
            onClick={toggleSound}
          >
            Sound: {sound ? 'on' : 'off'}
          </button>
        </nav>
        <div className='nav-right'>
          {IS_DEVNET && <span className='chip amber'>DEVNET</span>}
          {CONFIG.links.x && (
            <a
              className='nav-x'
              href={CONFIG.links.x}
              target='_blank'
              rel='noreferrer'
              aria-label='SL0T on X'
            >
              <svg
                width='15'
                height='15'
                viewBox='0 0 24 24'
                fill='currentColor'
                aria-hidden
              >
                <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
              </svg>
            </a>
          )}
          <button
            className='nav-sound nav-sound-bar'
            aria-pressed={sound}
            onClick={toggleSound}
          >
            <span className='long'>Sound: </span>
            {sound ? 'on' : 'off'}
          </button>
          <WalletButton />
          <button
            className='nav-burger'
            aria-label='Menu'
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <svg width='18' height='14' viewBox='0 0 18 14' aria-hidden>
              <path
                d='M0 1h18M0 7h18M0 13h18'
                stroke='currentColor'
                strokeWidth='2'
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export function DemoBanner() {
  if (!DEMO) return null;
  return <div className="demo-banner">DEMO FLOOR — sample launches, not real coins.</div>;
}

export function Footer() {
  const prog = CONFIG.programId
    ? solscan.account(CONFIG.programId)
    : programSourceUrl();
  return (
    <footer className='footer'>
      <div className='wrap'>
        <div className='footer-top'>
          <p style={{ fontFamily: 'var(--f-display)', fontSize: 18 }}>
            SL0T — every launch is <span className='accent'>a pull.</span>
          </p>
          <div className='footer-links'>
            {CONFIG.links.x && (
              <a href={CONFIG.links.x} target='_blank' rel='noreferrer'>
                X
              </a>
            )}
            {CONFIG.links.github && (
              <a href={CONFIG.links.github} target='_blank' rel='noreferrer'>
                GitHub
              </a>
            )}
            {prog && (
              <a href={prog} target='_blank' rel='noreferrer'>
                Program
              </a>
            )}
          </div>
        </div>
        <p className='small' style={{ maxWidth: '80ch' }}>
          A private project for friends. Not financial advice. Meme coins can
          lose all their value, and anything you lock in a pool can be lost.
          Only play with what you're fine losing. Devnet until announced.
        </p>
        <p className='signoff'>Lights stay on.</p>
      </div>
    </footer>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className='toasts' aria-live='polite' role='status'>
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>
            {t.text}
            {t.link && (
              <>
                {' '}
                <a href={t.link.href} target='_blank' rel='noreferrer'>
                  {t.link.label}
                </a>
              </>
            )}
          </span>
          <button aria-label='Dismiss' onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
