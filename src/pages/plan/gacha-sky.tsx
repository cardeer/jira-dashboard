import { useEffect, useRef } from 'react';
import type * as THREE_NS from 'three';

type Three = typeof THREE_NS;

interface Props {
  /** One meteor per voter, in landing order. Rarity (3–5) sets how big the impact is. */
  meteors: { color: string; rarity: number }[];
  /** Called once the last meteor has hit. */
  onLanded: () => void;
  /** WebGL unavailable or three.js failed to load: the caller falls back to the CSS meteor. */
  onError: () => void;
}

const FLIGHT = 1.35; // seconds per meteor
const TRAIL = 40; // glow sprites per trail
const LAND_Z = -30;

/** Soft round glow used for stars, meteor heads, trails and bursts. */
function glowTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(THREE: Three) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * Genshin-style wish sky in WebGL: a deep starfield and one colored meteor per voter diving
 * out of the distance toward the camera, each landing with a burst and a camera shake.
 * After the last impact it keeps rendering a slowly turning sky behind the cards.
 */
export function GachaSky({ meteors, onLanded, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onLanded, onError });
  cb.current = { onLanded, onError };

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    import('three')
      .then((THREE) => {
        if (disposed) return;
        const host = hostRef.current!;
        let renderer: THREE_NS.WebGLRenderer;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        } catch {
          cb.current.onError();
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(host.clientWidth, host.clientHeight);
        renderer.setClearColor(0x05070f, 1);
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x05070f, 0.0005);
        const camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 3000);
        const camBase = new THREE.Vector3(0, 10, 70);
        camera.position.copy(camBase);
        camera.lookAt(0, 4, LAND_Z);

        const glow = glowTexture(THREE);
        const ring = ringTexture(THREE);
        const disposables: { dispose(): void }[] = [glow, ring];

        // Starfield: thousands of points on a big shell, tinted slightly blue/gold
        const starCount = 2600;
        const pos = new Float32Array(starCount * 3);
        const col = new Float32Array(starCount * 3);
        const tint = new THREE.Color();
        for (let i = 0; i < starCount; i++) {
          const r = 500 + Math.random() * 900;
          const th = Math.random() * Math.PI * 2;
          const ph = Math.acos(2 * Math.random() - 1);
          pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
          pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.8 - 60;
          pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 200;
          tint.setHSL(Math.random() < 0.8 ? 0.62 : 0.12, 0.6, 0.75 + Math.random() * 0.25);
          col.set([tint.r, tint.g, tint.b], i * 3);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const starMat = new THREE.PointsMaterial({
          size: 8,
          map: glow,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          sizeAttenuation: true,
        });
        const stars = new THREE.Points(starGeo, starMat);
        scene.add(stars);
        disposables.push(starGeo, starMat);

        // Nebula haze far away
        const nebula: THREE_NS.Sprite[] = [];
        [
          [0x3b2a7a, -260, 120, -900, 900],
          [0x1d3f8a, 320, 60, -1000, 1100],
          [0x6a2c6f, 40, -40, -700, 700],
        ].forEach(([color, x, y, z, s]) => {
          const m = new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
          const sp = new THREE.Sprite(m);
          sp.position.set(x, y, z);
          sp.scale.setScalar(s);
          scene.add(sp);
          nebula.push(sp);
          disposables.push(m);
        });

        // Glowing altar ring where the meteors land
        const altarMat = new THREE.MeshBasicMaterial({ map: ring, color: 0x8fb3ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
        const altarGeo = new THREE.PlaneGeometry(70, 70);
        const altar = new THREE.Mesh(altarGeo, altarMat);
        altar.rotation.x = -Math.PI / 2;
        altar.position.set(0, -2, LAND_Z);
        scene.add(altar);
        disposables.push(altarMat, altarGeo);

        // Meteors
        const n = meteors.length;
        const stagger = n > 1 ? Math.min(0.32, 1.6 / (n - 1)) : 0;
        const spread = Math.min(9, 70 / Math.max(1, n));
        type Meteor = {
          color: THREE_NS.Color;
          rarity: number;
          start: number;
          p0: THREE_NS.Vector3;
          p1: THREE_NS.Vector3;
          p2: THREE_NS.Vector3;
          head: THREE_NS.Sprite;
          halo: THREE_NS.Sprite;
          trail: THREE_NS.Sprite[];
          landed: boolean;
        };
        const bez = (m: Meteor, t: number, out: THREE_NS.Vector3) => {
          const u = 1 - t;
          return out
            .copy(m.p0)
            .multiplyScalar(u * u)
            .addScaledVector(m.p1, 2 * u * t)
            .addScaledVector(m.p2, t * t);
        };
        const list: Meteor[] = meteors.map(({ color: hex, rarity }, i) => {
          const color = new THREE.Color(hex);
          const side = i % 2 ? 1 : -1;
          const p0 = new THREE.Vector3(side * (180 + Math.random() * 220), 160 + Math.random() * 140, -900 - Math.random() * 300);
          const p2 = new THREE.Vector3((i - (n - 1) / 2) * spread, 0, LAND_Z + (Math.random() - 0.5) * 10);
          const p1 = new THREE.Vector3(p0.x * 0.25, p0.y * 0.75 + 30, -300);
          const headMat = new THREE.SpriteMaterial({ map: glow, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
          const head = new THREE.Sprite(headMat);
          head.visible = false;
          scene.add(head);
          // Colored halo around the white-hot core
          const haloMat = new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
          const halo = new THREE.Sprite(haloMat);
          halo.visible = false;
          scene.add(halo);
          disposables.push(headMat, haloMat);
          const trail = Array.from({ length: TRAIL }, (_, k) => {
            const m = new THREE.SpriteMaterial({
              map: glow,
              color,
              transparent: true,
              opacity: (1 - k / TRAIL) * 0.85,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            });
            const s = new THREE.Sprite(m);
            s.visible = false;
            scene.add(s);
            disposables.push(m);
            return s;
          });
          return { color, rarity, start: i * stagger, p0, p1, p2, head, halo, trail, landed: false };
        });

        // Impact effects: expanding rings + spark particles
        type Burst = { ring: THREE_NS.Sprite; sparks: THREE_NS.Points; vel: Float32Array; born: number; strength: number };
        const bursts: Burst[] = [];
        const spawnBurst = (at: THREE_NS.Vector3, color: THREE_NS.Color, strength: number, now: number) => {
          const rm = new THREE.SpriteMaterial({ map: ring, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
          const r = new THREE.Sprite(rm);
          r.position.copy(at);
          scene.add(r);
          const count = Math.round(60 * strength);
          const sp = new Float32Array(count * 3);
          const vel = new Float32Array(count * 3);
          for (let k = 0; k < count; k++) {
            sp.set([at.x, at.y, at.z], k * 3);
            const th = Math.random() * Math.PI * 2;
            const up = Math.random();
            const speed = 20 + Math.random() * 60 * strength;
            vel.set([Math.cos(th) * speed * (1 - up * 0.5), up * speed, Math.sin(th) * speed * (1 - up * 0.5)], k * 3);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
          const pm = new THREE.PointsMaterial({ size: 3, map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
          const pts = new THREE.Points(g, pm);
          scene.add(pts);
          bursts.push({ ring: r, sparks: pts, vel, born: now, strength });
          disposables.push(rm, g, pm);
        };

        let shake = 0;
        let landedAll = false;
        const t0 = performance.now();
        let last = t0;
        const tmp = new THREE.Vector3();
        let raf = 0;

        const frame = (nowMs: number) => {
          const now = (nowMs - t0) / 1000;
          const dt = Math.min(0.05, (nowMs - last) / 1000);
          last = nowMs;

          stars.rotation.y += dt * 0.012;
          nebula.forEach((s, i) => (s.material.opacity = 0.28 + Math.sin(now * 0.6 + i) * 0.07));

          for (const m of list) {
            const t = (now - m.start) / FLIGHT;
            if (t < 0) continue;
            if (!m.landed) {
              // Ease-in: meteors accelerate as they come at you
              const e = Math.min(1, t * t * (0.6 + 0.4 * t));
              m.head.visible = true;
              bez(m, e, m.head.position);
              const near = 1 - Math.abs(m.head.position.z - LAND_Z) / 1000;
              m.head.scale.setScalar(6 + near * 14);
              m.halo.visible = true;
              m.halo.position.copy(m.head.position);
              m.halo.scale.setScalar((16 + near * 40) * (0.9 + Math.sin(now * 30 + m.start) * 0.1));
              m.trail.forEach((s, k) => {
                const te = Math.max(0, e - (k + 1) * 0.016 * (0.35 + e));
                s.visible = te > 0;
                bez(m, te, s.position);
                s.scale.setScalar((7 + near * 18) * (1 - k / TRAIL));
              });
              if (t >= 1) {
                m.landed = true;
                m.head.visible = false;
                m.halo.visible = false;
                m.trail.forEach((s) => (s.visible = false));
                const strength = m.rarity >= 5 ? 1.6 : m.rarity === 4 ? 1.2 : 1;
                spawnBurst(m.p2, m.color, strength, now);
                shake = Math.min(3.5, shake + 1.2 * strength);
                altarMat.color.copy(m.color);
                altarMat.opacity = 0.9;
              }
            }
          }
          altarMat.opacity = Math.max(0.2, altarMat.opacity - dt * 0.9);
          altar.rotation.z += dt * 0.3;

          for (let b = bursts.length - 1; b >= 0; b--) {
            const br = bursts[b];
            const age = now - br.born;
            const k = Math.min(1, age / 0.9);
            br.ring.scale.setScalar(6 + k * 70 * br.strength);
            br.ring.material.opacity = 1 - k;
            const arr = br.sparks.geometry.getAttribute('position') as THREE_NS.BufferAttribute;
            for (let i = 0; i < arr.count; i++) {
              br.vel[i * 3 + 1] -= 40 * dt;
              arr.setXYZ(i, arr.getX(i) + br.vel[i * 3] * dt, arr.getY(i) + br.vel[i * 3 + 1] * dt, arr.getZ(i) + br.vel[i * 3 + 2] * dt);
            }
            arr.needsUpdate = true;
            (br.sparks.material as THREE_NS.PointsMaterial).opacity = Math.max(0, 1 - age / 1.6);
            if (age > 1.6) {
              scene.remove(br.ring, br.sparks);
              bursts.splice(b, 1);
            }
          }

          // Camera: slow push-in during the meteor shower, then drift; plus impact shake
          const push = Math.min(1, now / (FLIGHT + (n - 1) * stagger + 0.4));
          camera.position.set(
            camBase.x + Math.sin(now * 0.25) * 4 + (Math.random() - 0.5) * shake,
            camBase.y - push * 3 + (Math.random() - 0.5) * shake,
            camBase.z - push * 18,
          );
          camera.lookAt(tmp.set(0, 4, LAND_Z));
          shake = Math.max(0, shake - dt * 6);

          if (!landedAll && list.every((m) => m.landed)) {
            landedAll = true;
            setTimeout(() => !disposed && cb.current.onLanded(), 350);
          }
          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        if (!n) setTimeout(() => !disposed && cb.current.onLanded(), 300);

        const onResize = () => {
          renderer.setSize(host.clientWidth, host.clientHeight);
          camera.aspect = host.clientWidth / host.clientHeight;
          camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);

        cleanup = () => {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          disposables.forEach((d) => d.dispose());
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => !disposed && cb.current.onError());

    return () => {
      disposed = true;
      cleanup();
    };
    // The scene is built once per reveal.
  }, [meteors]);

  return <div ref={hostRef} className="absolute inset-0" aria-hidden />;
}
