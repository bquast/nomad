// fauna.js - procedural creature species and wandering herds near the player
import * as THREE from './three.module.js';
import { rng, makeName } from './noise.js';
import { patchTint } from './atmosphere.js';

const MAX = 7;

function colored(geo, c) {
    const g = geo.toNonIndexed();
    g.computeVertexNormals();
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
}

function merge(list) {
    const ps = [], ns = [], cs = [];
    for (const g of list) {
        ps.push(...g.attributes.position.array);
        ns.push(...g.attributes.normal.array);
        cs.push(...g.attributes.color.array);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
    g.computeBoundingSphere();
    return g;
}

function makeSpecies(r, pl, i) {
    const size = 0.5 + r() * r() * 2.8;
    const legs = [2, 4, 4, 6][Math.floor(r() * 4)];
    const hue = r();
    const c1 = new THREE.Color().setHSL(hue, 0.4 + r() * 0.4, 0.35 + r() * 0.3);
    const c2 = new THREE.Color().setHSL(hue + 0.1 + r() * 0.3, 0.5, 0.25 + r() * 0.3);
    const c3 = new THREE.Color().setHSL(r(), 0.8, 0.6);
    const bl = size * (1 + r() * 0.8), bw = size * (0.5 + r() * 0.4), bh = size * (0.45 + r() * 0.35);
    const hip = size * (0.5 + r() * 0.6) * (legs === 2 ? 1.4 : 1);
    const parts = [];
    parts.push(colored(new THREE.SphereGeometry(1, 8, 6).scale(bw, bh, bl).translate(0, hip + bh * 0.5, 0), c1));
    const hs = size * (0.3 + r() * 0.25);
    const hz = bl * 0.9, hy = hip + bh * (0.9 + r() * 0.6);
    parts.push(colored(new THREE.SphereGeometry(hs, 7, 5).translate(0, hy, hz), c2));
    parts.push(colored(new THREE.SphereGeometry(hs * 0.22, 5, 4).translate(hs * 0.45, hy + hs * 0.25, hz + hs * 0.8), c3));
    parts.push(colored(new THREE.SphereGeometry(hs * 0.22, 5, 4).translate(-hs * 0.45, hy + hs * 0.25, hz + hs * 0.8), c3));
    if (r() < 0.5) {
        parts.push(colored(new THREE.ConeGeometry(hs * 0.2, hs * 1.4, 5).translate(hs * 0.4, hy + hs * 1.2, hz), c3));
        parts.push(colored(new THREE.ConeGeometry(hs * 0.2, hs * 1.4, 5).translate(-hs * 0.4, hy + hs * 1.2, hz), c3));
    }
    if (r() < 0.6) parts.push(colored(new THREE.ConeGeometry(bw * 0.25, bl * 0.9, 5).rotateX(-1.9).translate(0, hip + bh * 0.6, -bl * 1.1), c1));
    const body = merge(parts);
    const legA = [], legB = [];
    const lr = size * 0.09 + 0.03;
    const rows = legs / 2;
    for (let k = 0; k < rows; k++) {
        const z = rows === 1 ? 0 : (k / (rows - 1) - 0.5) * bl * 1.2;
        const L = colored(new THREE.CylinderGeometry(lr, lr * 0.7, hip, 5).translate(bw * 0.6, hip / 2, z), c2);
        const Rr = colored(new THREE.CylinderGeometry(lr, lr * 0.7, hip, 5).translate(-bw * 0.6, hip / 2, z), c2);
        if (k % 2 === 0) { legA.push(L); legB.push(Rr); } else { legA.push(Rr); legB.push(L); }
    }
    return {
        id: pl.name + '#' + i,
        name: makeName(r, 2) + ' ' + ['Grazer', 'Hopper', 'Strider', 'Beast', 'Crawler', 'Runner'][Math.floor(r() * 6)],
        size, hip, body, legA: merge(legA), legB: merge(legB),
        speed: 1.2 + r() * 2.5 / Math.sqrt(size), timid: r() < 0.6,
        mat: patchTint(new THREE.MeshLambertMaterial({ vertexColors: true }))
    };
}

export function speciesFor(pl) {
    if (pl.species) return pl.species;
    const r = rng(pl.seed * 7 + 3);
    const n = pl.p.fauna < 0.3 ? 1 : 2 + Math.floor(r() * 2);
    pl.species = [];
    for (let i = 0; i < n; i++) pl.species.push(makeSpecies(r, pl, i));
    return pl.species;
}

export function makeFauna(scene) {
    return { scene, list: [], timer: 0, pl: null, rand: rng(Date.now() & 0xffff) };
}

function spawn(fa, pl, near) {
    const sp = speciesFor(pl);
    const s = sp[Math.floor(fa.rand() * sp.length)];
    const up = near.clone().sub(pl.center).normalize();
    // random tangent offset 40..110 m
    const t = new THREE.Vector3(fa.rand() - 0.5, fa.rand() - 0.5, fa.rand() - 0.5).cross(up).normalize();
    const d = 40 + fa.rand() * 70;
    const dir = up.clone().multiplyScalar(pl.p.R).addScaledVector(t, d).normalize();
    const h = pl.f.raw(dir.x, dir.y, dir.z);
    if (pl.p.hasSea && h < pl.p.sea + 0.5) return;
    const g = new THREE.Group();
    const body = new THREE.Mesh(s.body, s.mat), a = new THREE.Mesh(s.legA, s.mat), b = new THREE.Mesh(s.legB, s.mat);
    g.add(body, a, b);
    fa.scene.add(g);
    const heading = new THREE.Vector3(fa.rand() - 0.5, fa.rand() - 0.5, fa.rand() - 0.5).cross(dir).normalize();
    fa.list.push({ sp: s, g, a, b, dir, heading, phase: 0, wander: 0, scanned: false, walk: 1 });
}

function clear(fa) {
    for (const c of fa.list) c.g.removeFromParent();
    fa.list = [];
}

const _right = new THREE.Vector3(), _m = new THREE.Matrix4(), _away = new THREE.Vector3(), _p = new THREE.Vector3();

export function updateFauna(fa, pl, player, dt, active) {
    if (fa.pl !== pl || !active || !pl || pl.p.fauna <= 0) {
        if (fa.list.length) clear(fa);
        fa.pl = pl;
        if (!active || !pl) return;
    }
    fa.timer -= dt;
    const want = Math.round(MAX * Math.min(1, pl.p.fauna));
    if (fa.timer <= 0 && fa.list.length < want) {
        fa.timer = 1.5;
        spawn(fa, pl, player);
    }
    for (let i = fa.list.length - 1; i >= 0; i--) {
        const c = fa.list[i];
        _p.copy(c.dir).multiplyScalar(pl.p.R).add(pl.center);
        const dist = _p.distanceTo(player);
        if (dist > 220) {
            c.g.removeFromParent();
            fa.list.splice(i, 1);
            continue;
        }
        c.wander += (fa.rand() - 0.5) * dt * 3;
        c.wander *= 0.98;
        c.heading.applyAxisAngle(c.dir, c.wander * dt);
        let speed = c.sp.speed * c.walk;
        if (fa.rand() < dt * 0.15) c.walk = c.walk > 0 ? 0 : 1;
        if (c.sp.timid && dist < 14) {
            _away.copy(_p).sub(player);
            _away.addScaledVector(c.dir, -_away.dot(c.dir)).normalize();
            c.heading.lerp(_away, Math.min(1, dt * 4));
            speed = c.sp.speed * 3;
            c.walk = 1;
        }
        const nd = c.dir.clone().multiplyScalar(pl.p.R).addScaledVector(c.heading, speed * dt).normalize();
        const h = pl.f.raw(nd.x, nd.y, nd.z);
        if (pl.p.hasSea && h < pl.p.sea + 0.3) {
            c.heading.negate();
        } else {
            c.dir.copy(nd);
        }
        c.heading.addScaledVector(c.dir, -c.heading.dot(c.dir)).normalize();
        const gh = pl.f.height(c.dir.x, c.dir.y, c.dir.z);
        c.g.position.copy(c.dir).multiplyScalar(pl.p.R + gh).add(pl.center);
        _right.crossVectors(c.dir, c.heading);
        _m.makeBasis(_right, c.dir, c.heading);
        c.g.quaternion.setFromRotationMatrix(_m);
        c.phase += speed * dt * 4 / c.sp.size;
        const lift = c.sp.hip * 0.25 * Math.min(1, speed);
        c.a.position.set(0, Math.max(0, Math.sin(c.phase)) * lift, Math.cos(c.phase) * lift * 0.6);
        c.b.position.set(0, Math.max(0, -Math.sin(c.phase)) * lift, -Math.cos(c.phase) * lift * 0.6);
    }
}

export function creaturesNear(fa, pos, range) {
    return fa.list.filter(c => c.g.position.distanceTo(pos) < range);
}
