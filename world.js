// world.js - star system (sun, stars, planets, asteroids) and the player ship model
import * as THREE from './three.module.js';
import { rng, hash, makeName, simplex } from './noise.js';
import { cubeFromFn } from './atmosphere.js';
import { makePlanet, disposePlanet } from './planet.js';

function glowTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.25, outer);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function makeStars(r) {
    const n = 3500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const R = 300000;
        pos[i * 3] = Math.cos(a) * s * R; pos[i * 3 + 1] = u * R; pos[i * 3 + 2] = Math.sin(a) * s * R;
        c.setHSL(r() < 0.5 ? 0.6 : 0.1, 0.3 + r() * 0.5, 0.6 + r() * 0.4);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -1;
    return p;
}

export function makeSystem(scene, seed, first) {
    const r = rng(seed);
    const sys = { seed, name: makeName(r, 2) + ' System', planets: [], group: new THREE.Group() };
    scene.add(sys.group);
    const sunHue = [0.12, 0.08, 0.02, 0.6, 0.14][Math.floor(r() * 5)];
    const sunCol = new THREE.Color().setHSL(sunHue, 0.8, 0.75);
    sys.sunColor = sunCol;
    sys.sunPos = new THREE.Vector3(0, 0, 0);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), new THREE.MeshBasicMaterial({ color: sunCol.clone().multiplyScalar(1.6), fog: false }));
    sys.group.add(sun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,255,255,1)', '#' + sunCol.getHexString()),
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true
    }));
    glow.scale.set(34000, 34000, 1);
    sys.group.add(glow);
    sys.sunMeshes = [sun, glow];
    const light = new THREE.PointLight(sunCol.clone().lerp(new THREE.Color(1, 1, 1), 0.7), 2.5, 0, 0);
    sys.group.add(light);
    sys.light = light;
    sys.ambient = new THREE.AmbientLight(0xffffff, 0.35);
    sys.group.add(sys.ambient);
    sys.stars = makeStars(r);
    sys.group.add(sys.stars);
    sys.bg = new THREE.Color().setHSL(r(), 0.45, 0.012);
    sys.nebula = nebula(seed, r);

    const count = 3 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
        const orbit = 32000 + i * 24000 + r() * 8000;
        const a = r() * Math.PI * 2;
        const c = new THREE.Vector3(Math.cos(a) * orbit, (r() - 0.5) * 6000, Math.sin(a) * orbit);
        const pl = makePlanet(hash(seed + ':' + i), c, first && i === 0 ? 'lush' : null);
        sys.group.add(pl.group);
        sys.planets.push(pl);
    }
    // asteroids around each planet
    const ast = [];
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a817a });
    for (const pl of sys.planets) {
        for (let k = 0; k < 45; k++) {
            const v = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.4, r() - 0.5).normalize();
            const d = pl.p.R * (2.4 + r() * 1.6);
            ast.push({ pos: v.multiplyScalar(d).add(pl.center), r: 10 + r() * 35, hp: 2, rot: r() * 6, alive: true });
        }
    }
    const im = new THREE.InstancedMesh(geo, mat, ast.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    ast.forEach((a, i) => {
        q.setFromEuler(new THREE.Euler(a.rot, a.rot * 2, a.rot * 0.5));
        s.set(a.r, a.r * 0.8, a.r * 1.1);
        m.compose(a.pos, q, s);
        im.setMatrixAt(i, m);
        a.idx = i;
    });
    im.frustumCulled = false;
    sys.group.add(im);
    sys.asteroids = { im, list: ast };
    return sys;
}

function nebula(seed, r) {
    const n = simplex(seed + 1), w = simplex(seed + 2);
    const ca = new THREE.Color().setHSL(r(), 0.7, 0.5), cb = new THREE.Color().setHSL(r(), 0.8, 0.55);
    const fbm = (x, y, z, o) => { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * n(x * f, y * f, z * f); a *= 0.5; f *= 2.05; } return v; };
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const t = cubeFromFn(128, (d, o) => {
        const wx = w(d.x * 1.3, d.y * 1.3, d.z * 1.3) * 0.9;
        const v = fbm(d.x * 1.4 + wx, d.y * 1.4 - wx, d.z * 1.4 + wx * 0.5, 5) * 0.5 + 0.5;
        const v2 = fbm(d.x * 3.3 - wx, d.y * 3.3, d.z * 3.3 + wx, 4) * 0.5 + 0.5;
        const dust = sm(0.55, 0.75, fbm(d.x * 5 + 9, d.y * 5, d.z * 5, 3) * 0.5 + 0.5);
        const band = Math.exp(-Math.pow(d.y * 3 + wx * 0.8, 2));
        const a = sm(0.42, 0.85, v) * (0.35 + 0.65 * band), b = Math.pow(sm(0.5, 0.95, v2), 2);
        const k = 1 - dust * 0.7;
        o[0] = Math.min(255, (ca.r * a * 0.4 + cb.r * b * 0.32 + band * 0.05) * k * 255);
        o[1] = Math.min(255, (ca.g * a * 0.4 + cb.g * b * 0.32 + band * 0.045) * k * 255);
        o[2] = Math.min(255, (ca.b * a * 0.4 + cb.b * b * 0.32 + band * 0.06) * k * 255);
        o[3] = 255;
    });
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function makeStreaks(scene) {
    const n = 260, pos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.frustumCulled = false;
    scene.add(m);
    const off = [];
    for (let i = 0; i < n; i++) off.push(new THREE.Vector3((Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240, (Math.random() - 0.5) * 240));
    return { m, off };
}

const _sv = new THREE.Vector3();
export function updateStreaks(st, eye, vel, show, dt) {
    const sp = vel.length();
    const k = show ? Math.min(1, Math.max(0, (sp - 120) / 600)) : 0;
    st.m.material.opacity += (k * 0.8 - st.m.material.opacity) * Math.min(1, dt * 4);
    st.m.visible = st.m.material.opacity > 0.01;
    if (!st.m.visible) return;
    st.m.position.copy(eye);
    const a = st.m.geometry.attributes.position.array;
    const len = Math.min(60, sp * 0.02);
    _sv.copy(vel).normalize();
    const mv = Math.min(sp * dt, 200);
    for (let i = 0; i < st.off.length; i++) {
        const o = st.off[i];
        o.addScaledVector(_sv, -mv);
        for (const ax of ['x', 'y', 'z']) { if (o[ax] < -120) o[ax] += 240; else if (o[ax] > 120) o[ax] -= 240; }
        a[i * 6] = o.x; a[i * 6 + 1] = o.y; a[i * 6 + 2] = o.z;
        a[i * 6 + 3] = o.x - _sv.x * len; a[i * 6 + 4] = o.y - _sv.y * len; a[i * 6 + 5] = o.z - _sv.z * len;
    }
    st.m.geometry.attributes.position.needsUpdate = true;
}

export function killAsteroid(sys, a) {
    a.alive = false;
    sys.asteroids.im.setMatrixAt(a.idx, new THREE.Matrix4().makeScale(0, 0, 0));
    sys.asteroids.im.instanceMatrix.needsUpdate = true;
}

export function disposeSystem(sys) {
    for (const pl of sys.planets) disposePlanet(pl);
    sys.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
    });
    sys.group.removeFromParent();
}

export function nearestPlanet(sys, pos) {
    let best = null, bd = Infinity;
    for (const pl of sys.planets) {
        const d = pos.distanceTo(pl.center) - pl.p.R;
        if (d < bd) { bd = d; best = pl; }
    }
    return best;
}

// ---------- ship ----------
function lam(c, extra) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: c }, extra || {}));
}

export function makeShip() {
    const g = new THREE.Group();
    const hull = lam(0xd8d4cc), dark = lam(0x3a3f48), accent = lam(0xe8742a);
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.9, 1.4, 7, 6).rotateX(-Math.PI / 2), hull);
    add(new THREE.ConeGeometry(0.9, 2.5, 6).rotateX(-Math.PI / 2).translate(0, 0, -4.75), accent);
    add(new THREE.BoxGeometry(7.5, 0.18, 2.4).translate(0, -0.3, 1.2), hull);
    add(new THREE.BoxGeometry(7.6, 0.2, 0.5).translate(0, -0.28, 0.1), accent);
    add(new THREE.BoxGeometry(0.15, 1.4, 1.6).translate(3.75, 0.3, 1.8), dark);
    add(new THREE.BoxGeometry(0.15, 1.4, 1.6).translate(-3.75, 0.3, 1.8), dark);
    add(new THREE.BoxGeometry(0.15, 1.6, 1.8).translate(0, 1.2, 3), dark);
    add(new THREE.CylinderGeometry(0.5, 0.65, 1.8, 8).rotateX(Math.PI / 2).translate(1.3, 0, 3.4), dark);
    add(new THREE.CylinderGeometry(0.5, 0.65, 1.8, 8).rotateX(Math.PI / 2).translate(-1.3, 0, 3.4), dark);
    // canopy (front faces only, so it is invisible from inside)
    add(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.75, 1.7).translate(0, 0.6, -1.3),
        new THREE.MeshLambertMaterial({ color: 0x223a55, transparent: true, opacity: 0.55 }));
    // cockpit frame, visible from inside as a fixed reference
    const frame = lam(0x2a2d33, { side: THREE.DoubleSide });
    add(new THREE.TorusGeometry(1.05, 0.045, 4, 18, Math.PI).translate(0, 0.6, -2.4), frame);
    add(new THREE.TorusGeometry(1.05, 0.045, 4, 18, Math.PI).translate(0, 0.6, 0.3), frame);
    add(new THREE.BoxGeometry(0.06, 0.06, 2.7).translate(0, 1.42, -1.05), frame);
    add(new THREE.BoxGeometry(2.0, 0.08, 0.5).translate(0, -0.05, -2.1), dark);
    // landing gear
    for (const [x, z] of [[0, -3.2], [2.2, 1.6], [-2.2, 1.6]]) {
        add(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5).translate(x, -1, z), dark);
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8).translate(x, -1.7, z), dark);
    }
    // engine glow
    const gm = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Group();
    for (const x of [1.3, -1.3]) {
        const m = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3, 8, 1, true).rotateX(Math.PI / 2).translate(x, 0, 5.8), gm);
        glow.add(m);
    }
    g.add(glow);
    return { group: g, glow, gearH: 1.75, seat: new THREE.Vector3(0, -0.55, -1.0) };
}

export function systemSeed(n) {
    return hash('nomad-system-' + n);
}
