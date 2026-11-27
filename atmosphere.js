// atmosphere.js - per-planet atmospheric scattering (after Sean O'Neil, GPU Gems 2 ch. 16),
// sky shell, cloud shell, material patches for terrain and flora, CPU sky colour
import * as THREE from './three.module.js';
import { simplex } from './noise.js';

const SD = 0.25; // scale depth as a fraction of the atmosphere thickness

// uniforms shared by every planet and every patched material (only the current planet uses them)
export const SHARED = {
    uTime: { value: 0 },
    uUnder: { value: 0 }, uUnderCol: { value: new THREE.Color(0.02, 0.1, 0.15) }, uUnderDensity: { value: 0.05 },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyCol: { value: new THREE.Color(0.5, 0.6, 0.8) },
    uSunTint: { value: new THREE.Color(1, 1, 1) }
};

export function makeAtm(p, center) {
    const R = p.R;
    const a = p.c.atmo;
    const m = Math.max(a.r, a.g, a.b) || 1;
    const dens = p.type === 'barren' ? 0.35 : p.type === 'exotic' ? 1.25 : p.type === 'toxic' ? 1.15 : p.type === 'desert' ? 1.1 : 1;
    const beta = new THREE.Vector3(Math.max(a.r / m, 0.12), Math.max(a.g / m, 0.12), Math.max(a.b / m, 0.12)).multiplyScalar(2.3e-3 * dens);
    const atm = {
        inner: R, outer: R * 1.2, beta, betaM: 0.15e-3 * dens, HR: 0.035 * R, HM: 0.01 * R, sunI: 30, g: 0.76,
        sun: center.clone().negate().normalize()
    };
    const u = {
        uCenter: { value: center.clone() },
        uCam: { value: new THREE.Vector3() },
        uSun: { value: atm.sun.clone() },
        uBetaR: { value: beta.clone() }, uBetaM: { value: atm.betaM },
        uHR: { value: atm.HR }, uHM: { value: atm.HM }, uSunI: { value: atm.sunI }, uG: { value: atm.g },
        uInner: { value: atm.inner }, uOuter: { value: atm.outer },
        uExposure: { value: 1.0 },
        uTime: SHARED.uTime,
        uSea: { value: p.hasSea ? p.sea : -1e5 },
        uUnder: SHARED.uUnder, uUnderCol: SHARED.uUnderCol, uUnderDensity: SHARED.uUnderDensity,
        uSunCol: SHARED.uSunCol, uSkyCol: SHARED.uSkyCol, uSunTint: SHARED.uSunTint,
        uDetail: { value: detailTexture() },
        uWaterTint: { value: p.c.water.clone() }
    };
    atm.u = u;
    return atm;
}

// Nishita single scattering, N primary samples, 4 light samples. Planet shadow comes out of the
// light integral itself (samples inside the planet give a huge optical depth).
function atmGLSL(N) {
    return /* glsl */`
uniform vec3 uCenter, uCam, uSun, uBetaR;
uniform float uInner, uOuter, uBetaM, uHR, uHM, uSunI, uG, uExposure;
vec2 aRS(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float det = b * b - c;
    if (det < 0.0) return vec2(1e9, -1e9);
    det = sqrt(det);
    return vec2(-b - det, -b + det);
}
vec2 aLight(vec3 p) {
    float L = max(aRS(p, uSun, uOuter).y, 0.0);
    float ds = L * 0.25;
    vec2 od = vec2(0.0);
    for (int i = 0; i < 4; i++) {
        vec3 q = p + uSun * (ds * (float(i) + 0.5));
        float h = length(q) - uInner;
        od += exp(-h / vec2(uHR, uHM)) * ds;
    }
    return od;
}
void aIntegrate(vec3 o, vec3 d, float tmax, out vec3 sR, out vec3 sM, out vec3 tr) {
    sR = vec3(0.0); sM = vec3(0.0); tr = vec3(1.0);
    vec2 ta = aRS(o, d, uOuter);
    float t0 = max(ta.x, 0.0), t1 = min(ta.y, tmax);
    vec2 tp = aRS(o, d, uInner);
    if (tmax > 1e8 && tp.x > 0.0 && tp.x < 1e8) t1 = min(t1, tp.x);
    if (t1 <= t0) return;
    float ds = (t1 - t0) / ${N}.0;
    vec2 od = vec2(0.0);
    for (int i = 0; i < ${N}; i++) {
        vec3 p = o + d * (t0 + ds * (float(i) + 0.5));
        float h = max(length(p) - uInner, -uHR);
        vec2 dd = exp(-h / vec2(uHR, uHM)) * ds;
        od += dd;
        vec2 l = aLight(p);
        vec3 a = exp(-min(uBetaR * (od.x + l.x) + uBetaM * 1.1 * (od.y + l.y), vec3(60.0)));
        sR += a * dd.x; sM += a * dd.y;
    }
    tr = exp(-(uBetaR * od.x + uBetaM * 1.1 * od.y));
}
float aRayleigh(float c) { return 0.0596831 * (1.0 + c * c); }
float aMie(float c, float g) {
    float g2 = g * g;
    return 0.1193662 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
void aSky(vec3 p, out vec3 sR, out vec3 sM, out vec3 tr) {
    vec3 d = normalize(p - uCam);
    aIntegrate(uCam, d, 1e9, sR, sM, tr);
    sR *= uBetaR * uSunI;
    sM *= uBetaM * uSunI;
}
void aGround(vec3 p, out vec3 ins, out vec3 att) {
    vec3 d = p - uCam;
    float L = length(d);
    d /= max(L, 1e-4);
    vec3 sR, sM;
    aIntegrate(uCam, d, L, sR, sM, att);
    float c = dot(d, uSun);
    ins = uSunI * (sR * uBetaR * aRayleigh(c) + sM * uBetaM * aMie(c, uG)) * uExposure;
    float mx = max(max(ins.r, ins.g), ins.b);
    if (mx > 1e-4) ins *= (1.0 - exp(-mx * 1.5)) / mx * 1.1;
}
vec3 aSunT(vec3 p) {
    vec2 l = aLight(p);
    return exp(-min(uBetaR * l.x + uBetaM * 1.1 * l.y, vec3(60.0)));
}
`;
}
export const ATM_GLSL = atmGLSL(6);
const ATM_SKY = atmGLSL(10);
const ATM_SKY_PX = atmGLSL(16);

const CAUSTIC = /* glsl */`
float caustic(vec3 p, float t) {
    vec3 q = p;
    float v = 0.0;
    for (int i = 0; i < 3; i++) {
        q = vec3(q.y * 1.3 + sin(q.z * 0.9 + t), q.z * 1.2 + sin(q.x * 1.1 - t * 0.7), q.x * 1.25 + sin(q.y * 0.8 + t * 0.5));
        v += abs(sin(q.x) + sin(q.y) + sin(q.z));
    }
    return pow(clamp(1.0 - v / 4.5, 0.0, 1.0), 5.0) * 3.0;
}
`;

// ---------- detail texture for terrain (tileable value noise) ----------
let _detail = null;
function detailTexture() {
    if (_detail) return _detail;
    const S = 128, data = new Uint8Array(S * S * 4);
    const n = simplex(99);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        // tileable: sample a torus in 4D folded into 3D noise sums
        const a = x / S * Math.PI * 2, b = y / S * Math.PI * 2;
        let v = 0, amp = 0.5, f = 1;
        for (let o = 0; o < 4; o++) {
            v += amp * n(Math.cos(a) * f * 1.5 + o * 7, Math.sin(a) * f * 1.5 + Math.cos(b) * f * 1.5, Math.sin(b) * f * 1.5);
            amp *= 0.5; f *= 2;
        }
        const c = Math.max(0, Math.min(255, 128 + v * 160));
        const i = (y * S + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = c; data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    _detail = t;
    return t;
}

// ---------- terrain material ----------
export function terrainMaterial(atm) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, atm.u);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\n' + ATM_GLSL + '\nvarying vec3 vIns; varying vec3 vAtt; varying vec3 vLocal; varying vec3 vLocalN; varying vec3 vSunT;')
            .replace('#include <project_vertex>', `#include <project_vertex>
                vec4 aWp = modelMatrix * vec4(transformed, 1.0);
                vLocal = aWp.xyz - uCenter;
                vLocalN = normalize(mat3(modelMatrix) * objectNormal);
                aGround(vLocal, vIns, vAtt);
                vSunT = aSunT(vLocal + normalize(vLocal) * 2.0);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec3 vSunT;
                uniform sampler2D uDetail; uniform float uTime, uSea, uUnder, uUnderDensity, uInner;
                uniform vec3 uUnderCol, uSunCol, uSun, uWaterTint;
                varying vec3 vIns; varying vec3 vAtt; varying vec3 vLocal; varying vec3 vLocalN;
                ${CAUSTIC}`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec3 bw = abs(vLocalN); bw /= (bw.x + bw.y + bw.z);
                vec3 tp = vLocal * 0.18;
                float dtl = texture2D(uDetail, tp.yz).r * bw.x + texture2D(uDetail, tp.zx).r * bw.y + texture2D(uDetail, tp.xy).r * bw.z;
                vec3 tp2 = vLocal * 0.021;
                float dtl2 = texture2D(uDetail, tp2.yz).r * bw.x + texture2D(uDetail, tp2.zx).r * bw.y + texture2D(uDetail, tp2.xy).r * bw.z;
                diffuseColor.rgb *= (0.72 + dtl * 0.56) * (0.8 + dtl2 * 0.4);`)
            .replace('#include <opaque_fragment>', `#include <opaque_fragment>
                float aH = length(vLocal) - uInner;
                if (aH < uSea) {
                    float dd = uSea - aH;
                    float sunUp = max(dot(normalize(vLocal), uSun), 0.0);
                    gl_FragColor.rgb *= mix(vec3(1.0), uWaterTint * 1.6, clamp(dd / 8.0, 0.0, 0.85));
                    gl_FragColor.rgb += uSunCol * caustic(vLocal * 0.45, uTime * 1.3) * 0.22 * exp(-dd * 0.09) * sunUp;
                }
                gl_FragColor.rgb *= vSunT * 0.85 + 0.15;
                gl_FragColor.rgb = gl_FragColor.rgb * vAtt + vIns;
                if (uUnder > 0.5) {
                    float uf = 1.0 - exp(-length(vViewPosition) * uUnderDensity);
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, uUnderCol, uf);
                }`);
    };
    m.customProgramCacheKey = () => 'nomad-terrain';
    return m;
}

// flora / creatures: wind sway in the vertex shader, sun tint from the CPU, normal fog
export function patchWind(m, atm, amount, kelp) {
    m.onBeforeCompile = sh => {
        sh.uniforms.uTime = atm.u.uTime;
        sh.uniforms.uSunTint = atm.u.uSunTint;
        sh.uniforms.uUnder = atm.u.uUnder;
        sh.uniforms.uUnderCol = atm.u.uUnderCol;
        sh.uniforms.uUnderDensity = atm.u.uUnderDensity;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                #ifdef USE_INSTANCING
                vec3 ip = instanceMatrix[3].xyz;
                #else
                vec3 ip = vec3(0.0);
                #endif
                float sway = ${amount.toFixed(3)} * transformed.y * transformed.y;
                float ph = dot(ip, vec3(0.13, 0.07, 0.11)) + uTime * ${kelp ? '0.9' : '1.6'};
                transformed.x += sin(ph) * sway + sin(ph * 2.3 + 1.0) * sway * 0.3;
                transformed.z += cos(ph * 0.8) * sway * 0.6;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform vec3 uSunTint, uUnderCol; uniform float uUnder, uUnderDensity;')
            .replace('#include <opaque_fragment>', `#include <opaque_fragment>
                gl_FragColor.rgb *= uSunTint;
                if (uUnder > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, uUnderCol, 1.0 - exp(-length(vViewPosition) * uUnderDensity));`);
    };
    m.customProgramCacheKey = () => 'nomad-wind-' + amount + (kelp ? 'k' : '');
    return m;
}

export function patchTint(m) {
    return patchWind(m, { u: SHARED }, 0);
}

// ---------- sky shell ----------
const SKY_FRAG_COMMON = `
float aRayleighF(float c) { return 0.0596831 * (1.0 + c * c); }
float aMieF(float c, float g) {
    float g2 = g * g;
    return 0.1193662 * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
vec3 skyFinish(vec3 R, vec3 M, vec3 T, vec3 dir, vec3 sun, float g, float ex) {
    float c = dot(sun, normalize(dir));
    vec3 col = (aRayleighF(c) * R + aMieF(c, g) * M) * ex;
    // hue-preserving compression so a bright limb stays blue instead of clipping to white
    float mx = max(max(col.r, col.g), col.b);
    if (mx > 1e-4) col *= (1.0 - exp(-mx * 1.5)) / mx * 1.2;
    float disk = smoothstep(0.99955, 0.9998, c) * 40.0 + pow(max(c, 0.0), 900.0) * 3.0;
    return col + T * disk;
}`;

export function skyMesh(atm) {
    const common = { side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
    // per vertex: used from inside the atmosphere (smooth gradients, cheap)
    const matV = new THREE.ShaderMaterial(Object.assign({
        uniforms: atm.u,
        vertexShader: ATM_SKY + `
            varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vDir;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vec3 p = wp.xyz - uCenter;
                aSky(p, vR, vM, vT);
                vDir = p - uCam;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            uniform vec3 uSun; uniform float uG, uExposure;
            varying vec3 vR; varying vec3 vM; varying vec3 vT; varying vec3 vDir;
            ${SKY_FRAG_COMMON}
            void main() {
                gl_FragColor = vec4(skyFinish(vR, vM, vT, vDir, uSun, uG, uExposure), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    }, common));
    // per pixel: used from space, where the thin limb needs it (covers little of the screen)
    const matF = new THREE.ShaderMaterial(Object.assign({
        uniforms: atm.u,
        vertexShader: `
            uniform vec3 uCenter;
            varying vec3 vP;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vP = wp.xyz - uCenter;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: ATM_SKY_PX + `
            varying vec3 vP;
            ${SKY_FRAG_COMMON}
            void main() {
                vec3 R, M, T;
                aSky(vP, R, M, T);
                gl_FragColor = vec4(skyFinish(R, M, T, vP - uCam, uSun, uG, uExposure), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`
    }, common));
    const m = new THREE.Mesh(new THREE.SphereGeometry(atm.outer, 128, 64), matV);
    m.userData.matV = matV;
    m.userData.matF = matF;
    m.renderOrder = 2;
    m.frustumCulled = false;
    return m;
}

// ---------- clouds ----------
// cube face directions, OpenGL convention
function faceDir(f, u, v, out) {
    if (f === 0) out.set(1, -v, -u);
    else if (f === 1) out.set(-1, -v, u);
    else if (f === 2) out.set(u, 1, v);
    else if (f === 3) out.set(u, -1, -v);
    else if (f === 4) out.set(u, -v, 1);
    else out.set(-u, -v, -1);
    return out.normalize();
}

export function cubeFromFn(S, fn) {
    const faces = [], d = new THREE.Vector3(), rgba = [0, 0, 0, 0];
    for (let f = 0; f < 6; f++) {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d');
        const img = x.createImageData(S, S);
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
            faceDir(f, 2 * (i + 0.5) / S - 1, 2 * (j + 0.5) / S - 1, d);
            fn(d, rgba);
            const k = (j * S + i) * 4;
            img.data[k] = rgba[0]; img.data[k + 1] = rgba[1]; img.data[k + 2] = rgba[2]; img.data[k + 3] = rgba[3];
        }
        x.putImageData(img, 0, 0);
        faces.push(c);
    }
    const t = new THREE.CubeTexture(faces);
    t.needsUpdate = true;
    return t;
}

export function cloudMesh(pl, atm) {
    const p = pl.p;
    const cover = { lush: 0.56, ocean: 0.5, toxic: 0.44, exotic: 0.6, frozen: 0.52, desert: 0.74, barren: 2 }[p.type];
    if (cover > 1) return null;
    const n = simplex(p.seed + 501), w = simplex(p.seed + 502);
    const tex = cubeFromFn(96, (d, o) => {
        const wx = w(d.x * 1.5, d.y * 1.5, d.z * 1.5) * 0.6;
        const x = d.x * 3 + wx, y = d.y * 3 * 1.6 + wx, z = d.z * 3 - wx;
        let v = 0, a = 0.5, f = 1;
        for (let i = 0; i < 5; i++) { v += a * n(x * f, y * f, z * f); a *= 0.5; f *= 2.1; }
        const c = Math.max(0, Math.min(255, 128 + v * 200));
        o[0] = o[1] = o[2] = c; o[3] = 255;
    });
    tex.colorSpace = THREE.NoColorSpace;
    const rot = { value: new THREE.Matrix3() };
    const u = Object.assign({}, atm.u, {
        uClouds: { value: tex }, uCover: { value: cover }, uRot: rot,
        uCloudR: { value: p.R + Math.max(p.sea, 0) + p.R * 0.115 },
        uTint: { value: p.type === 'toxic' ? new THREE.Color(0.85, 1, 0.6) : p.type === 'desert' ? new THREE.Color(1, 0.88, 0.75) : new THREE.Color(1, 1, 1) }
    });
    const mat = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: ATM_GLSL + `
            uniform mat3 uRot;
            varying vec3 vIns; varying vec3 vAtt; varying vec3 vDir; varying vec3 vN;
            void main() {
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vec3 p = wp.xyz - uCenter;
                aGround(p, vIns, vAtt);
                vN = normalize(p);
                vDir = uRot * vN;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            uniform samplerCube uClouds; uniform float uCover, uCloudR; uniform vec3 uSun, uCam, uSunCol, uTint;
            varying vec3 vIns; varying vec3 vAtt; varying vec3 vDir; varying vec3 vN;
            void main() {
                float a = textureCube(uClouds, vDir).r;
                float b = textureCube(uClouds, vec3(vDir.z, vDir.x, -vDir.y)).r;
                float v = a * 0.78 + b * 0.22;
                float cov = smoothstep(uCover, uCover + 0.22, v);
                float ndl = dot(vN, uSun);
                float lit = smoothstep(-0.18, 0.35, ndl);
                vec3 sunset = mix(vec3(1.0, 0.45, 0.25), vec3(1.0), smoothstep(0.0, 0.35, ndl));
                vec3 col = uTint * mix(vec3(0.03, 0.035, 0.05), sunset * uSunCol, lit) * (0.75 + 0.25 * v);
                col = col * vAtt + vIns;
                float near = smoothstep(4.0, 60.0, abs(length(uCam) - uCloudR));
                vec3 wp = vN * uCloudR;
                float graze = smoothstep(0.02, 0.3, abs(dot(vN, normalize(uCam - wp))));
                gl_FragColor = vec4(col, cov * 0.85 * near * graze);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: false
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(u.uCloudR.value, 128, 64), mat);
    m.renderOrder = 3;
    m.frustumCulled = false;
    m.userData.rot = rot;
    m.userData.spin = (pl.seed % 7 + 3) * 0.0004;
    return m;
}

// ---------- CPU side: sky colour and sun transmittance (same maths as the shaders) ----------
function rs(o, d, r) {
    const b = o.dot(d), c = o.lengthSq() - r * r, det = b * b - c;
    if (det < 0) return [1e9, -1e9];
    const s = Math.sqrt(det);
    return [-b - s, -b + s];
}
const _q = new THREE.Vector3(), _p = new THREE.Vector3();
function lightOD(atm, p, out) {
    const L = Math.max(rs(p, atm.sun, atm.outer)[1], 0), ds = L / 4;
    let r = 0, m = 0;
    for (let i = 0; i < 4; i++) {
        _q.copy(p).addScaledVector(atm.sun, ds * (i + 0.5));
        const h = _q.length() - atm.inner;
        r += Math.exp(-h / atm.HR) * ds; m += Math.exp(-h / atm.HM) * ds;
    }
    out[0] = r; out[1] = m;
}
const _l = [0, 0];
export function skyColor(atm, cam, dir, out) {
    const ta = rs(cam, dir, atm.outer);
    const t0 = Math.max(ta[0], 0);
    let t1 = ta[1];
    const tp = rs(cam, dir, atm.inner);
    if (tp[0] > 0 && tp[0] < 1e8) t1 = Math.min(t1, tp[0]);
    if (t1 <= t0) return out.setRGB(0, 0, 0);
    const ds = (t1 - t0) / 8, b = atm.beta;
    let odR = 0, odM = 0, r0 = 0, r1 = 0, r2 = 0, m0 = 0, m1 = 0, m2 = 0;
    for (let i = 0; i < 8; i++) {
        _p.copy(cam).addScaledVector(dir, t0 + ds * (i + 0.5));
        const h = Math.max(_p.length() - atm.inner, -atm.HR);
        const dr = Math.exp(-h / atm.HR) * ds, dm = Math.exp(-h / atm.HM) * ds;
        odR += dr; odM += dm;
        lightOD(atm, _p, _l);
        const tm = atm.betaM * 1.1 * (odM + _l[1]);
        const a0 = Math.exp(-Math.min(60, b.x * (odR + _l[0]) + tm)), a1 = Math.exp(-Math.min(60, b.y * (odR + _l[0]) + tm)), a2 = Math.exp(-Math.min(60, b.z * (odR + _l[0]) + tm));
        r0 += a0 * dr; r1 += a1 * dr; r2 += a2 * dr; m0 += a0 * dm; m1 += a1 * dm; m2 += a2 * dm;
    }
    const c = dir.dot(atm.sun), g = atm.g, g2 = g * g;
    const pr = 0.0596831 * (1 + c * c);
    const pm = 0.1193662 * ((1 - g2) * (1 + c * c)) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * c, 1e-4), 1.5));
    const I = atm.sunI;
    return out.setRGB(I * (r0 * b.x * pr + m0 * atm.betaM * pm), I * (r1 * b.y * pr + m1 * atm.betaM * pm), I * (r2 * b.z * pr + m2 * atm.betaM * pm));
}

export function sunTrans(atm, cam, out) {
    if (cam.length() > atm.outer) return out.setRGB(1, 1, 1);
    lightOD(atm, cam, _l);
    const tm = atm.betaM * 1.1 * _l[1], b = atm.beta;
    return out.setRGB(Math.exp(-Math.min(60, b.x * _l[0] + tm)), Math.exp(-Math.min(60, b.y * _l[0] + tm)), Math.exp(-Math.min(60, b.z * _l[0] + tm)));
}
