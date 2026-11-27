// water.js - ocean surface material, underwater fish, bubbles and light rays
import * as THREE from './three.module.js';
import { ATM_GLSL, patchTint } from './atmosphere.js';

export function waterMaterial(atm, p) {
    const u = Object.assign({}, atm.u, {
        uDeep: { value: p.c.deep.clone() },
        uShallow: { value: p.c.water.clone() }
    });
    return new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: ATM_GLSL + `
            attribute float depth;
            varying vec3 vIns; varying vec3 vAtt; varying vec3 vLocal; varying float vDepth; varying vec3 vView;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vLocal = wp.xyz - uCenter;
                vDepth = depth;
                vView = cameraPosition - wp.xyz;
                aGround(vLocal, vIns, vAtt);
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            uniform vec3 uSun, uDeep, uShallow, uSunCol, uSkyCol, uUnderCol;
            uniform float uTime, uUnder, uUnderDensity;
            varying vec3 vIns; varying vec3 vAtt; varying vec3 vLocal; varying float vDepth; varying vec3 vView;
            vec3 wave(vec3 p, vec3 k, float w, float a) {
                return k * (cos(dot(p, k) + uTime * w) * a);
            }
            void main() {
                vec3 up = normalize(vLocal);
                vec3 g = wave(vLocal, vec3(0.31, 0.12, 0.22), 1.1, 0.12)
                       + wave(vLocal, vec3(-0.18, 0.27, 0.15), 1.4, 0.10)
                       + wave(vLocal, vec3(0.62, -0.41, 0.33), 2.3, 0.05)
                       + wave(vLocal, vec3(-0.5, -0.3, 0.71), 2.9, 0.04)
                       + wave(vLocal, vec3(1.7, 1.1, -1.3), 4.1, 0.016)
                       + wave(vLocal, vec3(-1.3, 1.9, 1.5), 5.3, 0.012);
                g -= up * dot(g, up);
                vec3 n = normalize(up - g);
                float dist = length(vView);
                vec3 V = vView / dist;
                // calm the waves in the distance to avoid shimmer
                n = normalize(mix(n, up, smoothstep(80.0, 900.0, dist)));
                bool below = dot(V, up) < 0.0;
                if (below) n = -n;
                float ndv = max(dot(n, V), 0.0);
                float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
                float sunUp = smoothstep(-0.1, 0.3, dot(up, uSun));
                vec3 R = reflect(-V, n);
                float spec = pow(max(dot(R, uSun), 0.0), 350.0) * 8.0 + pow(max(dot(R, uSun), 0.0), 40.0) * 0.25;
                float dep = clamp(vDepth / 14.0, 0.0, 1.0);
                vec3 body = mix(uShallow * 1.15, uDeep, dep) * (0.25 + 0.75 * sunUp);
                vec3 col;
                float alpha;
                if (!below) {
                    vec3 refl = uSkyCol * (0.4 + 0.6 * sunUp);
                    col = mix(body, refl, fres) + uSunCol * spec * sunUp;
                    float foamN = sin(dot(vLocal, vec3(1.3, 0.9, 1.1)) + uTime * 1.7) * 0.5 + 0.5;
                    float foam = smoothstep(0.9, 0.0, vDepth + foamN * 0.35) * (0.6 + 0.4 * foamN);
                    col = mix(col, vec3(0.95) * (0.3 + 0.7 * sunUp), foam * 0.85);
                    alpha = clamp(mix(0.45, 0.96, smoothstep(0.0, 9.0, vDepth)) + fres * 0.4 + foam, 0.0, 1.0);
                    col = col * vAtt + vIns;
                } else {
                    // looking up from under water: bright window towards the sky
                    float win = smoothstep(0.55, 0.9, ndv);
                    col = mix(uShallow * 0.6, uSkyCol * 1.2 + uSunCol * spec * 0.3, win) * (0.3 + 0.7 * sunUp);
                    alpha = 0.92;
                }
                if (uUnder > 0.5) {
                    col = mix(col, uUnderCol, 1.0 - exp(-dist * uUnderDensity));
                }
                gl_FragColor = vec4(col, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.DoubleSide, transparent: true, depthWrite: true, fog: false
    });
}

// ---------- fish ----------
function fishGeo() {
    const body = new THREE.SphereGeometry(0.5, 8, 6).scale(0.35, 0.5, 1.2);
    const tail = new THREE.ConeGeometry(0.35, 0.6, 4).rotateX(Math.PI / 2).scale(0.2, 1, 1).translate(0, 0, 0.85);
    const parts = [body.toNonIndexed(), tail.toNonIndexed()];
    const pos = [];
    for (const g of parts) pos.push(...g.attributes.position.array);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}

export function makeSea(scene) {
    const fishMat = patchTint(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const fish = new THREE.InstancedMesh(fishGeo(), fishMat, 90);
    fish.frustumCulled = false;
    fish.visible = false;
    scene.add(fish);
    const schools = [];
    for (let s = 0; s < 3; s++) schools.push({ c: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, size: 0.4 + s * 0.3, active: false });
    const col = new THREE.Color();
    for (let i = 0; i < 90; i++) {
        col.setHSL((i % 3) * 0.3 + 0.05 * Math.random(), 0.7, 0.55);
        fish.setColorAt(i, col);
    }
    // bubbles
    const bn = 120, bp = new Float32Array(bn * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    const bubbles = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xcfffff, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false }));
    bubbles.frustumCulled = false;
    bubbles.visible = false;
    scene.add(bubbles);
    const boff = [];
    for (let i = 0; i < bn; i++) boff.push(new THREE.Vector3((Math.random() - 0.5) * 16, Math.random() * 12 - 8, (Math.random() - 0.5) * 16));
    // light rays
    const rays = new THREE.Group();
    const rmat = new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 10; i++) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.6 + Math.random() * 1.5, 30, 6, 1, true).translate(0, -15, 0), rmat.clone());
        r.userData.o = new THREE.Vector3((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40);
        r.userData.ph = Math.random() * 6;
        rays.add(r);
    }
    rays.visible = false;
    scene.add(rays);
    return { fish, schools, bubbles, boff, rays, m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
}

const _up = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _x = new THREE.Vector3();

export function updateSea(sea, pl, eye, under, nearWater, time, dt) {
    const p = pl.p;
    sea.bubbles.visible = under;
    sea.rays.visible = under;
    sea.fish.visible = nearWater;
    if (!nearWater) { for (const s of sea.schools) s.active = false; return; }
    _up.copy(eye).sub(pl.center).normalize();
    const seaR = p.R + p.sea;
    // schools wander in the water column near the player
    let idx = 0;
    for (const s of sea.schools) {
        if (!s.active || s.c.distanceTo(eye) > 70) {
            _t.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(_up).normalize();
            s.c.copy(eye).addScaledVector(_t, 12 + Math.random() * 25);
            s.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(_up).normalize().multiplyScalar(2);
            s.active = true;
        }
        const su = _b.copy(s.c).sub(pl.center).normalize();
        const r = s.c.distanceTo(pl.center);
        const ground = p.R + pl.f.raw(su.x, su.y, su.z);
        // keep inside the water column
        if (ground > seaR - 2) s.v.addScaledVector(_t.copy(eye).sub(s.c).normalize(), dt * 2);
        const mid = (Math.max(ground + 1.5, seaR - 25) + seaR - 1.2) / 2;
        s.v.addScaledVector(su, (mid - r) * dt * 0.6);
        s.v.applyAxisAngle(su, Math.sin(time * 0.3 + s.size * 9) * dt * 0.6);
        s.v.clampLength(1, 3);
        s.c.addScaledVector(s.v, dt);
        _f.copy(s.v).normalize();
        for (let i = 0; i < 30; i++, idx++) {
            const a = i * 2.39996, rr = 1 + (i % 7) * 0.45;
            _x.crossVectors(su, _f).normalize();
            const off = _t.copy(_x).multiplyScalar(Math.cos(a + time * 0.7) * rr)
                .addScaledVector(su, Math.sin(a * 1.7 + time) * rr * 0.5)
                .addScaledVector(_f, Math.sin(a + time * 0.5) * rr);
            const pos = _b.copy(s.c).add(off);
            const wig = Math.sin(time * 9 + i) * 0.25;
            _m.lookAt(pos, _f.clone().add(pos).addScaledVector(_x, wig), su);
            sea.q.setFromRotationMatrix(_m);
            const sc = s.size * (0.7 + (i % 5) * 0.12);
            sea.s.set(sc, sc, sc);
            sea.m.compose(pos, sea.q, sea.s);
            sea.fish.setMatrixAt(idx, sea.m);
        }
    }
    sea.fish.instanceMatrix.needsUpdate = true;
    if (under) {
        const arr = sea.bubbles.geometry.attributes.position.array;
        _x.set(1, 0, 0).cross(_up).normalize();
        _f.crossVectors(_up, _x);
        for (let i = 0; i < sea.boff.length; i++) {
            const o = sea.boff[i];
            o.y += dt * (0.6 + (i % 5) * 0.2);
            if (o.y > 4) o.y = -8;
            const w = eye.clone().addScaledVector(_x, o.x + Math.sin(time + i) * 0.1).addScaledVector(_f, o.z).addScaledVector(_up, o.y);
            if (w.distanceTo(pl.center) > seaR - 0.1) o.y = -8;
            arr[i * 3] = w.x; arr[i * 3 + 1] = w.y; arr[i * 3 + 2] = w.z;
        }
        sea.bubbles.geometry.attributes.position.needsUpdate = true;
        sea.bubbles.geometry.computeBoundingSphere();
        // rays hang from the surface above the player
        sea.rays.position.copy(_up).multiplyScalar(seaR).add(pl.center);
        sea.rays.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _up);
        for (const r of sea.rays.children) {
            r.position.copy(r.userData.o);
            r.material.opacity = 0.035 + 0.035 * Math.sin(time * 0.8 + r.userData.ph);
        }
    }
}
