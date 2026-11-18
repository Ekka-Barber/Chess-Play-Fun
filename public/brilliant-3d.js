// The Brilliant celebration in real 3D. A transparent WebGL layer sits over the board with a perspective camera
// looking straight down, so the board plane lines up with the squares underneath and anything that rises towards
// the camera gains size, parallax and a cast shadow on the real board. three.js is fetched on first use only.
// The star is the badge's own "!!" as a solid object. Sequence (ms): 320 the piece lands and shards race in across
// the board to build the mark in mid-air; 700 it hangs over the board and each stroke flips end over end, one a beat
// behind the other; 1080 it drops like a stamp; 1220 it strikes the square, shatters back into shards that bounce
// away, and a ring of glass slabs ripples outwards. Everything is gone by 2400.
(function (root) {
  const THREE_URL = 'vendor/three/three.module.js';
  const IMPACT = 320, BUILT = 700, DROP = 1080, STRIKE = 1220, END = 2400;
  let library = null;
  const load = () => (library ||= import('./' + THREE_URL).catch((error) => { library = null; throw error; }));

  // start() returns a stop function at once; the scene appears when the library has loaded. onFail lets the caller
  // fall back to the flat effect (no WebGL, or the library could not be fetched); onDone fires after the last frame.
  function start({ board, square, color = '#0d7a73', onFail = () => {}, onDone = () => {} }) {
    let stopped = false, dispose = () => {};
    const stop = () => { if (!stopped) { stopped = true; dispose(); } };
    load().then((THREE) => {
      if (stopped) return;
      const box = board.getBoundingClientRect();
      const cells = [...board.querySelectorAll('#squares .square')].filter((cell) => /^[a-h][1-8]$/.test(cell.dataset.square));
      const origin = cells.find((cell) => cell.dataset.square === square);
      if (!origin || !box.width) throw new Error('No board to draw on');
      // World units are squares: the board spans -4..4 on x and y, z points at the viewer.
      const place = (cell) => { const r = cell.getBoundingClientRect();
        return [((r.left + r.width / 2 - box.left) / box.width - 0.5) * 8, (0.5 - (r.top + r.height / 2 - box.top) / box.height) * 8]; };
      const [ox, oy] = place(origin);
      // The mark hangs a little towards the middle so perspective never pushes it off an edge square.
      const HOVER = 2.7, hx = ox * 0.72, hy = oy * 0.72;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      const canvas = renderer.domElement;
      canvas.className = 'brilliant-3d';
      canvas.setAttribute('aria-hidden', 'true');
      renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
      renderer.setSize(box.width, box.height, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      const fov = 34, height = 4 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 60);
      camera.position.set(0, 0, height);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x1c3b38, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 2.6);
      sun.position.set(ox - 3.5, oy + 4.5, 12);
      sun.target.position.set(ox, oy, 0);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 });
      sun.shadow.radius = 4;
      scene.add(sun, sun.target);
      // A point light beside the mark makes its bevels flash as the strokes flip, and flares at the strike.
      const glint = new THREE.PointLight(0xdffffb, 0, 9, 1.6);
      scene.add(glint);

      // Only shadows are drawn on this plane, so they fall on the real squares and pieces beneath the canvas.
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.3 }));
      ground.receiveShadow = true;
      scene.add(ground);

      const teal = new THREE.Color(color), bright = teal.clone().lerp(new THREE.Color(0x4fe0d6), 0.55);
      const solid = new THREE.MeshStandardMaterial({ color: bright, emissive: teal, emissiveIntensity: 0.35, roughness: 0.18, metalness: 0.25 });

      // One stroke of the mark: a wedge that narrows towards its dot, cut thick with bevelled edges.
      const wedge = new THREE.Shape([[-0.2, 0.92], [0.2, 0.92], [0.11, -0.2], [-0.11, -0.2]].map(([x, y]) => new THREE.Vector2(x, y)));
      const dot = new THREE.Shape().absarc(0, -0.62, 0.17, 0, Math.PI * 2);
      const cut = { depth: 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2, curveSegments: 14 };
      const strokeGeometry = new THREE.ExtrudeGeometry([wedge, dot], cut).translate(0, -0.15, -0.15);
      const mark = new THREE.Group();
      const strokes = [-0.3, 0.3].map((x) => { const stroke = new THREE.Mesh(strokeGeometry, solid);
        stroke.position.x = x; stroke.castShadow = true; mark.add(stroke); return stroke; });
      mark.rotation.z = -0.14; // the forward lean of a mark written at speed
      mark.visible = false;
      scene.add(mark);

      const COUNT = 26;
      const shards = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.17),
        new THREE.MeshStandardMaterial({ color: bright, emissive: teal, emissiveIntensity: 0.3, roughness: 0.15, metalness: 0.25, flatShading: true }), COUNT);
      shards.castShadow = true;
      shards.visible = false;
      scene.add(shards);
      // Fixed pseudo-random spread: the same scene every time, so the effect can be judged and tuned.
      const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
      const bits = Array.from({ length: COUNT }, (_, i) => { const angle = (i / COUNT) * Math.PI * 2 + noise(i) * 0.5, speed = 2.4 + noise(i + 40) * 3.6;
        return { angle, from: 2.6 + noise(i + 280) * 2.4, late: noise(i + 320) * 0.3, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          vz: 1 + noise(i + 80) * 3.4, size: 0.6 + noise(i + 120) * 0.8,
          spin: new THREE.Vector3(noise(i + 160) - 0.5, noise(i + 200) - 0.5, noise(i + 240) - 0.5).multiplyScalar(14) }; });

      const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.92, 0.07),
        new THREE.MeshStandardMaterial({ color: bright, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.44 }), cells.length);
      slabs.castShadow = true;
      const wave = cells.map((cell) => { const [x, y] = place(cell), dx = x - ox, dy = y - oy, distance = Math.hypot(dx, dy);
        // Each slab tips about the axis that lies across the ripple's direction of travel.
        return { x, y, delay: STRIKE + distance * 72, axis: new THREE.Vector3(-dy, dx, 0).normalize(), still: distance < 0.01 }; });
      scene.add(slabs);

      board.append(canvas);
      const pose = new THREE.Object3D(), clamp = (t) => Math.max(0, Math.min(1, t));
      const out = (t) => 1 - (1 - t) ** 3, into = (t) => t ** 3;
      const GRAVITY = 15, FLOOR = 0.1, START = 0.3;
      let frame = 0;
      const began = performance.now();
      function draw(now) {
        const t = now - began;
        if (t >= END) { stop(); onDone(); return; }

        const built = clamp((t - IMPACT - 160) / (BUILT - IMPACT - 160)), drop = into(clamp((t - DROP) / (STRIKE - DROP))), broken = clamp((t - STRIKE) / 80);
        mark.visible = built > 0 && broken < 1;
        if (mark.visible) {
          mark.position.set(hx + (ox - hx) * drop, hy + (oy - hy) * drop, HOVER + (0.22 - HOVER) * drop);
          mark.scale.setScalar(out(built) * 1.25 * (1 - broken));
          // Each stroke turns end over end once while the mark hangs, the second a beat behind the first.
          strokes.forEach((stroke, i) => { const flip = clamp((t - BUILT + 40 - i * 90) / 330); stroke.rotation.x = -Math.PI * 2 * (flip * flip * (3 - 2 * flip)); });
          mark.rotation.y = Math.sin((t - BUILT) / 190) * 0.22 * (1 - drop);
          glint.position.set(mark.position.x + 1.2, mark.position.y + 1, mark.position.z + 1.5);
          glint.intensity = 24 * built;
        } else glint.intensity = t >= STRIKE ? 46 * (1 - clamp((t - STRIKE) / 260)) : 0;
        if (t >= STRIKE) glint.position.set(ox, oy, 1.4);

        shards.visible = (t >= IMPACT && t < BUILT + 60) || t >= STRIKE;
        if (shards.visible) {
          const s = (t - STRIKE) / 1000, fade = 1 - clamp((t - (END - 420)) / 380);
          bits.forEach((bit, i) => {
            if (t < STRIKE) {
              // Gathering: each shard slides off the board and climbs into the mark, shrinking as it joins.
              const g = into(clamp((t - IMPACT) / (BUILT - IMPACT) - bit.late * 0.5) / (1 - bit.late * 0.5)), reach = bit.from * (1 - g);
              pose.position.set(hx + Math.cos(bit.angle) * reach + (ox - hx) * (1 - g), hy + Math.sin(bit.angle) * reach + (oy - hy) * (1 - g), FLOOR + (HOVER - FLOOR) * g);
              pose.rotation.set(bit.spin.x * g * 0.5, bit.spin.y * g * 0.5, bit.spin.z * g * 0.5);
              pose.scale.setScalar(bit.size * Math.min(1, (t - IMPACT) / 90) * (1 - g * g));
            } else {
              // Ballistic flight out of the strike, one damped bounce on the board, then rest.
              let z = START + bit.vz * s - GRAVITY * s * s / 2, travel = s;
              const fall = (bit.vz + Math.sqrt(bit.vz ** 2 + 2 * GRAVITY * (START - FLOOR))) / GRAVITY;
              if (s > fall) {
                const after = s - fall, up = (GRAVITY * fall - bit.vz) * 0.4, hop = 2 * up / GRAVITY;
                z = after < hop ? FLOOR + up * after - GRAVITY * after * after / 2 : FLOOR;
                travel = fall + Math.min(after, hop) * 0.45;
              }
              pose.position.set(ox + bit.vx * travel, oy + bit.vy * travel, z);
              pose.rotation.set(bit.spin.x * travel, bit.spin.y * travel, bit.spin.z * travel);
              pose.scale.setScalar(bit.size * fade);
            }
            pose.updateMatrix();
            shards.setMatrixAt(i, pose.matrix);
          });
          shards.instanceMatrix.needsUpdate = true;
        }

        pose.rotation.set(0, 0, 0);
        wave.forEach((slab, i) => {
          const p = clamp((t - slab.delay) / 300), lift = p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0;
          pose.position.set(slab.x, slab.y, 0.04 + lift * 0.85);
          pose.quaternion.setFromAxisAngle(slab.still ? pose.up : slab.axis, slab.still ? 0 : Math.sin(p * Math.PI * 2) * 0.5);
          pose.scale.setScalar(lift > 0 ? 0.55 + lift * 0.45 : 0);
          pose.updateMatrix();
          slabs.setMatrixAt(i, pose.matrix);
        });
        slabs.instanceMatrix.needsUpdate = true;

        renderer.render(scene, camera);
        frame = root.requestAnimationFrame(draw);
      }
      // A piece picked up mid-celebration must be visible at once.
      const interrupt = () => { stop(); onDone(); };
      board.addEventListener('pointerdown', interrupt, { capture: true, once: true });
      dispose = () => {
        root.cancelAnimationFrame(frame);
        board.removeEventListener('pointerdown', interrupt, { capture: true });
        canvas.remove();
        strokeGeometry.dispose(); solid.dispose();
        for (const mesh of [slabs, shards, ground]) { mesh.geometry.dispose(); mesh.material.dispose(); }
        renderer.dispose();
        renderer.forceContextLoss();
      };
      frame = root.requestAnimationFrame(draw);
    }).catch((error) => { if (!stopped) { stop(); onFail(error); } });
    return stop;
  }

  root.CHESS_BRILLIANT_3D = { start, preload: () => load().catch(() => {}) };
})(window);
