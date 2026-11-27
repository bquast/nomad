// main.js - Nomad: game state, on-foot and ship logic, VR setup, main loop
import * as THREE from './three.module.js';
import { makeSystem, disposeSystem, nearestPlanet, makeShip, killAsteroid, systemSeed, makeStreaks, updateStreaks } from './world.js';
import { updatePlanet, altitude, altitudeRaw, removeItem, shrinkItem, YIELD } from './planet.js';
import { SHARED, skyColor, sunTrans, patchTint } from './atmosphere.js';
import { makeSea, updateSea } from './water.js';
import { makeCockpit, drawCockpit } from './cockpit.js';
import { makeFauna, updateFauna, creaturesNear, speciesFor } from './fauna.js';
import { makeHud, drawHud, hudHit, HUD_W, HUD_H } from './hud.js';
import { makeInput, readDesktop, readXR, endFrame } from './input.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0);
scene.fog = new THREE.FogExp2(0x000000, 0);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400000);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);
addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

const V = () => new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v1 = V(), _v2 = V(), _v3 = V(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();

// ---------- game state ----------
const G = {
    mode: 'ship', sysN: 0, sys: null, pl: null,
    inv: { carbon: 40, ferrite: 20, dihydrogen: 40, cells: 1, units: 0 },
    life: 1, jet: 1, fuel: 1,
    foot: { pos: V(), vel: V(), q: new THREE.Quaternion(), pitch: 0, onGround: false },
    ship: null,
    opts: { vignette: true, snap: true, assist: true, hand: true, third: false, frame: 'sides' },
    under: false, swim: false, eyeY: 1.25,
    menu: false, sel: 0, msgs: [], scanT: 0, warpT: 0, warped: false,
    species: new Set(), planets: new Set(),
    vr: false, vig: 0, hudT: 0, saveT: 30, fireT: 0, warnT: 0, time: 0
};

const input = makeInput(renderer.domElement);
const fauna = makeFauna(scene);
const hud = makeHud();
document.body.appendChild(hud.canvas);

// ---------- ship ----------
const shipModel = makeShip();
shipModel.group.traverse(o => { if (o.material && o.material.type === 'MeshLambertMaterial' && !o.material.transparent) patchTint(o.material); });
scene.add(shipModel.group);
const headlamp = new THREE.SpotLight(0xdff6ff, 0, 110, 0.55, 0.6, 1);
headlamp.position.set(0, 0, -5);
headlamp.target.position.set(0, -6, -40);
shipModel.group.add(headlamp, headlamp.target);
const cockpit = makeCockpit();
const avatar = makeAvatar();
scene.add(avatar.group);

// simple astronaut for the third-person view
function makeAvatar() {
    const g = new THREE.Group();
    const suit = patchTint(new THREE.MeshLambertMaterial({ color: 0xe9e6df })), dark = patchTint(new THREE.MeshLambertMaterial({ color: 0x30343b }));
    const accent = patchTint(new THREE.MeshLambertMaterial({ color: 0xe8742a }));
    const visor = new THREE.MeshLambertMaterial({ color: 0x1b2a3a, emissive: 0x3a6a90, emissiveIntensity: 0.35 });
    const add = (geo, mat, x, y, z, parent) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); (parent || g).add(o); return o; };
    add(new THREE.CapsuleGeometry(0.24, 0.45, 4, 10), suit, 0, 1.12, 0);
    add(new THREE.SphereGeometry(0.2, 14, 10), suit, 0, 1.62, 0);
    add(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.75, 0.6), visor, 0, 1.64, -0.12);
    add(new THREE.BoxGeometry(0.36, 0.48, 0.2), dark, 0, 1.18, 0.26);
    add(new THREE.BoxGeometry(0.5, 0.06, 0.3), accent, 0, 1.36, 0.02);
    const limb = (x, y, len, r) => {
        const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot);
        add(new THREE.CapsuleGeometry(r, len, 4, 8), suit, 0, -len / 2 - r, 0, pivot);
        return pivot;
    };
    const legL = limb(-0.12, 0.78, 0.5, 0.09), legR = limb(0.12, 0.78, 0.5, 0.09);
    const armL = limb(-0.33, 1.38, 0.42, 0.07), armR = limb(0.33, 1.38, 0.42, 0.07);
    g.visible = false;
    return { group: g, legL, legR, armL, armR, phase: 0, face: new THREE.Quaternion() };
}

function updateAvatar(dt) {
    const show = G.mode === 'foot' && G.opts.third;
    avatar.group.visible = show;
    if (!show) return;
    const F = G.foot, pl = G.pl;
    const up = upAt(pl, F.pos, V());
    const v = F.vel.clone().addScaledVector(up, -F.vel.dot(up));
    const sp = v.length();
    // face the walking direction, or the view direction when standing
    const fw = sp > 0.4 ? v : _v1.set(0, 0, -1).applyQuaternion(F.q);
    basisQ(up, fw, _q2);
    avatar.face.slerp(_q2, Math.min(1, dt * 8));
    avatar.group.position.copy(F.pos);
    avatar.group.quaternion.copy(avatar.face);
    avatar.phase += dt * sp * 2.2;
    const sw = Math.sin(avatar.phase) * Math.min(0.7, sp * 0.12) * (G.swim ? 0.4 : 1);
    avatar.legL.rotation.x = sw; avatar.legR.rotation.x = -sw;
    avatar.armL.rotation.x = -sw * 0.8; avatar.armR.rotation.x = sw * 0.8;
    if (G.swim) avatar.group.quaternion.multiply(_q1.setFromAxisAngle(X, -1.2));
}

function toggleView() {
    G.opts.third = !G.opts.third;
    msg(G.opts.third ? 'Third-person view' : 'First-person view');
    G.hudT = 0;
}
rig.add(cockpit.group);
const sea = makeSea(scene);
const streaks = makeStreaks(scene);
G.ship = { m: shipModel, pos: V(), q: new THREE.Quaternion(), speed: 0, landed: true, landing: null, lift: 0, pulse: false };

// ---------- effects ----------
function beam(color, r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    return m;
}
const footBeam = beam(0xffa040, 0.025);
const shipBeams = [beam(0x60ffd0, 0.08), beam(0x60ffd0, 0.08)];
const hitGlow = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
hitGlow.visible = false;
scene.add(hitGlow);

const scanSphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x80e0ff, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
scanSphere.visible = false;
scene.add(scanSphere);

// camera-locked comfort vignette and warp fade
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.ShaderMaterial({
    uniforms: { k: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float k; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(0.75 - k * 0.45, 1.0 - k * 0.35, d) * min(1.0, k * 1.6); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }',
    transparent: true, depthTest: false, depthWrite: false
}));
vignette.position.z = -0.35;
vignette.renderOrder = 1000;
vignette.visible = false;
camera.add(vignette);
const fade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
fade.renderOrder = 1001;
fade.visible = false;
camera.add(fade);

// scan markers
const ICONS = { crystal: ['H', '#5fe8ff'], rock: ['Fe', '#ff9f5a'], pebble: ['Fe', '#ff9f5a'], coral: ['Fe', '#ff9f5a'], plant: ['C', '#8cff7a'], kelp: ['C', '#8cff7a'], tree: ['C', '#8cff7a'], fauna: ['?', '#ffe36a'] };
const iconMats = {};
for (const k in ICONS) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.strokeStyle = ICONS[k][1]; x.lineWidth = 5;
    x.beginPath(); x.arc(32, 32, 26, 0, 7); x.stroke();
    x.fillStyle = ICONS[k][1]; x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.fillText(ICONS[k][0], 32, 42);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    iconMats[k] = new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, fog: false, transparent: true });
}
const markers = [];
for (let i = 0; i < 30; i++) {
    const s = new THREE.Sprite(iconMats.crystal);
    s.visible = false;
    s.renderOrder = 998;
    scene.add(s);
    markers.push({ s, it: null, cr: null });
}

// ---------- helpers ----------
function msg(text) {
    G.msgs.unshift({ text, t: 6 });
    if (G.msgs.length > 7) G.msgs.pop();
}

function eyePos(out) { return camera.getWorldPosition(out); }
function eyeDir(out) { return camera.getWorldDirection(out); }

function upAt(pl, pos, out) { return out.copy(pos).sub(pl.center).normalize(); }

function basisQ(up, fwd, out) {
    // quaternion with local +Y = up and local -Z = fwd (fwd is projected onto the tangent plane)
    const f = _v3.copy(fwd).addScaledVector(up, -fwd.dot(up));
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0).addScaledVector(up, -up.x);
    f.normalize();
    const z = f.clone().negate(), x = V().crossVectors(up, z);
    _m1.makeBasis(x, up, z);
    return out.setFromRotationMatrix(_m1);
}

function findLand(pl, seed, sun) {
    let s = seed;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const p = pl.p, d = V(), e = V(), f = V();
    let best = null, bs = Infinity;
    for (let i = 0; i < 1500; i++) {
        d.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
        const h = pl.f.raw(d.x, d.y, d.z);
        if (p.hasSea && h < p.sea + 3) continue;
        const t = (h - p.sea) / p.relief;
        if (t > 0.35) continue;
        e.set(1, 0, 0).cross(d).normalize();
        f.crossVectors(d, e);
        const k = 4 / p.R;
        const ha = pl.f.height(d.x + e.x * k, d.y + e.y * k, d.z + e.z * k);
        const hb = pl.f.height(d.x + f.x * k, d.y + f.y * k, d.z + f.z * k);
        const slope = Math.abs(ha - h) + Math.abs(hb - h);
        const score = slope + (sun ? (1 - d.dot(sun)) * 3 : 0) + t * 2;
        if (score < bs) { bs = score; best = d.clone(); }
    }
    return best || new THREE.Vector3(0, 1, 0);
}

function refine(pl, maxBuilds) {
    const eye = eyePos(V());
    let n = 0;
    for (let i = 0; i < 60 && n < maxBuilds; i++) {
        const b = updatePlanet(pl, eye, 40, G.time);
        n += b;
        if (b === 0 && pl.queue.length === 0) break;
    }
}

function setCurrentPlanet(pl) {
    if (G.pl === pl) return;
    G.pl = pl;
}

// ---------- system / spawn ----------
function loadSystem(n) {
    if (G.sys) disposeSystem(G.sys);
    G.sysN = n;
    G.sys = makeSystem(scene, systemSeed(n), n === 0);
    scene.background = G.sys.nebula;
    G.pl = null;
    setCurrentPlanet(G.sys.planets[0]);
}

function landShipAt(pl, dir) {
    const S = G.ship;
    const h = pl.f.height(dir.x, dir.y, dir.z);
    S.pos.copy(dir).multiplyScalar(pl.p.R + h + S.m.gearH).add(pl.center);
    basisQ(dir, V().set(dir.y, -dir.x, 0.3).normalize(), S.q);
    S.landed = true; S.landing = null; S.speed = 0; S.lift = 0;
}

function exitShip() {
    const S = G.ship, pl = G.pl;
    const up = upAt(pl, S.pos, V());
    const right = X.clone().applyQuaternion(S.q);
    const F = G.foot;
    F.pos.copy(S.pos).addScaledVector(right, 6.5);
    const h = pl.f.height(...upAt(pl, F.pos, _v1).toArray());
    F.pos.copy(_v1).multiplyScalar(pl.p.R + h).add(pl.center);
    basisQ(_v1, V().set(0, 0, -1).applyQuaternion(S.q), F.q);
    F.vel.set(0, 0, 0);
    F.pitch = 0;
    G.mode = 'foot';
    msg('On foot. Mine with the laser, scan to find resources.');
}

function newGame() {
    loadSystem(G.sysN);
    const pl = G.sys.planets[0];
    landShipAt(pl, findLand(pl, 12345 + G.sysN, G.sys.sunPos.clone().sub(pl.center).normalize()));
    exitShip();
    placeRig();
    refine(pl, 400);
}

// ---------- save ----------
function save() {
    try {
        localStorage.setItem('nomad-save', JSON.stringify({
            v: 1, sysN: G.sysN, inv: G.inv, life: G.life, fuel: G.fuel, opts: G.opts,
            species: [...G.species], planets: [...G.planets]
        }));
        return true;
    } catch (e) { return false; }
}

function load() {
    try {
        const s = JSON.parse(localStorage.getItem('nomad-save') || 'null');
        if (!s || s.v !== 1) return false;
        G.sysN = s.sysN; Object.assign(G.inv, s.inv); G.life = s.life; G.fuel = s.fuel;
        Object.assign(G.opts, s.opts);
        G.species = new Set(s.species); G.planets = new Set(s.planets);
        return true;
    } catch (e) { return false; }
}

// ---------- rig placement ----------
function placeRig() {
    const pl = G.pl;
    if (G.mode === 'foot') {
        const F = G.foot;
        if (G.opts.third) {
            // behind and above the astronaut, rig keeps the planet's up
            const back = _v1.set(0, 0, 1).applyQuaternion(F.q);
            const up = upAt(pl, F.pos, _v2);
            rig.position.copy(F.pos).addScaledVector(back, 4.2).addScaledVector(up, G.vr ? 0.9 : 1.2);
            const a = altitudeRaw(pl, rig.position);
            if (a < 0.6) rig.position.addScaledVector(up, 0.6 - a);
            rig.quaternion.copy(F.q);
            if (!G.vr) { camera.position.set(0, 1.7, 0); camera.rotation.set(F.pitch - 0.2, 0, 0); }
        } else {
            rig.position.copy(F.pos);
            rig.quaternion.copy(F.q);
            if (!G.vr) { camera.position.set(0, 1.7, 0); camera.rotation.set(F.pitch, 0, 0); }
        }
    } else {
        const S = G.ship;
        if (!G.opts.third) {
            rig.position.copy(S.m.seat).applyQuaternion(S.q).add(S.pos);
            rig.quaternion.copy(S.q);
            if (!G.vr) { camera.position.set(0, G.eyeY, 0); camera.rotation.set(0, 0, 0); }
        } else if (G.vr) {
            // level chase view for VR: follows the heading only, so the horizon stays still
            const up = upAt(pl, S.pos, _v2);
            const lvl = (S.air || 0) > 0.15 ? up : _v3.set(0, 1, 0).applyQuaternion(S.q);
            const fw = _v1.set(0, 0, -1).applyQuaternion(S.q);
            basisQ(lvl, fw, rig.quaternion);
            const back = _v1.set(0, 0, 1).applyQuaternion(rig.quaternion);
            rig.position.copy(S.pos).addScaledVector(back, 16).addScaledVector(lvl, 2.2);
            const a = altitude(pl, rig.position);
            if (a < 1) rig.position.addScaledVector(up, 1 - a);
        } else {
            rig.position.set(0, 4.2, 17).applyQuaternion(S.q).add(S.pos);
            rig.quaternion.copy(S.q).multiply(_q1.setFromAxisAngle(X, -0.1));
            camera.position.set(0, 0, 0);
            camera.rotation.set(0, 0, 0);
            const a = altitude(pl, rig.position);
            if (a < 1.5) rig.position.addScaledVector(upAt(pl, rig.position, _v1), 1.5 - a);
        }
    }
}

// ---------- rays ----------
function rayItems(pl, o, d, maxT) {
    let best = null, bt = maxT;
    const cx0 = pl.center.x, cy0 = pl.center.y, cz0 = pl.center.z;
    for (const it of pl.items.values()) {
        const k = it.h * 0.5;
        const vx = cx0 + it.pos.x + it.up.x * k - o.x, vy = cy0 + it.pos.y + it.up.y * k - o.y, vz = cz0 + it.pos.z + it.up.z * k - o.z;
        const t = vx * d.x + vy * d.y + vz * d.z;
        if (t < 0 || t > bt) continue;
        const d2 = vx * vx + vy * vy + vz * vz - t * t;
        const r = Math.max(it.r, 0.8);
        if (d2 < r * r) { bt = t; best = it; }
    }
    return [best, bt];
}

function rayTerrain(pl, o, d, maxT, step, raw) {
    for (let t = step; t < maxT; t += step) {
        _v2.copy(o).addScaledVector(d, t);
        if ((raw ? altitudeRaw(pl, _v2) : altitude(pl, _v2)) < 0) return t;
    }
    return maxT;
}

function aimBeam(m, from, to) {
    m.visible = true;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(1, 1, Math.max(0.01, from.distanceTo(to)));
}

// ---------- on foot ----------
function updateFoot(I, dt) {
    const F = G.foot, pl = G.pl, p = pl.p;
    const up = upAt(pl, F.pos, V());
    // keep rig upright as we move around the sphere
    const rigUp = _v1.copy(Y).applyQuaternion(F.q);
    _q1.setFromUnitVectors(rigUp, up);
    F.q.premultiply(_q1);
    // turning
    let yaw = 0;
    if (!G.vr) {
        if (!G.menu) {
            yaw -= I.lookX;
            F.pitch = Math.max(-1.45, Math.min(1.45, F.pitch - I.lookY));
        }
    } else {
        yaw -= I.snap * Math.PI / 6;
        yaw -= I.turn * 2.2 * dt;
    }
    if (yaw) F.q.multiply(_q1.setFromAxisAngle(Y, yaw)).normalize();
    // move
    const fwd = eyeDir(V());
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1).applyQuaternion(F.q);
    fwd.normalize();
    const right = V().crossVectors(fwd, up);
    const raw = pl.f.raw(up.x, up.y, up.z);
    const seaR = p.R + p.sea;
    const depthFeet = p.hasSea ? seaR - F.pos.distanceTo(pl.center) : -1;
    G.swim = p.hasSea && depthFeet > 1.2 && raw < p.sea - 1.3;
    let tan;
    if (G.swim) {
        const look = eyeDir(V());
        const tgt = V().addScaledVector(look, I.my).addScaledVector(right, I.mx);
        if (tgt.lengthSq() > 1) tgt.normalize();
        tgt.multiplyScalar(I.sprint ? 6 : 3.5);
        if (I.jet) tgt.addScaledVector(up, 3);
        // float at the surface unless diving
        if (tgt.dot(up) > -0.4 && depthFeet < 2.6) tgt.addScaledVector(up, (depthFeet - 1.55) * 2.5);
        else tgt.addScaledVector(up, -0.2);
        F.vel.lerp(tgt, Math.min(1, dt * 3));
        F.pos.addScaledVector(F.vel, dt);
        const d2 = seaR - F.pos.distanceTo(pl.center);
        if (d2 < 1.45) F.pos.copy(upAt(pl, F.pos, _v1)).multiplyScalar(seaR - 1.45).add(pl.center);
        tan = F.vel.clone();
        G.jet = Math.min(1, G.jet + dt * 0.5);
    } else {
        let speed = I.sprint ? 9 : 5;
        if (depthFeet > 0.3) speed *= 0.55;
        const tgt = V().addScaledVector(fwd, I.my).addScaledVector(right, I.mx);
        if (tgt.lengthSq() > 1) tgt.normalize();
        tgt.multiplyScalar(speed);
        let vr = F.vel.dot(up);
        tan = F.vel.clone().addScaledVector(up, -vr);
        tan.lerp(tgt, Math.min(1, dt * (F.onGround ? 10 : 1.5)));
        vr -= p.gravity * (depthFeet > 0.5 ? 0.4 : 1) * dt;
        if (I.jet && G.jet > 0) {
            vr += (p.gravity + 9) * dt;
            G.jet = Math.max(0, G.jet - dt * 0.33);
            if (I.my > 0) tan.addScaledVector(fwd, 6 * dt);
        } else if (F.onGround) G.jet = Math.min(1, G.jet + dt * 0.5);
        F.vel.copy(tan).addScaledVector(up, vr);
        F.pos.addScaledVector(F.vel, dt);
    }
    // push out of trees and rocks
    const lx = F.pos.x - pl.center.x, ly = F.pos.y - pl.center.y, lz = F.pos.z - pl.center.z;
    for (const it of pl.items.values()) {
        if (it.type !== 'tree' && it.type !== 'rock') continue;
        const dx = lx - it.pos.x, dy = ly - it.pos.y, dz = lz - it.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r = (it.type === 'tree' ? 0.5 * it.s : it.r * 0.9) + 0.35;
        if (d2 < r * r && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const radial = dx * up.x + dy * up.y + dz * up.z;
            if (it.type === 'tree' || radial < it.h * 1.2) {
                F.pos.x += dx / d * (r - d); F.pos.y += dy / d * (r - d); F.pos.z += dz / d * (r - d);
            }
        }
    }
    // ground
    const nu = upAt(pl, F.pos, V());
    const dist = F.pos.distanceTo(pl.center);
    const gr = pl.f.raw(nu.x, nu.y, nu.z);
    F.onGround = false;
    if (dist - p.R <= gr + 0.01) {
        F.pos.copy(nu).multiplyScalar(p.R + gr).add(pl.center);
        const v2 = F.vel.dot(nu);
        if (v2 < 0) F.vel.addScaledVector(nu, -v2);
        F.onGround = true;
    }
    if (!G.planets.has(pl.name)) {
        G.planets.add(pl.name); G.inv.units += 1000;
        msg('Planet discovered: ' + pl.name + ' (+1000 units)');
    }
    // life support
    G.life = Math.max(0, G.life - dt / (300 / p.lifeDrain) * (G.under ? 4 : 1));
    if (G.life < 0.2 && G.warnT <= 0) { msg(G.under ? 'Oxygen low: swim up or recharge with Carbon' : 'Life support low: recharge with Carbon (menu)'); G.warnT = 20; }
    if (G.life <= 0) {
        msg('Life support failed. You wake up at your ship.');
        G.life = 0.5;
        for (const k of ['carbon', 'ferrite', 'dihydrogen']) G.inv[k] = Math.floor(G.inv[k] * 0.7);
        G.mode = 'ship';
        exitShip();
    }
    // mining laser
    const o = V(), d = V();
    aimRay(o, d);
    footBeam.visible = false;
    hitGlow.visible = false;
    if (I.fire && !G.pointerOnHud && !G.menuBlock) {
        const [it, t] = rayItems(pl, o, d, 35);
        const tt = it ? t : rayTerrain(pl, o, d, 35, 0.75, true);
        const end = o.clone().addScaledVector(d, tt);
        const from = o.clone().addScaledVector(d, 0.4);
        if (!G.vr) from.addScaledVector(V().crossVectors(d, up).normalize(), 0.25).addScaledVector(up, -0.25);
        aimBeam(footBeam, from, end);
        if (tt < 35) { hitGlow.visible = true; hitGlow.position.copy(end); hitGlow.scale.setScalar(1 + Math.random() * 0.6); }
        if (it) {
            it.hp -= dt;
            shrinkItem(it, it.hp / it.hpMax);
            if (it.hp <= 0) {
                const y = YIELD[it.type];
                const amt = Math.max(1, Math.round(y.amt * it.s));
                G.inv[y.res] += amt;
                removeItem(pl, it);
                msg('+' + amt + ' ' + resName(y.res));
            }
        }
    }
    // interact
    const nearShip = F.pos.distanceTo(G.ship.pos) < 9;
    G.prompt = nearShip ? (G.vr ? '[B] Board ship' : '[E] Board ship') : '';
    if (I.interactP && nearShip) {
        G.mode = 'ship';
        msg(G.fuel >= 0.25 ? 'Throttle up to take off.' : 'Launch thruster empty: refuel with Di-hydrogen (menu).');
    }
    return { moving: tan.length() > 0.5, turn: Math.abs(I.turn) };
}

function resName(k) {
    return { carbon: 'Carbon', ferrite: 'Ferrite', dihydrogen: 'Di-hydrogen' }[k];
}

function aimRay(o, d) {
    if (G.vr && G.ctrl.right) {
        G.ctrl.right.getWorldPosition(o);
        d.set(0, 0, -1).applyQuaternion(G.ctrl.right.getWorldQuaternion(_q2));
    } else {
        eyePos(o);
        eyeDir(d);
    }
}

// ---------- ship ----------
function updateShip(I, dt) {
    const S = G.ship;
    const pl = nearestPlanet(G.sys, S.pos);
    setCurrentPlanet(pl);
    const p = pl.p;
    const up = upAt(pl, S.pos, V());
    const dist = S.pos.distanceTo(pl.center);
    const inAtmo = dist < p.R * 1.3;
    // Superformula Flight: 'air' fades over a tall atmosphere, H = 0.45 R
    const H = p.R * 0.45, seaAlt = dist - p.R - p.sea;
    const air = 1 - THREE.MathUtils.smoothstep(seaAlt, 0.05 * H, H);
    const immersion = p.hasSea ? THREE.MathUtils.smoothstep(-seaAlt, 0, 3) : 0;
    S.air = air; S.under = immersion > 0.5;
    let ang = 0;
    G.prompt = '';
    if (S.landing) {
        const L = S.landing;
        L.t = Math.min(1, L.t + dt / 2.2);
        const e = L.t * L.t * (3 - 2 * L.t);
        S.pos.lerpVectors(L.p0, L.p1, e);
        S.q.slerpQuaternions(L.q0, L.q1, e);
        if (L.t >= 1) {
            S.landing = null; S.landed = true; S.speed = 0;
            if (!G.planets.has(pl.name)) {
                G.planets.add(pl.name); G.inv.units += 1000;
                msg('Planet discovered: ' + pl.name + ' (+1000 units)');
            }
            msg('Landed. ' + (G.vr ? '[B]' : '[E]') + ' to exit.');
        }
    } else if (S.landed) {
        G.prompt = (G.vr ? '[B] Exit   [Trigger L] Take off' : '[E] Exit   [W] Take off');
        if (I.interactP) { exitShip(); return { ang: 0 }; }
        if (I.throttle > 0.3) {
            if (G.fuel >= 0.25) {
                G.fuel -= 0.25; S.landed = false; S.lift = 2.5; S.speed = 0;
                msg('Take off. Launch fuel ' + Math.round(G.fuel * 100) + '%');
            } else if (G.warnT <= 0) {
                msg('Launch thruster empty: refuel with 30 Di-hydrogen (menu).');
                G.warnT = 4;
            }
        }
    } else {
        // rotation inputs as angles for this frame
        let rp = I.pitch * 1.1 * dt - I.lookY * 0.5;
        let ry = I.yaw * 0.9 * dt - I.lookX * 0.5;
        let rr = I.roll * 1.8 * dt;
        if (G.stick && G.ctrl.right) {
            _q1.copy(G.stick).invert().multiply(G.ctrl.right.quaternion);
            const e = new THREE.Euler().setFromQuaternion(_q1, 'YXZ');
            const f = v => Math.abs(v) < 0.06 ? 0 : Math.max(-1, Math.min(1, (v - Math.sign(v) * 0.06) / 0.45));
            rp += f(e.x) * 1.2 * dt; ry += f(e.y) * 1.0 * dt; rr += f(e.z) * 1.8 * dt;
        }
        if (G.opts.assist && air > 0.15) {
            S.q.multiply(_q1.setFromAxisAngle(X, rp));
            S.q.premultiply(_q1.setFromAxisAngle(up, ry + rr * 0.6));
            const right = _v1.copy(X).applyQuaternion(S.q);
            const e = Math.asin(Math.max(-1, Math.min(1, right.dot(up))));
            S.q.multiply(_q1.setFromAxisAngle(Z, -e * Math.min(1, dt * 3 * air)));
            // keep the nose away from straight up or down
            const fw = _v1.set(0, 0, -1).applyQuaternion(S.q);
            const pitch = Math.asin(Math.max(-1, Math.min(1, fw.dot(up))));
            const lim = 1.25;
            if (Math.abs(pitch) > lim) S.q.multiply(_q1.setFromAxisAngle(X, -(pitch - Math.sign(pitch) * lim)));
        } else {
            S.q.multiply(_q1.setFromAxisAngle(X, rp));
            S.q.multiply(_q1.setFromAxisAngle(Y, ry));
            S.q.multiply(_q1.setFromAxisAngle(Z, rr));
        }
        S.q.normalize();
        ang = Math.abs(rp) + Math.abs(ry) + Math.abs(rr);
        // speed limit grows with altitude (Superformula Flight): ~100 m/s low, 950 m/s at the top
        const alt0 = altitudeRaw(pl, S.pos);
        let max = THREE.MathUtils.lerp(100, 950, THREE.MathUtils.smoothstep(alt0, 100, H));
        if (I.boost) max *= 2.5;
        S.boost = I.boost;
        // under water: slow, like a submersible
        if (immersion > 0.01) max = THREE.MathUtils.lerp(max, I.boost ? 55 : 34, immersion);
        let tgt = I.throttle > 0 ? I.throttle * max : I.throttle * 30;
        // pulse drive: brakes by itself on approach, so you arrive at the top of the atmosphere
        let clearance = Infinity;
        for (const q of G.sys.planets) {
            const c = S.pos.distanceTo(q.center) - q.p.R - q.p.R * 0.45 * 1.05;
            if (c < clearance) clearance = c;
        }
        if (I.pulse && !S.pulse && clearance <= 0 && G.warnT <= 0) { msg('Atmosphere detected: pulse drive off'); G.warnT = 3; }
        S.pulse = I.pulse && clearance > 0 && immersion < 0.01;
        if (S.pulse) tgt = Math.min(11000, Math.max(950, Math.sqrt(2 * 2200 * clearance)));
        const k = S.pulse ? 1.2 : (S.speed > tgt ? 1.8 : 1.2);
        S.speed += (tgt - S.speed) * Math.min(1, dt * k);
        if (S.speed > tgt && S.pulse) S.speed = tgt;
        const fw = _v1.set(0, 0, -1).applyQuaternion(S.q);
        if (S.lift > 0) { S.pos.addScaledVector(up, 18 * dt * Math.min(1, S.lift)); S.lift -= dt; }
        // substeps so a fast approach cannot cross the ground; the sea floor is the floor
        const steps = Math.max(1, Math.ceil(S.speed * dt / 35));
        let a = 0;
        for (let i = 0; i < steps; i++) {
            S.pos.addScaledVector(fw, S.speed * dt / steps);
            a = altitudeRaw(pl, S.pos);
            if (a < S.m.gearH + 0.5) {
                S.pos.addScaledVector(upAt(pl, S.pos, _v2), S.m.gearH + 0.5 - a);
                S.speed *= 1 - Math.min(1, dt * 2);
                a = S.m.gearH + 0.5;
            }
        }
        if (!S.under) a = altitude(pl, S.pos);
        // landing
        if (a < 150 && S.speed < 90) G.prompt = G.vr ? '[B] Land' : '[E] Land';
        if (I.interactP) {
            if (a < 150 && S.speed < 90) {
                const gh = S.under ? pl.f.raw(up.x, up.y, up.z) : pl.f.height(up.x, up.y, up.z);
                S.landing = {
                    t: 0, p0: S.pos.clone(), q0: S.q.clone(),
                    p1: up.clone().multiplyScalar(p.R + gh + S.m.gearH).add(pl.center),
                    q1: basisQ(up, fw, new THREE.Quaternion())
                };
                S.speed = 0;
            } else msg('To land: get below 150 m and slow down');
        }
        // planet discovery when entering the atmosphere
        if (dist < p.R * 1.1 && !G.planets.has(pl.name)) {
            G.planets.add(pl.name); G.inv.units += 1000;
            msg('Planet discovered: ' + pl.name + ' (+1000 units)');
        }
    }
    G.life = Math.min(1, G.life + dt / 25);
    // ship laser: asteroids
    shipBeams[0].visible = shipBeams[1].visible = false;
    if (I.fire && !S.landed && !G.pointerOnHud && !G.menuBlock) {
        const fw = V().set(0, 0, -1).applyQuaternion(S.q);
        const o = S.pos.clone().addScaledVector(fw, 5);
        let best = null, bt = 1500;
        for (const as of G.sys.asteroids.list) {
            if (!as.alive) continue;
            _v2.copy(as.pos).sub(o);
            const t = _v2.dot(fw);
            if (t < 0 || t > bt) continue;
            if (_v2.lengthSq() - t * t < as.r * as.r) { bt = t; best = as; }
        }
        const tt = best ? bt : Math.min(bt, inAtmo ? rayTerrain(pl, o, fw, 1500, 6) : 1500);
        const end = o.clone().addScaledVector(fw, tt);
        const right = V().set(1, 0, 0).applyQuaternion(S.q);
        aimBeam(shipBeams[0], o.clone().addScaledVector(right, 3.6), end);
        aimBeam(shipBeams[1], o.clone().addScaledVector(right, -3.6), end);
        if (best) {
            best.hp -= dt;
            if (best.hp <= 0) {
                killAsteroid(G.sys, best);
                const fe = Math.round(best.r * 2), h = Math.round(best.r * 0.6);
                G.inv.ferrite += fe; G.inv.dihydrogen += h;
                msg('+' + fe + ' Ferrite, +' + h + ' Di-hydrogen');
            }
        }
    }
    // visuals
    S.m.group.position.copy(S.pos);
    S.m.group.quaternion.copy(S.q);
    const g = S.landed ? 0.05 : 0.3 + Math.min(1.5, S.speed / 300);
    S.m.glow.scale.set(1, 1, g);
    return { ang, accel: Math.abs(S.speed - (S.prevSpeed || 0)) / Math.max(dt, 1e-3) };
}

function cockpitInfo() {
    const S = G.ship, pl = G.pl;
    const up = upAt(pl, S.pos, V());
    const planets = G.sys.planets.filter(q => q !== pl || S.pos.distanceTo(q.center) > q.atm.outer)
        .map(q => ({ name: q.name, pos: q.center, dist: S.pos.distanceTo(q.center) - q.p.R }));
    return {
        q: S.q, up, speed: S.speed, alt: altitude(pl, S.pos), throttle: Math.min(1, S.speed / (S.pulse ? 11000 : 950)),
        pulse: S.pulse, boost: S.boost, assist: G.opts.assist && S.pos.distanceTo(pl.center) < pl.p.R * 1.3,
        landed: S.landed, inAtmo: S.pos.distanceTo(pl.center) < pl.atm.outer * 1.05, planets, shipPos: S.pos,
        under: S.under, target: { name: pl.name, dist: S.pos.distanceTo(pl.center) - pl.p.R }
    };
}

// ---------- scanner ----------
function scan() {
    const pl = G.pl;
    const at = G.mode === 'foot' ? G.foot.pos : G.ship.pos;
    if (altitude(pl, at) > 400) { msg('Scanner: too far from the surface'); return; }
    G.scanT = 14;
    scanSphere.visible = true;
    scanSphere.position.copy(at);
    G.scanAge = 0;
    const list = [];
    for (const it of pl.items.values()) {
        if (it.type === 'tree') continue;
        const d = _v1.copy(it.pos).add(pl.center).distanceTo(at);
        if (d < 130) list.push([d, it]);
    }
    list.sort((a, b) => a[0] - b[0]);
    // keep some of each kind
    const pick = [], count = {};
    for (const [, it] of list) {
        count[it.type] = (count[it.type] || 0) + 1;
        if (count[it.type] <= 6) pick.push(it);
    }
    pick.length = Math.min(pick.length, 24);
    let mi = 0;
    for (const m of markers) { m.it = null; m.cr = null; m.s.visible = false; }
    for (const it of pick) {
        const m = markers[mi++];
        m.it = it; m.s.material = iconMats[it.type];
    }
    let found = 0;
    for (const c of creaturesNear(fauna, at, 70)) {
        if (mi < markers.length) { const m = markers[mi++]; m.cr = c; m.s.material = iconMats.fauna; }
        if (!G.species.has(c.sp.id)) {
            G.species.add(c.sp.id);
            G.inv.units += 500;
            msg('New species: ' + c.sp.name + ' (+500 units)');
            found++;
        }
    }
    const sp = speciesFor(pl);
    const known = sp.filter(s => G.species.has(s.id)).length;
    msg('Scan: ' + pick.length + ' resources, fauna ' + known + '/' + sp.length + ' known');
}

function updateMarkers(dt) {
    if (G.scanAge !== undefined && G.scanAge < 1.5) {
        G.scanAge += dt;
        scanSphere.scale.setScalar(5 + G.scanAge * 90);
        scanSphere.material.opacity = 0.45 * (1 - G.scanAge / 1.5);
        if (G.scanAge >= 1.5) scanSphere.visible = false;
    }
    G.scanT -= dt;
    const eye = eyePos(_v3);
    for (const m of markers) {
        if (G.scanT <= 0 || (m.it && !G.pl.items.has(m.it.key)) || (!m.it && !m.cr) || (m.cr && !m.cr.g.parent)) {
            m.s.visible = false;
            continue;
        }
        if (m.it) m.s.position.copy(m.it.pos).addScaledVector(m.it.up, m.it.h + 1.6).add(G.pl.center);
        else m.s.position.copy(m.cr.g.position).addScaledVector(m.cr.dir, m.cr.sp.hip * 2.5 + 1.5);
        const d = m.s.position.distanceTo(eye);
        m.s.scale.setScalar(Math.max(0.12, d * 0.04));
        m.s.visible = true;
    }
}

// ---------- menu ----------
function buttons() {
    const I = G.inv, S = G.ship;
    let inSpace = G.mode === 'ship' && !S.landed;
    for (const q of G.sys.planets) if (S.pos.distanceTo(q.center) < q.p.R * 1.7) inSpace = false;
    const on = b => b ? 'on' : 'off';
    return [
        { id: 'life', label: 'Recharge life support (25 Carbon)', enabled: I.carbon >= 25 && G.life < 0.99 },
        { id: 'fuel', label: 'Refuel launch thruster (30 Di-H)', enabled: I.dihydrogen >= 30 && G.fuel < 0.99 },
        { id: 'cell', label: 'Craft warp cell (60 Di-H, 40 Fe, 20 C)', enabled: I.dihydrogen >= 60 && I.ferrite >= 40 && I.carbon >= 20 },
        { id: 'warp', label: inSpace ? 'Warp to a new system (1 cell)' : 'Warp: fly out to space first', enabled: inSpace && I.cells >= 1 },
        { id: 'vig', label: 'Comfort vignette: ' + on(G.opts.vignette), enabled: true },
        { id: 'snap', label: 'Turning: ' + (G.opts.snap ? 'snap 30°' : 'smooth'), enabled: true },
        { id: 'assist', label: 'Flight assist (level horizon): ' + on(G.opts.assist), enabled: true },
        { id: 'hand', label: 'Hand stick (hold right grip): ' + on(G.opts.hand), enabled: true },
        { id: 'view', label: 'View: ' + (G.opts.third ? 'third person' : 'first person'), enabled: true },
        { id: 'frame', label: 'Cockpit display: ' + { sides: 'side bars', bottom: 'bottom bar', hud: 'full HUD', off: 'off' }[G.opts.frame], enabled: true },
        { id: 'save', label: 'Save game', enabled: true },
        { id: 'close', label: 'Close menu', enabled: true }
    ];
}

function action(id) {
    const I = G.inv;
    if (id === 'life') { I.carbon -= 25; G.life = 1; msg('Life support recharged'); }
    else if (id === 'fuel') { I.dihydrogen -= 30; G.fuel = 1; msg('Launch thruster refueled'); }
    else if (id === 'cell') { I.dihydrogen -= 60; I.ferrite -= 40; I.carbon -= 20; I.cells++; msg('Warp cell crafted'); }
    else if (id === 'warp') { I.cells--; G.warpT = 2.4; G.warped = false; toggleMenu(false); msg('Warp drive engaged'); }
    else if (id === 'vig') G.opts.vignette = !G.opts.vignette;
    else if (id === 'snap') G.opts.snap = !G.opts.snap;
    else if (id === 'assist') G.opts.assist = !G.opts.assist;
    else if (id === 'hand') G.opts.hand = !G.opts.hand;
    else if (id === 'view') toggleView();
    else if (id === 'frame') G.opts.frame = { sides: 'bottom', bottom: 'hud', hud: 'off', off: 'sides' }[G.opts.frame] || 'sides';
    else if (id === 'save') msg(save() ? 'Game saved' : 'Save failed (storage blocked)');
    else if (id === 'close') toggleMenu(false);
    G.hudT = 0;
}

function toggleMenu(v) {
    G.menu = v === undefined ? !G.menu : v;
    G.sel = 0;
    hud.canvas.classList.toggle('open', G.menu);
    if (!G.vr) {
        if (G.menu) document.exitPointerLock && document.exitPointerLock();
        else renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
    }
    G.hudT = 0;
}

hud.canvas.addEventListener('click', e => {
    if (!G.menu) return;
    const x = e.offsetX / hud.canvas.clientWidth * HUD_W, y = e.offsetY / hud.canvas.clientHeight * HUD_H;
    const id = hudHit(hud, x, y);
    if (id) action(id);
});
hud.canvas.addEventListener('mousemove', e => {
    if (!G.menu) return;
    const x = e.offsetX / hud.canvas.clientWidth * HUD_W, y = e.offsetY / hud.canvas.clientHeight * HUD_H;
    const h = hudHit(hud, x, y);
    if (h !== hud.hover) { hud.hover = h; G.hudT = 0; }
});
renderer.domElement.addEventListener('click', () => {
    if (!G.vr && !G.menu && G.started) renderer.domElement.requestPointerLock();
});

function hudInfo() {
    const S = G.ship, pl = G.pl, I = G.inv;
    const pct = v => Math.round(v * 100) + '%';
    let title, sub, bars;
    if (G.mode === 'foot') {
        title = pl.name;
        const fu = upAt(pl, G.foot.pos, V());
        const bio = pl.f.biome(fu.x, fu.y, fu.z, pl.f.raw(fu.x, fu.y, fu.z));
        sub = bio + '  ·  ' + pl.p.type.charAt(0).toUpperCase() + pl.p.type.slice(1) + ' planet  ·  ' + (pl.p.gravity / 9.8).toFixed(1) + ' g  ·  ' + G.sys.name;
        bars = [{ label: G.under ? 'Oxygen' : 'Life support', v: G.life, color: G.under ? '#7fd8ff' : '#6fe08a' }, { label: 'Jetpack', v: G.jet, color: '#5ab8ff' }];
    } else {
        const a = altitude(pl, S.pos);
        const far = a > pl.p.R * 0.6;
        title = far ? G.sys.name : pl.name;
        const spd = S.speed > 1000 ? (S.speed / 1000).toFixed(1) + ' km/s' : Math.round(S.speed) + ' m/s';
        sub = (S.landed ? 'Landed' : S.pulse ? 'PULSE  ' + spd : spd) + (S.under ? '  ·  SUBMERGED' : '') + '  ·  ' +
            (far ? 'nearest ' + pl.name + ' ' + (a / 1000).toFixed(1) + ' km' : 'altitude ' + Math.round(a) + ' m') +
            (G.opts.assist && a < pl.p.R * 0.3 ? '  ·  assist' : '');
        bars = [{ label: 'Launch fuel', v: G.fuel, color: '#ffb35a' }, { label: 'Life support', v: G.life, color: '#6fe08a' }];
    }
    return {
        title, sub, bars,
        inv: 'C ' + I.carbon + '   Fe ' + I.ferrite + '   Di-H ' + I.dihydrogen + '   Warp cells ' + I.cells + '   Units ' + I.units,
        prompt: G.prompt || (G.menu ? '' : (G.vr ? '[Y] Menu  [X] Scan' : '[Tab] Menu  [F] Scan')),
        msgs: G.msgs, menu: G.menu, buttons: G.menu ? buttons() : [], sel: G.vr ? -1 : G.sel
    };
}

// ---------- VR ----------
G.ctrl = { left: null, right: null, grips: [] };
const ctrlMat = new THREE.MeshLambertMaterial({ color: 0x40464f });
for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.addEventListener('connected', e => {
        c.userData.hand = e.data.handedness;
        G.ctrl[e.data.handedness] = c;
        if (e.data.handedness === 'right' && !c.userData.ray) {
            const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V().set(0, 0, -1)]),
                new THREE.LineBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.6, fog: false }));
            ray.scale.z = 4;
            c.add(ray);
            c.userData.ray = ray;
        }
    });
    c.addEventListener('disconnected', () => {
        if (G.ctrl[c.userData.hand] === c) G.ctrl[c.userData.hand] = null;
    });
    rig.add(c);
    const grip = renderer.xr.getControllerGrip(i);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.12).translate(0, -0.01, 0.02), ctrlMat);
    grip.add(body);
    rig.add(grip);
}
const raycaster = new THREE.Raycaster();
const hudDefault = { pos: new THREE.Vector3(-0.38, 0.85, -1.45) };

function placeHudVR() {
    hud.mesh.position.copy(hudDefault.pos);
    // face the head, in rig space, with the rig's up (the planet's up)
    _m1.lookAt(V().set(0, 1.6, 0), hudDefault.pos, Y);
    hud.mesh.quaternion.setFromRotationMatrix(_m1);
}

function updateVRHud(I) {
    // pointer
    G.pointerOnHud = false;
    const R = G.ctrl.right;
    const vis = true;
    hud.mesh.visible = vis;
    if (R) {
        R.updateMatrixWorld();
        raycaster.ray.origin.setFromMatrixPosition(R.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).transformDirection(R.matrixWorld);
        const hit = raycaster.intersectObject(hud.mesh, false)[0];
        let hov = null;
        if (hit) {
            const x = hit.uv.x * HUD_W, y = (1 - hit.uv.y) * HUD_H;
            hov = G.menu ? hudHit(hud, x, y) : null;
            G.pointerOnHud = G.menu && y > 260;
            if (R.userData.ray) R.userData.ray.scale.z = hit.distance;
            if (I.fireP && hov) action(hov);
        } else if (R.userData.ray) R.userData.ray.scale.z = 4;
        if (hov !== hud.hover) { hud.hover = hov; G.hudT = 0; }
    }
    // grab with either grip
    for (const hand of ['left', 'right']) {
        const c = G.ctrl[hand];
        if (!c) continue;
        const pressed = hand === 'left' ? I.gripLP : I.gripRP;
        const held = hand === 'left' ? I.gripL : I.gripR;
        if (pressed && !G.grab) {
            c.updateMatrixWorld();
            raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
            raycaster.ray.direction.set(0, 0, -1).transformDirection(c.matrixWorld);
            const near = hud.mesh.getWorldPosition(_v1).distanceTo(raycaster.ray.origin) < 0.35;
            if (near || raycaster.intersectObject(hud.mesh, false).length) {
                hud.mesh.updateMatrixWorld();
                G.grab = { c, hand, off: c.matrixWorld.clone().invert().multiply(hud.mesh.matrixWorld) };
            }
        }
        if (G.grab && G.grab.hand === hand) {
            if (!held) {
                // do not leave it close to the face
                const head = camera.getWorldPosition(_v1), hp = hud.mesh.getWorldPosition(_v2);
                const d = hp.distanceTo(head);
                if (d < 0.7) {
                    hp.sub(head).normalize().multiplyScalar(0.7).add(head);
                    hud.mesh.position.copy(rig.worldToLocal(hp.clone()));
                }
                hudDefault.pos.copy(hud.mesh.position);
                G.grab = null;
            } else {
                c.updateMatrixWorld();
                _m1.multiplyMatrices(c.matrixWorld, G.grab.off);
                _m1.premultiply(rig.matrixWorld.clone().invert());
                _m1.decompose(hud.mesh.position, hud.mesh.quaternion, _v3);
            }
        }
    }
    // hand stick in the ship
    if (G.mode === 'ship' && G.opts.hand && R && !(G.grab && G.grab.hand === 'right')) {
        if (I.gripRP && !G.grab) G.stick = R.quaternion.clone();
        if (!I.gripR) G.stick = null;
    } else G.stick = null;
}

async function enterVR() {
    if (!navigator.xr) return;
    const s = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    renderer.xr.setFoveation(1);
    await renderer.xr.setSession(s);
    G.vr = true;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    rig.add(hud.mesh);
    placeHudVR();
    hud.canvas.style.display = 'none';
    document.getElementById('cross').style.display = 'none';
    s.addEventListener('end', () => {
        G.vr = false;
        rig.remove(hud.mesh);
        hud.canvas.style.display = '';
        document.getElementById('cross').style.display = '';
        G.stick = null; G.grab = null;
    });
    start();
}

// ---------- main loop ----------
let lastT = performance.now();

function frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    G.time += dt;
    SHARED.uTime.value = G.time;
    if (!G.started) {
        const e = eyePos(V());
        for (const pl of G.sys.planets) updatePlanet(pl, e, pl === G.pl ? 3 : 1, G.time);
        updateSky(e);
        drawHud(hud, hudInfo());
        renderer.render(scene, camera);
        return;
    }
    const session = renderer.xr.getSession();
    const I = G.vr && session ? readXR(input, session, G.mode, G.opts) : readDesktop(input);
    if (I.menuP) toggleMenu();
    G.menuBlock = !G.vr && G.menu;
    if (!G.vr && G.menu) {
        const n = buttons().length;
        if (I.selDown) { G.sel = (G.sel + 1) % n; G.hudT = 0; }
        if (I.selUp) { G.sel = (G.sel + n - 1) % n; G.hudT = 0; }
        if (I.selectP) { const b = buttons()[G.sel]; if (b.enabled) action(b.id); }
        if (I.cancelP) toggleMenu(false);
        I.lookX = I.lookY = 0;
    }
    if (G.vr) updateVRHud(I);
    if (I.scanP) scan();
    if (input.pressed.has('KeyV')) toggleView();
    G.warnT -= dt;
    const wasFoot = G.mode === 'foot';
    let motion = 0;
    if (G.mode === 'foot') {
        const r = updateFoot(I, dt);
        motion = (r.moving ? 0.35 : 0) + r.turn * 0.4;
        G.ship.m.group.position.copy(G.ship.pos);
        G.ship.m.group.quaternion.copy(G.ship.q);
        shipBeams[0].visible = shipBeams[1].visible = false;
    } else {
        footBeam.visible = false; hitGlow.visible = false;
        const r = updateShip(I, dt);
        motion = Math.min(1, r.ang / Math.max(dt, 1e-3) * 0.45) + (G.ship.speed > 200 ? 0.15 : 0);
        G.ship.prevSpeed = G.ship.speed;
    }
    if (wasFoot && G.mode === 'ship' && G.vr) G.eyeY = Math.max(0.6, camera.position.y);
    placeRig();
    // glass cockpit
    const inCock = G.mode === 'ship' && !G.opts.third;
    updateAvatar(dt);
    G.ship.m.group.visible = true;
    for (const ch of G.ship.m.group.children) if (ch !== headlamp && ch !== headlamp.target) ch.visible = !inCock;
    headlamp.intensity = G.mode === 'ship' && G.ship.under ? 60 : 0;
    cockpit.group.visible = inCock;
    if (inCock) {
        cockpit.group.position.set(0, G.vr ? G.eyeY : G.eyeY, 0);
        cockpit.t -= dt;
        if (cockpit.t <= 0) { cockpit.mode = G.opts.frame; drawCockpit(cockpit, cockpitInfo()); cockpit.t = 1 / 15; }
    }
    // warp sequence
    if (G.warpT > 0) {
        G.warpT -= dt;
        fade.visible = true;
        const t = G.warpT;
        fade.material.opacity = t > 1.2 ? (2.4 - t) / 1.2 : Math.max(0, t / 1.2);
        if (t < 1.2 && !G.warped) {
            G.warped = true;
            loadSystem(G.sysN + 1);
            const pl = G.sys.planets[0];
            const d = V().set(0.3, 0.4, 1).normalize();
            G.ship.pos.copy(pl.center).addScaledVector(d, pl.p.R * 4.5);
            G.ship.q.setFromRotationMatrix(_m1.lookAt(G.ship.pos, pl.center, Y));
            G.ship.speed = 0;
            placeRig();
            msg('Arrived: ' + G.sys.name + ' (' + G.sys.planets.length + ' planets)');
            save();
        }
        if (G.warpT <= 0) fade.visible = false;
    }
    // world updates
    const eye = eyePos(V());
    for (const pl of G.sys.planets) updatePlanet(pl, eye, pl === G.pl ? 3 : 1, G.time);
    const onSurface = G.mode === 'foot' || altitude(G.pl, G.ship.pos) < 300;
    updateFauna(fauna, G.pl, G.mode === 'foot' ? G.foot.pos : G.ship.pos, dt, onSurface);
    updateMarkers(dt);
    updateSky(eye);
    const pl = G.pl;
    const nearWater = pl.p.hasSea && (G.under || (G.mode === 'foot' && altitudeRaw(pl, eye) < 40 && pl.f.raw(...upAt(pl, eye, _v3).toArray()) < pl.p.sea));
    updateSea(sea, pl, eye, G.under, nearWater, G.time, dt);
    const sv = _v3.set(0, 0, -1).applyQuaternion(G.ship.q).multiplyScalar(G.ship.speed);
    const inSpace = G.ship.pos.distanceTo(pl.center) > pl.atm.outer;
    updateStreaks(streaks, eye, sv, G.mode === 'ship' && inSpace, dt);
    // comfort vignette (VR only)
    const want = G.vr && G.opts.vignette ? Math.min(1, motion) : 0;
    G.vig += (want - G.vig) * Math.min(1, dt * 6);
    vignette.visible = G.vig > 0.02;
    vignette.material.uniforms.k.value = G.vig;
    // messages and HUD
    for (const m of G.msgs) m.t -= dt;
    G.msgs = G.msgs.filter(m => m.t > 0);
    G.hudT -= dt;
    if (G.hudT <= 0) { drawHud(hud, hudInfo()); G.hudT = 0.12; }
    G.saveT -= dt;
    if (G.saveT <= 0) { save(); G.saveT = 30; }
    endFrame(input);
    renderer.render(scene, camera);
}

const _sky = new THREE.Color(), _c2 = new THREE.Color(), _e1 = V(), _e2 = V(), _hd = V();
function aces(x) { return Math.min(1, Math.max(0, x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14))); }
function toDisplay(c, out) {
    const e = renderer.toneMappingExposure;
    out.setRGB(aces(c.r * e), aces(c.g * e), aces(c.b * e));
    out.convertLinearToSRGB();
    return out;
}
function updateSky(eye) {
    const pl = G.pl, sys = G.sys, atm = pl.atm, p = pl.p;
    const cam = _v1.copy(eye).sub(pl.center);
    const r = cam.length();
    const up = _v2.copy(cam).divideScalar(r);
    const seaR = p.R + p.sea;
    const under = p.hasSea && r < seaR && pl.f.raw(up.x, up.y, up.z) < p.sea;
    G.under = under;
    SHARED.uUnder.value = under ? 1 : 0;
    const day = THREE.MathUtils.clamp(up.dot(atm.sun) * 2.5 + 0.35, 0, 1);
    const a = 1 - THREE.MathUtils.smoothstep(r, atm.inner + (atm.outer - atm.inner) * 0.35, atm.outer * 1.02);
    // sunlight reaching the camera
    sunTrans(atm, cam, _sky);
    SHARED.uSunTint.value.setRGB(0.1 + _sky.r * 0.95, 0.1 + _sky.g * 0.95, 0.12 + _sky.b * 0.95);
    SHARED.uSunCol.value.copy(sys.sunColor).lerp(_c2.setRGB(1, 1, 1), 0.6).multiply(_sky);
    const st = (_sky.r + _sky.g + _sky.b) / 3;
    sys.sunMeshes[0].material.color.copy(sys.sunColor).multiplyScalar(1.6).multiply(_sky);
    sys.sunMeshes[1].material.opacity = (0.25 + 0.75 * st) * (1 - 0.6 * a);
    // horizon colour for fog and water reflections
    _e1.set(1, 0, 0).cross(up);
    if (_e1.lengthSq() < 1e-4) _e1.set(0, 0, 1).cross(up);
    _e1.normalize();
    _e2.crossVectors(up, _e1);
    let fr = 0, fg = 0, fb = 0;
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        _hd.copy(_e1).multiplyScalar(x).addScaledVector(_e2, y).addScaledVector(up, 0.06).normalize();
        skyColor(atm, cam, _hd, _c2);
        fr += _c2.r / 4; fg += _c2.g / 4; fb += _c2.b / 4;
    }
    _sky.setRGB(fr, fg, fb);
    _hd.copy(_e1).addScaledVector(up, 0.45).normalize();
    skyColor(atm, cam, _hd, _c2);
    SHARED.uSkyCol.value.setRGB(Math.min(1.5, _c2.r), Math.min(1.5, _c2.g), Math.min(1.5, _c2.b)).multiplyScalar(0.05 + 0.95 * a);
    // ambient from the zenith sky
    skyColor(atm, cam, up, _c2);
    const lum = (_c2.r + _c2.g + _c2.b) / 3;
    sys.ambient.color.setRGB(0.6, 0.65, 0.75).lerp(_c2.clone().multiplyScalar(1 / Math.max(lum, 1e-3)).multiplyScalar(0.8), Math.min(1, lum * 3) * 0.6);
    sys.ambient.intensity = 0.14 + Math.min(0.6, lum * 0.9) * a;
    if (under) {
        const depth = seaR - r;
        SHARED.uUnderCol.value.copy(p.c.water).lerp(p.c.deep, Math.min(1, depth / 30)).multiplyScalar(0.25 + 0.6 * day);
        SHARED.uUnderDensity.value = 0.045;
        scene.background = _bgCol.copy(SHARED.uUnderCol.value);
        scene.fog.density = 0;
    } else {
        scene.background = sys.nebula;
        scene.backgroundIntensity = 1 - a * day * 0.97;
        toDisplay(_sky, scene.fog.color);
        scene.fog.density = 0.0011 * a;
    }
    // sun glow: smaller inside the air, where the sky draws its own sun disk
    sys.sunMeshes[1].scale.setScalar(THREE.MathUtils.lerp(16000, 5000, a));
    pl.sky.visible = !under;
    if (pl.clouds) pl.clouds.visible = !under;
    sys.stars.material.opacity = 1 - a * day;
    sys.stars.visible = !under;
    sys.stars.position.copy(eye);
    cockpit.glass.material.uniforms.uSun.value.copy(atm.sun);
}
const _bgCol = new THREE.Color();

function start() {
    if (G.started) return;
    G.started = true;
    document.getElementById('start').style.display = 'none';
    if (!G.vr) renderer.domElement.requestPointerLock();
    msg('Welcome, traveller. Mine, scan, refuel, and fly to the stars.');
}

// ---------- boot ----------
const hadSave = load();
newGame();
renderer.setAnimationLoop(frame);

document.getElementById('play').onclick = () => start();
const vrBtn = document.getElementById('vr');
if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
        if (ok) { vrBtn.style.display = ''; vrBtn.onclick = () => enterVR().catch(e => alert('VR failed: ' + e.message)); }
    });
}
document.getElementById('reset').onclick = () => {
    try { localStorage.removeItem('nomad-save'); } catch (e) { }
    location.reload();
};
if (hadSave) document.getElementById('play').textContent = 'Continue';
window.G = G;
window.R = renderer;
window.F = fauna;
window.THREEMat = THREE.Matrix4;
