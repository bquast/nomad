// planet.js - procedural planet: params, height field, cube-sphere quadtree LOD, flora
import * as THREE from './three.module.js';
import { rng, simplex, hash, makeName } from './noise.js';

const N = 16;            // segments per chunk side
const SPLIT = 1.7;       // split when distance < chunk size * SPLIT
const MERGE = 1.3;       // hysteresis factor for merge
const FACES = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
];

export const BIOMES = ['lush', 'desert', 'frozen', 'toxic', 'barren', 'exotic', 'ocean'];

// cube face coords (a,b in -1..1) -> unit direction, written to out[0..2]
export function cubeDir(face, a, b, out) {
    const f = FACES[face];
    const x = f[0][0] + f[1][0] * a + f[2][0] * b;
    const y = f[0][1] + f[1][1] * a + f[2][1] * b;
    const z = f[0][2] + f[1][2] * a + f[2][2] * b;
    const x2 = x * x, y2 = y * y, z2 = z * z;
    out[0] = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3);
    out[1] = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3);
    out[2] = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3);
    return out;
}

function hsl(h, s, l) {
    return new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
}

export function makeParams(seed, forceType) {
    const r = rng(seed);
    const type = forceType || BIOMES[Math.floor(r() * BIOMES.length)];
    const hue = r();
    const name = makeName(r, 2 + Math.floor(r() * 2));
    const R = Math.round(1500 + r() * 1100);
    const p = {
        type, seed, name, R,
        gravity: 7 + r() * 5,
        hasSea: true, sea: 0,
        contAmp: R * (0.035 + r() * 0.025), mountAmp: R * (0.03 + r() * 0.03),
        f1: 1.2 + r() * 1.2, f2: 5 + r() * 4,
        flora: 1, fauna: 1, lifeDrain: 1,
        treeStyle: Math.floor(r() * 4)
    };
    let c;
    if (type === 'lush') {
        const g = 0.3 + (r() - 0.5) * 0.12;
        c = {
            deep: hsl(0.6, 0.7, 0.2), water: hsl(0.55, 0.6, 0.38), shore: hsl(0.12, 0.45, 0.66),
            low: hsl(g, 0.55, 0.33), mid: hsl(g + 0.04, 0.4, 0.27), high: hsl(0.08, 0.15, 0.42),
            peak: hsl(0.6, 0.1, 0.92), rock: hsl(0.07, 0.15, 0.38),
            sky: hsl(0.57, 0.6, 0.68), atmo: hsl(0.58, 0.8, 0.6),
            leaf: hsl(g + 0.02, 0.6, 0.35), trunk: hsl(0.07, 0.4, 0.28),
            plant: hsl(g - 0.05, 0.65, 0.42), crystal: hsl(0.52, 0.9, 0.6)
        };
    } else if (type === 'desert') {
        p.hasSea = r() < 0.3; p.flora = 0.35; p.fauna = 0.6; p.lifeDrain = 1.6;
        c = {
            deep: hsl(0.5, 0.5, 0.25), water: hsl(0.48, 0.5, 0.4), shore: hsl(0.1, 0.5, 0.7),
            low: hsl(0.08 + hue * 0.04, 0.55, 0.6), mid: hsl(0.06, 0.55, 0.5), high: hsl(0.03, 0.5, 0.38),
            peak: hsl(0.05, 0.3, 0.6), rock: hsl(0.03, 0.45, 0.35),
            sky: hsl(0.08, 0.6, 0.72), atmo: hsl(0.07, 0.8, 0.6),
            leaf: hsl(0.18, 0.4, 0.35), trunk: hsl(0.08, 0.35, 0.3),
            plant: hsl(0.3, 0.35, 0.38), crystal: hsl(0.9, 0.8, 0.6)
        };
    } else if (type === 'frozen') {
        p.flora = 0.4; p.fauna = 0.5; p.lifeDrain = 1.8;
        c = {
            deep: hsl(0.58, 0.5, 0.25), water: hsl(0.55, 0.4, 0.55), shore: hsl(0.55, 0.2, 0.85),
            low: hsl(0.58, 0.15, 0.88), mid: hsl(0.6, 0.12, 0.8), high: hsl(0.62, 0.1, 0.6),
            peak: hsl(0.6, 0.2, 0.97), rock: hsl(0.62, 0.1, 0.42),
            sky: hsl(0.55, 0.35, 0.8), atmo: hsl(0.55, 0.6, 0.75),
            leaf: hsl(0.5, 0.3, 0.45), trunk: hsl(0.6, 0.1, 0.3),
            plant: hsl(0.55, 0.4, 0.6), crystal: hsl(0.6, 0.9, 0.65)
        };
    } else if (type === 'toxic') {
        p.flora = 1.2; p.fauna = 0.7; p.lifeDrain = 2;
        const g = 0.17 + hue * 0.1;
        c = {
            deep: hsl(0.3, 0.6, 0.15), water: hsl(0.27, 0.7, 0.35), shore: hsl(0.15, 0.4, 0.4),
            low: hsl(g, 0.6, 0.3), mid: hsl(g + 0.06, 0.4, 0.25), high: hsl(0.8, 0.2, 0.3),
            peak: hsl(0.2, 0.4, 0.6), rock: hsl(0.85, 0.15, 0.25),
            sky: hsl(0.2, 0.6, 0.6), atmo: hsl(0.22, 0.9, 0.5),
            leaf: hsl(0.85 + hue * 0.1, 0.6, 0.4), trunk: hsl(0.1, 0.3, 0.2),
            plant: hsl(0.75, 0.6, 0.5), crystal: hsl(0.3, 1, 0.55)
        };
    } else if (type === 'barren') {
        p.hasSea = false; p.flora = 0.12; p.fauna = 0.25; p.lifeDrain = 1.4; p.mountAmp *= 1.3;
        c = {
            deep: hsl(0, 0, 0.2), water: hsl(0, 0, 0.3), shore: hsl(0.08, 0.1, 0.5),
            low: hsl(0.07 + hue * 0.05, 0.15, 0.48), mid: hsl(0.06, 0.12, 0.4), high: hsl(0.05, 0.1, 0.3),
            peak: hsl(0.06, 0.05, 0.6), rock: hsl(0.05, 0.08, 0.28),
            sky: hsl(0.08, 0.15, 0.55), atmo: hsl(0.08, 0.3, 0.55),
            leaf: hsl(0.1, 0.2, 0.35), trunk: hsl(0.08, 0.2, 0.25),
            plant: hsl(0.12, 0.3, 0.4), crystal: hsl(0.08, 0.9, 0.6)
        };
    } else if (type === 'ocean') {
        p.contAmp *= 0.8; p.sea = p.contAmp * 0.5; p.flora = 1.1;
        const g = 0.3 + hue * 0.12;
        c = {
            deep: hsl(0.62, 0.8, 0.18), water: hsl(0.52, 0.75, 0.4), shore: hsl(0.13, 0.5, 0.75),
            low: hsl(g, 0.6, 0.38), mid: hsl(g + 0.05, 0.5, 0.3), high: hsl(0.1, 0.2, 0.45),
            peak: hsl(0.6, 0.1, 0.9), rock: hsl(0.1, 0.15, 0.4),
            sky: hsl(0.53, 0.7, 0.7), atmo: hsl(0.53, 0.9, 0.6),
            leaf: hsl(g, 0.7, 0.35), trunk: hsl(0.08, 0.3, 0.35),
            plant: hsl(0.95, 0.6, 0.55), crystal: hsl(0.15, 1, 0.6)
        };
    } else { // exotic
        p.flora = 1.3; p.mountAmp *= 1.4; p.lifeDrain = 1.2;
        c = {
            deep: hsl(hue + 0.5, 0.6, 0.2), water: hsl(hue + 0.45, 0.8, 0.45), shore: hsl(hue + 0.1, 0.5, 0.7),
            low: hsl(hue, 0.65, 0.45), mid: hsl(hue + 0.08, 0.55, 0.35), high: hsl(hue + 0.3, 0.3, 0.35),
            peak: hsl(hue + 0.15, 0.5, 0.8), rock: hsl(hue + 0.6, 0.2, 0.3),
            sky: hsl(hue + 0.7, 0.55, 0.65), atmo: hsl(hue + 0.7, 0.9, 0.6),
            leaf: hsl(hue + 0.4, 0.75, 0.5), trunk: hsl(hue + 0.6, 0.4, 0.3),
            plant: hsl(hue + 0.2, 0.8, 0.55), crystal: hsl(hue + 0.5, 1, 0.65)
        };
    }
    p.c = c;
    p.relief = p.contAmp * 0.8 + p.mountAmp * 1.2;
    p.maxDepth = Math.max(3, Math.round(Math.log2(p.R * 1.5708 / 12)));
    p.bigDepth = Math.max(2, Math.round(Math.log2(p.R * 1.5708 / 100)));
    p.smallDepth = p.bigDepth + 2;
    return p;
}

function heightFns(p) {
    const n1 = simplex(p.seed + 11), n2 = simplex(p.seed + 23), n3 = simplex(p.seed + 37);
    const R = p.R;
    // lim: highest noise frequency the caller can sample without aliasing
    function fw(f, lim) {
        const k = f / lim;
        return k < 0.5 ? 1 : k > 1 ? 0 : (1 - k) * 2;
    }
    function raw(x, y, z, lim) {
        lim = lim || 1e9;
        // continents
        let c = 0, amp = 1, f = p.f1;
        for (let i = 0; i < 4; i++) {
            const w = fw(f, lim);
            if (w > 0) c += amp * w * n1(x * f, y * f, z * f);
            amp *= 0.5; f *= 2.03;
        }
        // ridged mountains
        let m = 0, wr = 1;
        amp = 1; f = p.f2;
        for (let i = 0; i < 5; i++) {
            const w = fw(f, lim);
            if (w <= 0) break;
            let v = 1 - Math.abs(n2(x * f, y * f, z * f));
            v *= v * wr;
            wr = Math.min(1, v * 2);
            m += amp * v * w;
            amp *= 0.5; f *= 2.1;
        }
        // small detail (meter scale for walking)
        f = R / 30;
        let d = 0;
        const w = fw(f * 2.3, lim);
        if (w > 0) d = (n3(x * f, y * f, z * f) + 0.5 * n3(x * f * 2.3, y * f * 2.3, z * f * 2.3)) * w;
        const land = Math.min(1, Math.max(0, c + 0.15));
        return c * p.contAmp + land * land * m * p.mountAmp + d * 1.6;
    }
    function height(x, y, z) {
        const h = raw(x, y, z);
        return p.hasSea && h < p.sea ? p.sea : h;
    }
    function detail(x, y, z) {
        return n3(x * 40, y * 40, z * 40);
    }
    return { raw, height, detail };
}

const _c = new THREE.Color();
function colorAt(p, h, slope, dn, out, k) {
    const c = p.c;
    if (p.hasSea && h < p.sea + 0.05) {
        // h is raw height here; deeper is darker
        const t = Math.min(1, (p.sea - h) / 60);
        _c.copy(c.water).lerp(c.deep, t);
    } else {
        const t = (h - p.sea) / p.relief;
        if (t < 0.012) _c.copy(c.shore);
        else if (t < 0.25) _c.copy(c.low).lerp(c.mid, t / 0.25);
        else if (t < 0.55) _c.copy(c.mid).lerp(c.high, (t - 0.25) / 0.3);
        else if (t < 0.7) _c.copy(c.high).lerp(c.peak, (t - 0.55) / 0.15);
        else _c.copy(c.peak);
        if (slope > 0.25) _c.lerp(c.rock, Math.min(1, (slope - 0.25) * 3));
    }
    const j = 1 + dn * 0.08;
    out[k] = _c.r * j; out[k + 1] = _c.g * j; out[k + 2] = _c.b * j;
}

// ---------- chunk mesh ----------
const _d = [0, 0, 0];
const M = N + 3;   // with 1-vertex border on each side
const _pos = new Float64Array(M * M * 3);
const _dir = new Float64Array(M * M * 3);
const _raw = new Float64Array(M * M);
let _index = null;

function chunkIndex() {
    if (_index) return _index;
    const S = N + 1;
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * S + i, b = a + 1, c = a + S + 1, d = a + S;
        idx.push(a, b, c, a, c, d);
    }
    // skirts: edge vertices duplicated after main grid
    const base = S * S;
    const edge = edgeList();
    for (let e = 0; e < edge.length - 1; e++) {
        const a = edge[e], b = edge[e + 1], sa = base + e, sb = base + e + 1;
        idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
    }
    _index = idx;
    return idx;
}

function edgeList() {
    const S = N + 1, l = [];
    for (let i = 0; i <= N; i++) l.push(i);                 // bottom
    for (let j = 1; j <= N; j++) l.push(j * S + N);         // right
    for (let i = N - 1; i >= 0; i--) l.push(N * S + i);     // top
    for (let j = N - 1; j >= 0; j--) l.push(j * S);         // left
    return l;
}
const EDGES = edgeList();

function buildChunk(pl, node) {
    const p = pl.p, R = p.R;
    const step = node.size / N;
    const lim = R / (2 * node.ws / N);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const a = node.x + (i - 1) * step, b = node.y + (j - 1) * step;
        cubeDir(node.face, a, b, _d);
        const k = j * M + i;
        const h = pl.f.raw(_d[0], _d[1], _d[2], lim);
        _raw[k] = h;
        const s = R + (p.hasSea && h < p.sea ? p.sea : h);
        _dir[k * 3] = _d[0]; _dir[k * 3 + 1] = _d[1]; _dir[k * 3 + 2] = _d[2];
        _pos[k * 3] = _d[0] * s; _pos[k * 3 + 1] = _d[1] * s; _pos[k * 3 + 2] = _d[2] * s;
    }
    const S = N + 1, nv = S * S + EDGES.length;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const mid = ((N / 2 + 1) * M + N / 2 + 1) * 3;
    const cx = _pos[mid], cy = _pos[mid + 1], cz = _pos[mid + 2];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const k = (j + 1) * M + (i + 1), o = (j * S + i) * 3;
        const kl = (k - 1) * 3, kr = (k + 1) * 3, kd = (k - M) * 3, ku = (k + M) * 3;
        const ax = _pos[kr] - _pos[kl], ay = _pos[kr + 1] - _pos[kl + 1], az = _pos[kr + 2] - _pos[kl + 2];
        const bx = _pos[ku] - _pos[kd], by = _pos[ku + 1] - _pos[kd + 1], bz = _pos[ku + 2] - _pos[kd + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        pos[o] = _pos[k * 3] - cx; pos[o + 1] = _pos[k * 3 + 1] - cy; pos[o + 2] = _pos[k * 3 + 2] - cz;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        const dx = _dir[k * 3], dy = _dir[k * 3 + 1], dz = _dir[k * 3 + 2];
        const slope = 1 - (nx * dx + ny * dy + nz * dz);
        colorAt(p, _raw[k], slope, pl.f.detail(dx, dy, dz), col, o);
    }
    const skirt = node.ws * 0.1 + 1;
    for (let e = 0; e < EDGES.length; e++) {
        const src = EDGES[e] * 3, o = (S * S + e) * 3;
        const j = Math.floor(EDGES[e] / S), i = EDGES[e] % S;
        const k = ((j + 1) * M + (i + 1)) * 3;
        pos[o] = pos[src] - _dir[k] * skirt;
        pos[o + 1] = pos[src + 1] - _dir[k + 1] * skirt;
        pos[o + 2] = pos[src + 2] - _dir[k + 2] * skirt;
        nor[o] = nor[src]; nor[o + 1] = nor[src + 1]; nor[o + 2] = nor[src + 2];
        col[o] = col[src]; col[o + 1] = col[src + 1]; col[o + 2] = col[src + 2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(chunkIndex());
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, pl.mat);
    m.position.set(cx, cy, cz);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    pl.group.add(m);
    node.mesh = m;
    pl.stats.chunks++;
}

function makeNode(pl, face, x, y, size, depth, key) {
    const n = {
        face, x, y, size, depth, key,
        ws: size * 0.5 * pl.p.R * 1.5708,
        children: null, mesh: null, dead: false, flora: null,
        cpos: new THREE.Vector3()
    };
    cubeDir(face, x + size / 2, y + size / 2, _d);
    const h = pl.f.height(_d[0], _d[1], _d[2]);
    n.cpos.set(_d[0], _d[1], _d[2]).multiplyScalar(pl.p.R + h);
    if (depth === pl.p.bigDepth) spawnFlora(pl, n, 'big');
    if (depth === pl.p.smallDepth) spawnFlora(pl, n, 'small');
    return n;
}

function split(pl, n) {
    const h = n.size / 2, d = n.depth + 1;
    n.children = [
        makeNode(pl, n.face, n.x, n.y, h, d, n.key + '0'),
        makeNode(pl, n.face, n.x + h, n.y, h, d, n.key + '1'),
        makeNode(pl, n.face, n.x, n.y + h, h, d, n.key + '2'),
        makeNode(pl, n.face, n.x + h, n.y + h, h, d, n.key + '3')
    ];
    for (const c of n.children) pl.queue.push(c);
}

function disposeNode(pl, n) {
    n.dead = true;
    if (n.children) for (const c of n.children) disposeNode(pl, c);
    n.children = null;
    if (n.mesh) {
        pl.group.remove(n.mesh);
        n.mesh.geometry.dispose();
        n.mesh = null;
        pl.stats.chunks--;
    }
    if (n.flora) freeFlora(pl, n);
}

function updateNode(pl, n, cam) {
    const d = cam.distanceTo(n.cpos);
    const can = n.depth < pl.p.maxDepth;
    let want = can && d < n.ws * SPLIT;
    if (!want && n.children && d < n.ws * SPLIT * MERGE) want = true;
    if (want) {
        if (!n.children) split(pl, n);
        let ready = true;
        for (const c of n.children) if (!c.mesh) ready = false;
        if (ready) {
            if (n.mesh) n.mesh.visible = false;
            for (const c of n.children) updateNode(pl, c, cam);
        } else {
            if (n.mesh) n.mesh.visible = true;
            for (const c of n.children) hideTree(c);
        }
    } else {
        if (n.children) {
            for (const c of n.children) disposeNode(pl, c);
            n.children = null;
        }
        if (n.mesh) n.mesh.visible = true;
    }
}

function hideTree(n) {
    if (n.mesh) n.mesh.visible = false;
    if (n.children) for (const c of n.children) hideTree(c);
}

// ---------- flora ----------
function mergeColored(parts) {
    // parts: [geometry, THREE.Color]
    const ps = [], ns = [], cs = [];
    for (const [g0, c] of parts) {
        const g = g0.index ? g0.toNonIndexed() : g0;
        g.computeVertexNormals();
        const p = g.attributes.position.array, n = g.attributes.normal.array;
        for (let i = 0; i < p.length; i += 3) {
            ps.push(p[i], p[i + 1], p[i + 2]);
            ns.push(n[i], n[i + 1], n[i + 2]);
            cs.push(c.r, c.g, c.b);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
    g.computeBoundingSphere();
    return g;
}

function treeGeo(p) {
    const c = p.c, s = p.treeStyle;
    const trunk = new THREE.CylinderGeometry(0.25, 0.45, 4, 5).translate(0, 2, 0);
    if (s === 0) { // pine
        return mergeColored([
            [trunk, c.trunk],
            [new THREE.ConeGeometry(2.6, 5, 7).translate(0, 5, 0), c.leaf],
            [new THREE.ConeGeometry(2, 4, 7).translate(0, 7.5, 0), c.leaf]
        ]);
    }
    if (s === 1) { // blob
        return mergeColored([
            [trunk, c.trunk],
            [new THREE.IcosahedronGeometry(2.8, 0).translate(0, 5.5, 0), c.leaf],
            [new THREE.IcosahedronGeometry(1.8, 0).translate(1.4, 4.5, 0.6), c.leaf]
        ]);
    }
    if (s === 2) { // mushroom
        return mergeColored([
            [new THREE.CylinderGeometry(0.5, 0.8, 6, 6).translate(0, 3, 0), c.trunk],
            [new THREE.SphereGeometry(3.5, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 5.8, 0), c.leaf],
            [new THREE.CylinderGeometry(3.4, 3.4, 0.4, 9).translate(0, 5.8, 0), c.plant]
        ]);
    }
    // spikes
    return mergeColored([
        [new THREE.ConeGeometry(0.9, 9, 5).translate(0, 4.5, 0), c.leaf],
        [new THREE.ConeGeometry(0.5, 5, 5).rotateZ(0.5).translate(1.2, 3, 0), c.leaf],
        [new THREE.ConeGeometry(0.5, 4, 5).rotateZ(-0.6).translate(-1, 2.5, 0.3), c.plant]
    ]);
}

function makePools(pl) {
    const p = pl.p, c = p.c;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const emat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: c.crystal, emissiveIntensity: 0.6 });
    const defs = {
        tree: [treeGeo(p), mat, 2500],
        rock: [mergeColored([[new THREE.DodecahedronGeometry(1.6, 0).scale(1.3, 0.8, 1), c.rock]]), mat, 800],
        plant: [mergeColored([
            [new THREE.ConeGeometry(0.5, 1.4, 5).translate(0, 0.7, 0), c.plant],
            [new THREE.ConeGeometry(0.35, 1.1, 5).rotateZ(0.6).translate(0.4, 0.5, 0), c.plant],
            [new THREE.ConeGeometry(0.35, 1.0, 5).rotateZ(-0.6).translate(-0.4, 0.5, 0.2), c.plant],
            [new THREE.SphereGeometry(0.22, 6, 4).translate(0, 1.45, 0), c.crystal]
        ]), mat, 2500],
        crystal: [mergeColored([
            [new THREE.OctahedronGeometry(0.6, 0).scale(0.6, 2.2, 0.6).translate(0, 1, 0), c.crystal],
            [new THREE.OctahedronGeometry(0.45, 0).scale(0.6, 2, 0.6).rotateZ(0.5).translate(0.5, 0.7, 0), c.crystal],
            [new THREE.OctahedronGeometry(0.4, 0).scale(0.6, 1.8, 0.6).rotateX(-0.5).translate(0, 0.6, 0.5), c.crystal]
        ]), emat, 600],
        pebble: [mergeColored([[new THREE.IcosahedronGeometry(0.5, 0).scale(1.2, 0.6, 1), c.rock]]), mat, 2500]
    };
    pl.pools = {};
    for (const k in defs) {
        const [g, m, cap] = defs[k];
        const im = new THREE.InstancedMesh(g, m, cap);
        im.count = 0;
        im.frustumCulled = false;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.setColorAt(0, new THREE.Color(1, 1, 1));
        pl.group.add(im);
        pl.pools[k] = { im, cap, free: [], used: 0 };
    }
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();

function poolAlloc(pool) {
    if (pool.free.length) return pool.free.pop();
    if (pool.used >= pool.cap) return -1;
    const i = pool.used++;
    pool.im.count = pool.used;
    return i;
}

function poolFree(pool, i) {
    pool.im.setMatrixAt(i, _zero);
    pool.im.instanceMatrix.needsUpdate = true;
    pool.free.push(i);
}

export const YIELD = {
    tree: { res: 'carbon', amt: 30, hp: 3, r: 1.6, h: 5 },
    plant: { res: 'carbon', amt: 12, hp: 1, r: 0.9, h: 0.8 },
    rock: { res: 'ferrite', amt: 25, hp: 2.5, r: 2, h: 0.8 },
    pebble: { res: 'ferrite', amt: 6, hp: 0.6, r: 0.7, h: 0.3 },
    crystal: { res: 'dihydrogen', amt: 20, hp: 1.5, r: 1, h: 1 }
};

function spawnFlora(pl, node, kind) {
    const p = pl.p;
    if (!pl.pools) makePools(pl);
    const r = rng(hash(p.seed + ':' + node.key + kind));
    const area = node.ws * node.ws;
    const dens = kind === 'big' ? 0.0035 * p.flora : 0.02 * Math.max(0.35, p.flora);
    const count = Math.min(200, Math.round(area * dens));
    const items = [];
    for (let k = 0; k < count; k++) {
        const a = node.x + r() * node.size, b = node.y + r() * node.size;
        const roll = r(), sc = 0.7 + r() * 0.7, rot = r() * 6.283;
        cubeDir(node.face, a, b, _d);
        const h = pl.f.raw(_d[0], _d[1], _d[2]);
        if (p.hasSea && h < p.sea + 0.5) continue;
        const t = (h - p.sea) / p.relief;
        if (t > 0.6) continue;
        const mask = pl.f.detail(_d[0] * 0.2, _d[1] * 0.2, _d[2] * 0.2);
        let type;
        if (kind === 'big') {
            if (roll < 0.7) { if (mask < -0.15) continue; type = 'tree'; }
            else type = 'rock';
        } else {
            if (roll < 0.45) type = 'plant';
            else if (roll < 0.8) type = 'pebble';
            else if (roll < 0.9) type = 'crystal';
            else continue;
        }
        const key = node.key + kind + k;
        if (pl.mined.has(key)) continue;
        const pool = pl.pools[type];
        const idx = poolAlloc(pool);
        if (idx < 0) continue;
        _v.set(_d[0], _d[1], _d[2]);
        _q.setFromUnitVectors(_Y, _v);
        _q2.setFromAxisAngle(_Y, rot);
        _q.multiply(_q2);
        const s = type === 'tree' ? sc * (0.9 + p.flora * 0.3) : sc;
        _s.set(s, s, s);
        const pos = _v.clone().multiplyScalar(p.R + h - 0.15);
        _m4.compose(pos, _q, _s);
        pool.im.setMatrixAt(idx, _m4);
        _col.setRGB(0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.85 + r() * 0.3);
        pool.im.setColorAt(idx, _col);
        const y = YIELD[type];
        const it = { key, type, pool, idx, pos, up: _v.clone(), r: y.r * s, hp: y.hp, hpMax: y.hp, s, h: y.h * s };
        items.push(it);
        pl.items.set(key, it);
    }
    for (const k in pl.pools) {
        pl.pools[k].im.instanceMatrix.needsUpdate = true;
        if (pl.pools[k].im.instanceColor) pl.pools[k].im.instanceColor.needsUpdate = true;
    }
    node.flora = items;
}

function freeFlora(pl, node) {
    for (const it of node.flora) {
        if (pl.items.get(it.key) === it) {
            poolFree(it.pool, it.idx);
            pl.items.delete(it.key);
        }
    }
    node.flora = null;
}

export function removeItem(pl, it) {
    if (pl.items.get(it.key) !== it) return;
    poolFree(it.pool, it.idx);
    pl.items.delete(it.key);
    pl.mined.add(it.key);
}

export function shrinkItem(it, frac) {
    // visual feedback while mining
    const s = it.s * Math.max(0.3, frac);
    _q.setFromUnitVectors(_Y, it.up);
    _s.set(s, s, s);
    _m4.compose(it.pos, _q, _s);
    it.pool.im.setMatrixAt(it.idx, _m4);
    it.pool.im.instanceMatrix.needsUpdate = true;
}

// ---------- atmosphere ----------
function atmoMesh(p) {
    const mat = new THREE.ShaderMaterial({
        uniforms: { color: { value: p.c.atmo.clone() }, sunPos: { value: new THREE.Vector3() } },
        vertexShader: `
            varying vec3 vN; varying vec3 vV; varying vec3 vW;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vW = wp.xyz;
                vN = normalize(mat3(modelMatrix) * normal);
                vV = normalize(cameraPosition - wp.xyz);
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            uniform vec3 color; uniform vec3 sunPos;
            varying vec3 vN; varying vec3 vV; varying vec3 vW;
            void main() {
                float f = 1.0 - max(dot(vN, vV), 0.0);
                float rim = pow(f, 2.5);
                float lit = clamp(dot(vN, normalize(sunPos - vW)) * 0.8 + 0.35, 0.0, 1.0);
                gl_FragColor = vec4(color * rim * lit * 1.4, 1.0);
            }`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(p.R * 1.1, 64, 32), mat);
    m.renderOrder = 2;
    return m;
}

// ---------- public ----------
export function makePlanet(seed, center, forceType) {
    const p = makeParams(seed, forceType);
    const pl = {
        p, seed, name: p.name, center: center.clone(),
        group: new THREE.Group(),
        f: heightFns(p),
        mat: new THREE.MeshLambertMaterial({ vertexColors: true }),
        roots: [], queue: [], items: new Map(), mined: new Set(),
        pools: null, stats: { chunks: 0 }, visited: false
    };
    pl.group.position.copy(center);
    for (let f = 0; f < 6; f++) {
        const n = makeNode(pl, f, -1, -1, 2, 0, 'f' + f);
        buildChunk(pl, n);
        pl.roots.push(n);
    }
    pl.atmo = atmoMesh(p);
    pl.group.add(pl.atmo);
    return pl;
}

const _cam = new THREE.Vector3();
export function updatePlanet(pl, camWorld, budget) {
    _cam.copy(camWorld).sub(pl.center);
    const dist = _cam.length();
    if (dist < pl.p.R * 8) {
        for (const n of pl.roots) updateNode(pl, n, _cam);
    } else if (pl.roots.some(n => n.children)) {
        for (const n of pl.roots) updateNode(pl, n, _cam);
    }
    // build queued chunks, most needed first
    let built = 0;
    while (built < budget && pl.queue.length) {
        let best = -1, bs = Infinity;
        for (let i = 0; i < pl.queue.length; i++) {
            const n = pl.queue[i];
            if (n.dead) { pl.queue.splice(i, 1); i--; continue; }
            const s = _cam.distanceTo(n.cpos) / n.ws;
            if (s < bs) { bs = s; best = i; }
        }
        if (best < 0) break;
        const n = pl.queue.splice(best, 1)[0];
        buildChunk(pl, n);
        n.mesh.visible = false;
        built++;
    }
    pl.atmo.visible = dist > pl.p.R * 1.1;
    return built;
}

export function disposePlanet(pl) {
    for (const n of pl.roots) disposeNode(pl, n);
    if (pl.pools) for (const k in pl.pools) {
        pl.pools[k].im.geometry.dispose();
        pl.pools[k].im.dispose();
    }
    pl.atmo.geometry.dispose();
    pl.atmo.material.dispose();
    pl.mat.dispose();
    pl.group.removeFromParent();
}

// surface height (meters above R) for a world position
const _u = new THREE.Vector3();
export function groundAt(pl, worldPos) {
    _u.copy(worldPos).sub(pl.center).normalize();
    return pl.f.height(_u.x, _u.y, _u.z);
}

export function altitude(pl, worldPos) {
    _u.copy(worldPos).sub(pl.center);
    const r = _u.length();
    _u.divideScalar(r);
    return r - pl.p.R - pl.f.height(_u.x, _u.y, _u.z);
}
