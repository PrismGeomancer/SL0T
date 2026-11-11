/**
 * The hero slot machine. Lazy-loaded after first paint, desktop only.
 * Cabinet, three reel cylinders with a canvas symbol strip, glass, emissive
 * chasing bulbs, a pullable lever, a glossy reflective floor and bloom.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Machine {
  pull: () => Promise<void>;
  dispose: () => void;
}

const SYMBOLS = ['7', 'BAR', 'cherry', '0', 'bell', '7', 'BAR', 'cherry'] as const;
const N = SYMBOLS.length;
const STEP = (Math.PI * 2) / N;

function reelTexture(): THREE.CanvasTexture {
  const cell = 256;
  const c = document.createElement('canvas');
  // u (canvas x) wraps the circumference, v (canvas y) runs along the axis.
  c.width = cell * N;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#d8d0c4');
  grad.addColorStop(0.5, '#fffaf1');
  grad.addColorStop(1, '#d8d0c4');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  SYMBOLS.forEach((s, i) => {
    g.save();
    g.translate(i * cell + cell / 2, 128);
    g.rotate(Math.PI / 2); // upright on screen once the cylinder lies on its side
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (s === '7') {
      const seven = new Path2D('M12 9h42v9L33 57H19l20-36H12z');
      g.translate(-96, -96);
      g.scale(3, 3);
      g.translate(2, 3);
      g.fillStyle = '#7a0d1d';
      g.fill(seven);
      g.translate(-2, -3);
      g.fillStyle = '#ff2e4d';
      g.fill(seven);
    } else if (s === 'BAR') {
      g.fillStyle = '#1a1520';
      g.strokeStyle = '#ffc24b';
      g.lineWidth = 10;
      g.beginPath();
      g.roundRect(-96, -44, 192, 88, 14);
      g.fill();
      g.stroke();
      g.font = '700 60px Bungee, Impact, sans-serif';
      g.fillStyle = '#fff';
      g.fillText('BAR', 0, 4);
    } else if (s === '0') {
      g.font = '700 180px Bungee, Impact, sans-serif';
      g.fillStyle = '#1a1520';
      g.fillText('0', 0, 6);
    } else if (s === 'cherry') {
      g.strokeStyle = '#2d7a2d';
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(0, -80);
      g.quadraticCurveTo(30, -30, 46, 10);
      g.moveTo(0, -80);
      g.quadraticCurveTo(-30, -20, -44, 20);
      g.stroke();
      g.fillStyle = '#e0102f';
      g.beginPath();
      g.arc(-44, 40, 36, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff2e4d';
      g.beginPath();
      g.arc(46, 30, 36, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#ffc24b';
      g.strokeStyle = '#8a5a00';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(0, -80);
      g.bezierCurveTo(-60, -80, -60, 0, -64, 40);
      g.lineTo(64, 40);
      g.bezierCurveTo(60, 0, 60, -80, 0, -80);
      g.fill();
      g.stroke();
      g.fillStyle = '#8a5a00';
      g.beginPath();
      g.arc(0, 60, 18, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function marqueeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b080d';
  g.fillRect(0, 0, c.width, c.height);
  g.font = '400 220px "Bungee Shade", Bungee, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2e4d';
  g.shadowBlur = 40;
  g.fillStyle = '#ff2e4d';
  g.fillText('SL0T', 512, 160);
  g.shadowBlur = 0;
  g.fillStyle = '#ffd9df';
  g.globalAlpha = 0.5;
  g.fillText('SL0T', 512, 160);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMachine(canvas: HTMLCanvasElement, opts: { bloom: boolean; reduced: boolean; onPull?: () => void; onSettle?: () => void; onTick?: () => void }): Machine {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07060a');
  scene.fog = new THREE.Fog('#07060a', 9, 18);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const camBase = new THREE.Vector3(1.6, 1.1, 9.2);
  camera.position.copy(camBase);

  // lights
  scene.add(new THREE.AmbientLight('#3b2c44', 0.9));
  const key = new THREE.SpotLight('#ffe9d6', 22, 20, 0.5, 0.6, 1.2);
  key.position.set(4, 6, 6);
  scene.add(key);
  const redGlow = new THREE.PointLight('#ff2e4d', 3.5, 6, 1.6);
  redGlow.position.set(0, 2.7, 1.8);
  scene.add(redGlow);
  const rim = new THREE.PointLight('#ffc24b', 4, 10, 1.4);
  rim.position.set(-3, 1, -2);
  scene.add(rim);
  // edge lights so the cabinet's silhouette reads against the dark floor
  const edgeL = new THREE.DirectionalLight('#ff4f6d', 1.4);
  edgeL.position.set(-5, 3, -3);
  scene.add(edgeL);
  const edgeR = new THREE.DirectionalLight('#ffd08a', 1.1);
  edgeR.position.set(5, 2, -2);
  scene.add(edgeR);

  const machine = new THREE.Group();
  machine.position.y = -0.2;
  scene.add(machine);

  const cabinetMat = new THREE.MeshStandardMaterial({ color: '#2b2233', metalness: 0.6, roughness: 0.3 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: '#d9d4de', metalness: 1, roughness: 0.18 });
  const blackMat = new THREE.MeshStandardMaterial({ color: '#0a080c', metalness: 0.3, roughness: 0.6 });

  // body
  const body = new THREE.Mesh(new RoundedBoxGeometry(3.2, 3.4, 1.6, 6, 0.16), cabinetMat);
  body.position.y = 0;
  machine.add(body);
  // marquee
  const top = new THREE.Mesh(new RoundedBoxGeometry(3.4, 1.15, 1.7, 6, 0.2), cabinetMat);
  top.position.y = 2.35;
  machine.add(top);
  const marquee = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 0.88),
    new THREE.MeshStandardMaterial({ map: marqueeTexture(), emissive: '#ffffff', emissiveMap: marqueeTexture(), emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  marquee.position.set(0, 2.35, 0.86);
  machine.add(marquee);
  // tray
  const tray = new THREE.Mesh(new RoundedBoxGeometry(2.6, 0.35, 0.7, 4, 0.1), blackMat);
  tray.position.set(0, -1.35, 0.95);
  machine.add(tray);
  // base
  const base = new THREE.Mesh(new RoundedBoxGeometry(3.5, 0.4, 1.9, 4, 0.12), blackMat);
  base.position.y = -1.9;
  machine.add(base);

  // reel window: a dark backing on the front face, a thin gold bar frame around it
  const FRONT = 0.8; // body front face
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.36), new THREE.MeshStandardMaterial({ color: '#050406', roughness: 0.9 }));
  backing.position.set(0, 0.45, FRONT + 0.004);
  machine.add(backing);
  const frameMat = new THREE.MeshStandardMaterial({ color: '#ffc24b', metalness: 0.9, roughness: 0.3, emissive: '#2a1a00', emissiveIntensity: 0.3 });
  const bar = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.16, 2, 0.03), frameMat);
    m.position.set(x, 0.45 + y, FRONT + 0.09);
    machine.add(m);
  };
  bar(2.72, 0.12, 0, 0.74);
  bar(2.72, 0.12, 0, -0.74);
  bar(0.12, 1.6, -1.31, 0);
  bar(0.12, 1.6, 1.31, 0);
  bar(0.06, 1.36, -0.4, 0);
  bar(0.06, 1.36, 0.4, 0);

  const tex = reelTexture();
  const reelMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 });
  const sideMat = new THREE.MeshStandardMaterial({ color: '#2a2333', metalness: 0.6, roughness: 0.4 });
  const reels: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.CylinderGeometry(0.95, 0.95, 0.7, 64, 1, true);
    const reel = new THREE.Mesh(geo, reelMat);
    reel.rotation.z = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set((i - 1) * 0.8, 0.45, FRONT - 0.95 + 0.15); // reel faces poke out of the front
    holder.add(reel);
    const capL = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), sideMat);
    capL.position.x = -0.37;
    capL.rotation.y = -Math.PI / 2;
    const capR = capL.clone();
    capR.position.x = 0.37;
    capR.rotation.y = Math.PI / 2;
    holder.add(capL, capR);
    machine.add(holder);
    reels.push(reel);
  }
  // symbol k is centred at theta = (k + 0.5) * STEP; rotation.x = theta brings it to the front.
  const startIdx = [0, 2, 1]; // 7 · cherry · BAR
  const angleFor = (idx: number) => (idx + 0.5) * STEP;
  reels.forEach((r, i) => (r.rotation.x = angleFor(startIdx[i])));

  // glass
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.36),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
  );
  glass.position.set(0, 0.45, FRONT + 0.17);
  machine.add(glass);
  // payline
  const payline = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.025), new THREE.MeshBasicMaterial({ color: '#ff2e4d', transparent: true, opacity: 0.7 }));
  payline.position.set(0, 0.45, FRONT + 0.175);
  machine.add(payline);

  // bulbs around the marquee + window
  const bulbGeo = new THREE.SphereGeometry(0.05, 12, 12);
  const bulbs: THREE.MeshStandardMaterial[] = [];
  const addBulb = (x: number, y: number, z: number) => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffc24b', emissive: '#ffb020', emissiveIntensity: 2.4 });
    const b = new THREE.Mesh(bulbGeo, m);
    b.position.set(x, y, z);
    machine.add(b);
    bulbs.push(m);
  };
  const ring = (cx: number, cy: number, w: number, h: number, z: number, n: number) => {
    const per = 2 * (w + h);
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per;
      let x: number, y: number;
      if (d < w) [x, y] = [-w / 2 + d, h / 2];
      else if ((d -= w) < h) [x, y] = [w / 2, h / 2 - d];
      else if ((d -= h) < w) [x, y] = [w / 2 - d, -h / 2];
      else [x, y] = [-w / 2, -h / 2 + (d - w)];
      addBulb(cx + x, cy + y, z);
    }
  };
  ring(0, 2.35, 3.2, 1.0, 0.88, 30);
  ring(0, 0.45, 2.95, 1.85, FRONT + 0.12, 26);

  // lever
  const leverPivot = new THREE.Group();
  leverPivot.position.set(1.78, 0.25, 0.1);
  machine.add(leverPivot);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 24), chromeMat);
  hub.rotation.z = Math.PI / 2;
  leverPivot.add(hub);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 16), chromeMat);
  arm.position.set(0.16, 0.8, 0);
  leverPivot.add(arm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), new THREE.MeshStandardMaterial({ color: '#ff2e4d', emissive: '#ff2e4d', emissiveIntensity: 0.9, roughness: 0.25 }));
  knob.position.set(0.16, 1.65, 0);
  leverPivot.add(knob);

  // glossy reflective floor
  const floorGeo = new THREE.CircleGeometry(9, 64);
  const mirror = new Reflector(floorGeo, { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: new THREE.Color('#1a1520') });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = -2.1;
  scene.add(mirror);
  const floorTint = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ color: '#07060a', transparent: true, opacity: 0.82, roughness: 0.35, metalness: 0.4 }));
  floorTint.rotation.x = -Math.PI / 2;
  floorTint.position.y = -2.095;
  scene.add(floorTint);

  // post
  let composer: EffectComposer | null = null;
  if (opts.bloom && !opts.reduced) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 0.82));
    composer.addPass(new OutputPass());
  }

  // sizing
  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // parallax
  const target = new THREE.Vector2();
  const onMove = (e: PointerEvent) => {
    target.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  // spin state
  type Spin = { from: number; to: number; t0: number; dur: number };
  let spins: (Spin | null)[] = [null, null, null];
  let leverT = -1;
  let lastTickIdx = [0, 0, 0];
  let settleResolve: (() => void) | null = null;
  const ease = (k: number) => {
    // fast start, long decel, overshoot then settle
    const c1 = 1.25;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  };

  const pull = () =>
    new Promise<void>((resolve) => {
      if (spins.some(Boolean)) return resolve();
      opts.onPull?.();
      leverT = performance.now();
      const now = performance.now();
      const land = [0, 0, 0].map(() => Math.floor(Math.random() * N)); // cosmetic only
      spins = reels.map((r, i) => {
        const from = r.rotation.x;
        const turns = opts.reduced ? 0 : 3 + i;
        let to = angleFor(land[i]);
        while (to < from + Math.PI * 2 * turns) to += Math.PI * 2; // forward: symbols travel down
        return { from, to, t0: now + 120, dur: opts.reduced ? 1 : 1200 + i * 420 };
      });
      settleResolve = resolve;
    });

  // render loop, paused offscreen / hidden
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);
  let raf = 0;
  const clock = new THREE.Clock();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    const t = clock.getElapsedTime();
    const now = performance.now();

    camera.position.x += (camBase.x + target.x * 0.6 - camera.position.x) * 0.05;
    camera.position.y += (camBase.y - target.y * 0.35 - camera.position.y) * 0.05;
    camera.lookAt(0, 0.4, 0);
    machine.rotation.y = -0.18 + Math.sin(t * 0.3) * 0.02;

    const phase = Math.floor(t * 3.3) % 3;
    bulbs.forEach((m, i) => (m.emissiveIntensity = i % 3 === phase ? 1.8 : 0.25));
    redGlow.intensity = 3.5 + Math.sin(t * 23) * 0.15 + (Math.random() < 0.01 ? -2 : 0);

    // lever: down 160ms, spring back
    if (leverT > 0) {
      const k = (now - leverT) / 1000;
      const a = k < 0.16 ? (k / 0.16) * 1.0 : Math.max(0, 1.0 * Math.exp(-(k - 0.16) * 7) * Math.cos((k - 0.16) * 18));
      leverPivot.rotation.x = a;
      if (k > 1.2) {
        leverPivot.rotation.x = 0;
        leverT = -1;
      }
    }

    let active = false;
    spins.forEach((s, i) => {
      if (!s) return;
      active = true;
      const k = Math.min(1, Math.max(0, (now - s.t0) / s.dur));
      reels[i].rotation.x = s.from + (s.to - s.from) * ease(k);
      const idx = Math.floor(reels[i].rotation.x / STEP);
      if (idx !== lastTickIdx[i]) {
        lastTickIdx[i] = idx;
        if (i === 0) opts.onTick?.();
      }
      if (k >= 1) {
        reels[i].rotation.x = s.to % (Math.PI * 2);
        spins[i] = null;
        opts.onSettle?.();
      }
    });
    if (!active && settleResolve) {
      settleResolve();
      settleResolve = null;
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);
  };
  loop();

  // lever is clickable in 3D too
  const ray = new THREE.Raycaster();
  const onClick = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (ray.intersectObjects([knob, arm, hub, ...reels]).length) void pull();
  };
  canvas.addEventListener('click', onClick);

  return {
    pull,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      mirror.dispose();
      composer?.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
    },
  };
}
