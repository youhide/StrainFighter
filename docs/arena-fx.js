const canvas = document.querySelector('#arena-fx');
const arena = canvas?.parentElement;
const motion = matchMedia('(prefers-reduced-motion: reduce)');

async function start() {
  if (!canvas || motion.matches) return;
  const context = canvas.getContext('webgl2', { alpha: true, antialias: false });
  if (!context) return;
  const three = await import('./vendor/three-webgl.js');
  const renderer = new three.WebGLRenderer({ canvas, context, alpha: true, antialias: false });
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(43, 1, 0.1, 35);
  camera.position.z = 12;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));

  const motes = particleLayer(72, canvas.dataset.tint ?? '#c9f16a', 0.065, 0.75);
  const sparks = particleLayer(26, canvas.dataset.spark ?? '#ffb677', 0.1, 0);
  const paths = Array.from({ length: 72 }, () => ({
    horizontal: Math.random(), rise: Math.random(), depth: Math.random() * 4 - 2,
    speed: 0.035 + Math.random() * 0.08,
  }));
  const burst = Array.from({ length: 26 }, (_, i) => ({
    angle: i / 26 * Math.PI * 2 + Math.random() * 0.26,
    speed: 1 + Math.random() * 3,
  }));
  let impact = -10;
  let visible = false;
  let active = false;

  function particleLayer(count, color, size, opacity) {
    const positions = new Float32Array(count * 3);
    const geometry = new three.BufferGeometry();
    const attribute = new three.BufferAttribute(positions, 3).setUsage(three.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    const material = new three.PointsMaterial({ color, size, opacity, transparent: true,
      blending: three.AdditiveBlending, depthWrite: false });
    const points = new three.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return { attribute, material };
  }

  function resize() {
    const { width, height } = arena.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function draw(time) {
    const seconds = time / 1_000;
    const width = 10 * camera.aspect;
    paths.forEach(({ horizontal, rise, depth, speed }, i) => {
      const phase = (rise + seconds * speed) % 1;
      motes.attribute.setXYZ(i, (horizontal - 0.5) * width + Math.sin(seconds + i) * 0.23,
        -4.6 + phase * 8.6, depth);
    });
    motes.attribute.needsUpdate = true;
    const age = seconds - impact;
    sparks.material.opacity = Math.max(0, 1 - age / 0.49);
    if (age < 0.49) {
      burst.forEach(({ angle, speed }, i) => sparks.attribute.setXYZ(i,
        width * 0.24 + Math.cos(angle) * speed * age,
        -0.45 + Math.sin(angle) * speed * age - age * age, 0));
      sparks.attribute.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  function toggle() {
    const next = visible && !document.hidden && !motion.matches && !context.isContextLost();
    if (active === next) return;
    active = next;
    renderer.setAnimationLoop(active ? draw : null);
    canvas.hidden = !active;
  }

  canvas.hidden = true;
  new ResizeObserver(resize).observe(arena);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; toggle(); }).observe(arena);
  arena.addEventListener('idle-arena-impact', () => { impact = performance.now() / 1_000; });
  document.addEventListener('visibilitychange', toggle);
  motion.addEventListener('change', toggle);
  canvas.addEventListener('webglcontextlost', toggle);
  canvas.addEventListener('webglcontextrestored', toggle);
  resize();
}

void start().catch(() => { if (canvas) canvas.hidden = true; });
