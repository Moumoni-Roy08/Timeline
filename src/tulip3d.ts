/**
 * 3D mascot: pink tulips in a terracotta pot, straight out of the
 * watercolor reference. Low-poly, pastel-lit, gently swaying.
 * Lazy-loads three.js so the app shell stays light.
 */
export async function mountTulip(el: HTMLElement, size = 140): Promise<void> {
  const THREE = await import("three");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(size, size);
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 2.2, 7.2);
  camera.lookAt(0, 1.05, 0);

  // pastel watercolor lighting: warm key, cool sky fill
  scene.add(new THREE.AmbientLight(0xfff4e0, 0.85));
  const key = new THREE.DirectionalLight(0xfff1d6, 1.25);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ea, 0.5);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const mat = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
  const TERRACOTTA = mat(0xc97b5a);
  const TERRACOTTA_RIM = mat(0xd88f6d);
  const SOIL = mat(0x6b4f3a);
  const STEM = mat(0x7ca06f);
  const LEAF = mat(0x8fb283);
  const PINKS = [0xf0a4ae, 0xe98d9b, 0xf3b7be];

  const pot = new THREE.Group();

  // pot body (tapered) + rim, like the reference pots
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.5, 1.0, 24), TERRACOTTA);
  body.position.y = 0.5;
  pot.add(body);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.24, 24), TERRACOTTA_RIM);
  rim.position.y = 1.02;
  pot.add(rim);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24), SOIL);
  soil.position.y = 1.12;
  pot.add(soil);

  // one tulip = stem + two leaves + bud (squashed sphere) + 3 petal tips
  const tulip = (h: number, lean: number, spin: number, pink: number) => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, h, 10), STEM);
    stem.position.y = h / 2;
    g.add(stem);

    const leafGeo = new THREE.ConeGeometry(0.16, 0.9, 8);
    leafGeo.scale(1, 1, 0.35);
    const leaf1 = new THREE.Mesh(leafGeo, LEAF);
    leaf1.position.set(0.16, h * 0.32, 0);
    leaf1.rotation.z = -0.5;
    g.add(leaf1);
    const leaf2 = leaf1.clone();
    leaf2.position.x = -0.16;
    leaf2.rotation.z = 0.55;
    leaf2.rotation.y = Math.PI;
    g.add(leaf2);

    const head = new THREE.Group();
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 14), mat(pink));
    bud.scale.set(1, 1.25, 1);
    head.add(bud);
    // petal tips poking up
    for (let k = 0; k < 3; k++) {
      const petal = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 8), mat(pink));
      const a = (k / 3) * Math.PI * 2;
      petal.position.set(Math.cos(a) * 0.14, 0.34, Math.sin(a) * 0.14);
      head.add(petal);
    }
    head.position.y = h + 0.16;
    g.add(head);

    g.rotation.z = lean;
    g.rotation.y = spin;
    g.position.y = 1.1;
    return g;
  };

  const stems: { g: ReturnType<typeof tulip>; lean: number; phase: number; amp: number }[] = [
    { g: tulip(1.5, 0.0, 0, PINKS[0]), lean: 0.0, phase: 0.0, amp: 0.085 },
    { g: tulip(1.15, 0.28, 2.1, PINKS[1]), lean: 0.28, phase: 1.9, amp: 0.07 },
    { g: tulip(1.25, -0.24, 4.2, PINKS[2]), lean: -0.24, phase: 3.7, amp: 0.075 },
  ];
  stems.forEach((s) => pot.add(s.g));
  pot.position.y = -1.15;
  scene.add(pot);

  let raf = 0;
  let running = true;
  const t0 = performance.now();
  const render = () => {
    if (!running) return;
    const t = (performance.now() - t0) / 1000;
    if (!reduced) {
      pot.rotation.y = t * 0.45;
      pot.position.y = -1.15 + Math.sin(t * 1.4) * 0.05; // gentle bob
      // wind: each stem sways on its own rhythm, with a shared gust
      const gust = Math.sin(t * 0.5) * 0.4 + 0.6;
      for (const s of stems) {
        s.g.rotation.z = s.lean + Math.sin(t * 1.7 + s.phase) * s.amp * gust;
        s.g.rotation.x = Math.sin(t * 1.1 + s.phase * 1.3) * 0.035 * gust;
      }
    }
    renderer.render(scene, camera);
    if (!reduced) raf = requestAnimationFrame(render);
  };
  render();
  if (reduced) renderer.render(scene, camera); // single static frame

  // pause when offscreen, free GPU when removed
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; render(); }
    else if (!e.isIntersecting) { running = false; cancelAnimationFrame(raf); }
  });
  io.observe(el);
  const mo = new MutationObserver(() => {
    if (!document.contains(el)) {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      mo.disconnect();
      renderer.dispose();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}
