import { lazy, Suspense, useEffect, useState } from 'react';
import { DemoBanner, Footer, Nav, Toasts, WalletToasts } from './components/Chrome';
import { Intro, introMode } from './components/Intro';
import { NeonFilterDefs } from './components/NeonLogo';
import { useReducedMotion, useRoute } from './lib/hooks';
import { useStore } from './lib/store';
import { Landing } from './pages/Landing';

const Floor = lazy(() => import('./pages/Floor'));
const Launch = lazy(() => import('./pages/Launch'));
const Coin = lazy(() => import('./pages/Coin'));
const Log = lazy(() => import('./pages/Log'));
const Me = lazy(() => import('./pages/Me'));

const SECTION_ROUTES: Record<string, string> = { '/how': 'how', '/run-it-back': 'run-it-back', '/resolved': 'resolved', '/faq': 'faq' };

function Page({ route }: { route: string }) {
  if (route === '/' || SECTION_ROUTES[route]) return <Landing />;
  if (route === '/floor') return <Floor />;
  if (route === '/launch') return <Launch />;
  if (route.startsWith('/coin/')) return <Coin mint={decodeURIComponent(route.slice(6))} />;
  if (route === '/log') return <Log />;
  if (route === '/me') return <Me />;
  return (
    <main className="page wrap" id="main">
      <div className="empty">
        Nothing on this reel. <a href="#/">Back to the floor</a>
      </div>
    </main>
  );
}

export function App() {
  const route = useRoute();
  const reduced = useReducedMotion();
  const introOpen = useStore((s) => s.introOpen);
  const setIntroOpen = useStore((s) => s.setIntroOpen);
  const [mode] = useState(() => introMode(reduced));

  // intro only when the visit starts on the landing page
  useEffect(() => {
    if (route === '/') setIntroOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const section = SECTION_ROUTES[route];
    if (section) {
      requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }));
    } else if (!route.startsWith('/coin')) {
      window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
  }, [route, reduced]);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <NeonFilterDefs />
      <DemoBanner />
      <Nav />
      <Suspense fallback={<main className="page wrap" id="main" />}>
        <Page route={route} />
      </Suspense>
      <Footer />
      <Toasts />
      <WalletToasts />
      {introOpen && <Intro mode={mode} />}
      <div className="vignette" aria-hidden />
      <div className="grain" aria-hidden />
    </>
  );
}
