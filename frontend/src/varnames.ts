// Chinese names for model output variables, so lists, titles and legends speak the reader's language.
// The English long name from the model stays available as a tooltip.

const EXACT: Record<string, string> = {
  // physics and forcing
  temp: "温度", salt: "盐度", mld_surf: "表层混合层深度", mld_bott: "底层混合层深度", NN: "浮力频率平方（层化强度）", SS: "流速切变平方",
  nuh: "热扩散系数", num: "动量扩散系数", nus: "盐扩散系数", tke: "湍动能", eps: "湍动能耗散率", taub: "海底切应力",
  u10: "10 m 风速（东向）", v10: "10 m 风速（北向）", airt: "2 m 气温", airp: "海面气压", hum: "空气湿度", cloud: "云量", precip: "降水",
  rad: "向下短波辐射", I_0: "海面短波辐射", par: "光合有效辐射", PAR: "光合有效辐射", u: "东向流速", v: "北向流速", zeta: "海面高度", h: "层厚",
  tx: "东向风应力", ty: "北向风应力", heat: "海面净热通量", sst: "海表温度", sss: "海表盐度",
  // ERSEM nutrients and carbonate system
  N1_p: "磷酸盐", N3_n: "硝酸盐", N4_n: "铵盐", N5_s: "硅酸盐", N7_f: "溶解铁", O2_o: "溶解氧", O3_c: "溶解无机碳", O3_TA: "总碱度", O3_pH: "pH",
  O3_fair: "海气 CO₂ 通量", O3_pCO2: "海水 CO₂ 分压",
  // ERSEM plankton, bacteria, organic matter, benthos
  P1_Chl: "硅藻叶绿素", P2_Chl: "微型浮游植物叶绿素", P3_Chl: "超微型浮游植物叶绿素", P4_Chl: "小型浮游植物叶绿素", total_chlorophyll_calculator_result: "总叶绿素",
  // higher trophic levels
  F1_c: "鱼 1（浮游食性）", F2_c: "鱼 2（底栖 / 鱼食性）", MB_c: "大型底栖动物", fish_c_tot: "鱼类群落（粒径谱）", fish_c: "鱼类（粒径谱）",
  F1_consumption: "鱼 1 摄食量", F2_consumption: "鱼 2 摄食量", MB_consumption: "大型底栖摄食量", F1_production: "鱼 1 生产量", F2_production: "鱼 2 生产量",
  fish_landings: "渔获量", fish_c_size1: "体重 <10 g 的鱼", fish_c_size2: "体重 <80 g 的鱼", fish_c_size3: "体重 <1 kg 的鱼",
  // ECOSMO
  ECO_no3: "硝酸盐", ECO_nh4: "铵盐", ECO_pho: "磷酸盐", ECO_sil: "硅酸盐", ECO_oxy: "溶解氧", ECO_dia: "硅藻", ECO_fla: "鞭毛藻", ECO_bg: "蓝藻",
  ECO_microzoo: "微型浮游动物", ECO_mesozoo: "中型浮游动物", ECO_det: "碎屑", ECO_dom: "溶解有机物", ECO_opa: "生物硅（蛋白石）", ECO_primprod: "初级生产",
  ECO_sed1: "沉积物有机氮", ECO_sed2: "沉积物生物硅", ECO_sed3: "沉积物磷",
  // ERGOM
  ergom_nn: "硝酸盐", ergom_aa: "铵盐", ergom_po: "磷酸盐", ergom_o2: "溶解氧", ergom_pp: "大型浮游植物（硅藻）", ergom_ff: "鞭毛藻", ergom_bb: "蓝藻",
  ergom_zz: "浮游动物", ergom_dd: "碎屑", ergom_fl: "沉积物有机物", ergom_tot_chla: "总叶绿素", ergom_GPP: "总初级生产", ergom_NPR: "净初级生产",
};

// ERSEM functional types: base name × chemical element
const BASE: Record<string, string> = {
  P1: "硅藻", P2: "微型浮游植物", P3: "超微型浮游植物", P4: "小型浮游植物", Z4: "中型浮游动物", Z5: "微型浮游动物", Z6: "异养鞭毛虫",
  B1: "细菌", R1: "易降解溶解有机物", R2: "半易降解溶解有机物", R3: "半难降解溶解有机物", R4: "小颗粒有机物", R6: "中颗粒有机物", R8: "大颗粒有机物",
  Q1: "沉积物溶解有机物", Q6: "沉积物颗粒有机物", Q7: "沉积物难降解有机物", Q17: "沉积物难降解有机物", Y2: "沉积食性底栖动物", Y3: "滤食性底栖动物",
  Y4: "小型底栖动物", H1: "好氧底栖细菌", H2: "厌氧底栖细菌", L2: "钙化浮游植物（碳酸钙）",
};
const ELEM: Record<string, string> = { c: "碳", n: "氮", p: "磷", s: "硅", f: "铁", Chl: "叶绿素" };

/** Chinese name of a model variable, or null if we don't know it (callers then fall back to the model's long name). */
export function varName(name: string): string | null {
  if (EXACT[name]) return EXACT[name];
  const m = /^([A-Z]\d{1,2})_(c|n|p|s|f|Chl)$/.exec(name);
  if (m && BASE[m[1]]) return `${BASE[m[1]]}${m[2] === "c" ? "（碳）" : ELEM[m[2]] ? `（${ELEM[m[2]]}）` : ""}`;
  if (/^fish_c\d+$/.test(name)) return `鱼类第 ${name.slice(6)} 粒径级`;
  return null;
}

/** "中型浮游动物（碳）" with the code kept for people who know it: used for legends and titles. */
export function varLabel(name: string, longName?: string): string {
  return varName(name) ?? longName ?? name;
}
