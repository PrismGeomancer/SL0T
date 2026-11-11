import '@fontsource/bungee/400.css';
import '@fontsource/bungee-shade/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import './styles/global.css';
import './styles/wallet.css';

import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { StrictMode, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connection } from './lib/chain';
import { friendlyError } from './lib/errors';
import { toast } from './lib/store';

function Root() {
  // Phantom, Solflare and Backpack all register through Wallet Standard: no adapters needed.
  const onError = useCallback((e: Error) => toast(friendlyError(e), 'err'), []);
  return (
    <ConnectionProvider endpoint={connection().rpcEndpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={[]} autoConnect onError={onError}>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
