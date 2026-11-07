// Small numerical models behind the primer labs (instant, run in the browser).

export interface BoxParams {
  years: number;
  H: number; // box depth (m)
  nut0: number; // initial nutrient (mmol N m-3)
  fish: "none" | "one_way" | "two_way";
  fish0: number; // mg C m-2
  sigma: number; // fish grazing rate on zooplankton (d-1)
  a: number; // preference
  r: number; // half saturation (mmol C m-3)
  gamma: number; // assimilation efficiency
  m: number; // fish mortality (d-1)
  mu: number; // fish excretion (d-1)
  zmort: number; // zooplankton linear mortality (d-1)
  gmax: number; // zooplankton max grazing (d-1)
}

export const BOX_DEFAULTS: BoxParams = { years: 4, H: 30, nut0: 8, fish: "two_way", fish0: 1000, sigma: 0.033, a: 0.4, r: 0.7, gamma: 0.7, m: 0.001, mu: 0.001, zmort: 0.05, gmax: 0.5 };
const C_PER_N = 6.625 * 12.01; // mg C per mmol N

/** NPZD (nitrogen) in a mixed box + one E2E fish group (carbon, depth-integrated) feeding on Z. */
export function runBox(p: BoxParams) {
  const days = Math.round(p.years * 365);
  let N = p.nut0, P = 0.3, Z = 0.2, D = 0.5, F = p.fish === "none" ? 0 : p.fish0;
  const out = { t: [] as number[], N: [] as number[], P: [] as number[], Z: [] as number[], D: [] as number[], F: [] as number[], npp: [] as number[], fcons: [] as number[] };
  const dt = 0.1;
  const steps = days / dt;
  let nppAcc = 0, consAcc = 0;
  for (let s = 0; s < steps; s++) {
    const day = s * dt;
    const doy = day % 365;
    const T = 11 - 5 * Math.cos((2 * Math.PI * (doy - 30)) / 365);
    const I0 = Math.max(0, 140 * (0.55 - 0.45 * Math.cos((2 * Math.PI * (doy - 10)) / 365)));
    // mixed-layer light: deep winter mixing dilutes light
    const mld = 15 + 40 * Math.max(0, Math.cos((2 * Math.PI * (doy - 20)) / 365));
    const hmix = Math.min(p.H, mld);
    const kd = 0.08 + 0.03 * P;
    const Iav = (I0 / (kd * hmix)) * (1 - Math.exp(-kd * hmix));
    const fT = Math.pow(1.066, T - 10);
    const mu = 1.2 * fT * (Iav / (Iav + 35)) * (N / (N + 0.5));
    const uptake = mu * P;
    const graz = p.gmax * fT * (P * P) / (1 + P * P) * Z;
    const zmort = p.zmort * Z + 0.02 * Z * Z;
    const remin = 0.05 * fT * D;
    const pmort = 0.03 * P;
    // fish (E2E Eq. 6-14, depth-averaged food)
    const Zc = Z * C_PER_N; // mg C m-3
    const food = p.a * Zc;
    const rMg = p.r * 12.011;
    const G = (p.sigma * p.a * Zc) / (rMg + food); // d-1 per fish carbon (per m3 equivalent)
    const consC = F * G; // mg C m-2 d-1 (fish biomass integrated, prey depth-averaged)
    const consN_vol = p.fish === "two_way" ? consC / C_PER_N / p.H : 0; // mmol N m-3 d-1 removed from Z
    const growth = p.gamma * consC;
    const exc = p.mu * F;
    const fm = p.m * F;
    const wasteN = p.fish === "two_way" ? ((1 - p.gamma) * consC + fm) / C_PER_N / p.H : 0;
    const excN = p.fish === "two_way" ? exc / C_PER_N / p.H : 0;
    const dN = -uptake + remin + 0.3 * zmort + excN;
    const dP = uptake - graz - pmort;
    const dZ = 0.3 * graz - zmort - consN_vol;
    const dD = 0.7 * graz + pmort + 0.7 * zmort - remin + wasteN;
    const dF = p.fish === "none" ? 0 : growth - exc - fm;
    N = Math.max(1e-6, N + dt * dN);
    P = Math.max(1e-6, P + dt * dP);
    Z = Math.max(1e-6, Z + dt * dZ);
    D = Math.max(0, D + dt * dD);
    F = Math.max(0, F + dt * dF);
    nppAcc += uptake * dt;
    consAcc += consC * dt;
    if (s % 10 === 0) {
      out.t.push(day);
      out.N.push(N); out.P.push(P); out.Z.push(Z); out.D.push(D); out.F.push(F);
      out.npp.push(nppAcc); out.fcons.push(consAcc);
      nppAcc = 0; consAcc = 0;
    }
  }
  return out;
}

export function lastYearMean(t: number[], x: number[], years: number) {
  const t0 = (years - 1) * 365;
  const v = x.filter((_, i) => t[i] >= t0);
  return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
}

export function lastYearMax(t: number[], x: number[], years: number) {
  const t0 = (years - 1) * 365;
  return Math.max(...x.filter((_, i) => t[i] >= t0));
}

// Log-normal prey preference (Powley et al. S10)
export function preference(wPred: number, wPrey: number, beta: number, sigma: number) {
  const x = Math.log((beta * wPrey) / wPred);
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

// Average preference over a prey's mass window (S12), uniform in log mass
export function windowPreference(wPred: number, wMin: number, wMax: number, beta: number, sigma: number) {
  const n = 60;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const lw = Math.log(wMin) + ((i + 0.5) / n) * (Math.log(wMax) - Math.log(wMin));
    s += preference(wPred, Math.exp(lw), beta, sigma);
  }
  return s / n;
}

export const BOLTZMANN = 8.617333262e-5;
