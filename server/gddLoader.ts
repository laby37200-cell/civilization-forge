import fs from "node:fs";
import path from "node:path";
import { CityGradeStats, CitiesInitialData, type CityGrade, type SpecialtyType } from "@shared/schema";

export interface GDDA_CityRow {
  nationId: string;
  nationNameKo: string;
  nameKo: string;
  grade: CityGrade;
  initialTroops: number;
  initialGold: number;
  initialFood: number;
  specialtyType: SpecialtyType;
  specialtyAmount: number;
}

const DEFAULT_GDD_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "attached_assets",
  "integrated_gdd_v11_full_1767165854504.md"
);

const nationKoToId: Record<string, string> = {
  "한국": "korea",
  "일본": "japan",
  "중국": "china",
  "러시아": "russia",
  "태국": "thailand",
  "베트남": "vietnam",
  "인도네시아": "indonesia",
  "싱가포르/말레이시아": "singapore_malaysia",
  "인도": "india",
  "파키스탄": "pakistan",
  "터키": "turkey",
  "UAE": "uae",
  "이집트": "egypt",
  "영국": "uk",
  "프랑스": "france",
  "독일": "germany",
  "이탈리아": "italy",
  "스페인": "spain",
  "미국": "usa",
  "브라질": "brazil",
};

const gradeKoToGrade: Record<string, CityGrade> = {
  "수도": "capital",
  "주요 도시": "major",
  "주요도시": "major",
  "일반 도시": "normal",
  "일반도시": "normal",
  "작은 마을": "town",
  "작은마을": "town",
};

function parseNumber(value: string): number {
  const cleaned = value.replace(/,/g, "").replace(/\s/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function mapSpecialtyKoToType(s: string): SpecialtyType {
  const name = s
    .replace(/\(.*?\)/g, "")
    .replace(/\*+/g, "")
    .trim();

  if (["쌀", "밀", "쌀/밀", "곡물"].includes(name)) return "rice_wheat";
  if (name === "해산물") return "seafood";
  if (["비단", "직물", "면직물"].includes(name)) return "silk";
  if (name === "도자기") return "pottery";
  if (name === "향신료") return "spices";
  if (name === "철" || name === "철광석") return "iron_ore";
  if (name === "목재") return "wood";
  if (name === "소금") return "salt";
  if (name === "금" || name === "보석" || name === "금/보석") return "gold_gems";
  if (name === "말" || name.includes("군마")) return "horses";
  if (name === "약재") return "medicine";
  if (name === "차") return "tea";
  if (name === "포도주") return "wine";
  if (name === "술") return "alcohol";
  if (name === "종이" || name === "문서" || name === "종이/문서") return "paper";
  if (name === "모피") return "fur";
  if (name === "무기" || name === "무기/화약" || name === "화약") return "weapons";

  // Fallbacks
  return "rice_wheat";
}

export function loadAppendixA_Cities(gddPath: string = DEFAULT_GDD_PATH): GDDA_CityRow[] {
  let md: string;
  try {
    md = fs.readFileSync(gddPath, "utf-8");
  } catch (e) {
    console.warn(`[gddLoader] Failed to read GDD at ${gddPath}. Falling back to CitiesInitialData.`, e);
    return CitiesInitialData.map((c) => {
      const stats = CityGradeStats[c.grade];
      return {
        nationId: c.nationId,
        nationNameKo: c.nationId,
        nameKo: c.nameKo,
        grade: c.grade,
        initialTroops: stats?.initialTroops ?? 200,
        initialGold: 5000,
        initialFood: 3000,
        specialtyType: "rice_wheat",
        specialtyAmount: 0,
      } satisfies GDDA_CityRow;
    });
  }

  const appendixStartIdx = md.indexOf("# 부록 A: 국가/도시 상세 데이터");
  if (appendixStartIdx < 0) {
    console.warn(`[gddLoader] Appendix A not found in GDD. Falling back to CitiesInitialData.`);
    return CitiesInitialData.map((c) => {
      const stats = CityGradeStats[c.grade];
      return {
        nationId: c.nationId,
        nationNameKo: c.nationId,
        nameKo: c.nameKo,
        grade: c.grade,
        initialTroops: stats?.initialTroops ?? 200,
        initialGold: 5000,
        initialFood: 3000,
        specialtyType: "rice_wheat",
        specialtyAmount: 0,
      } satisfies GDDA_CityRow;
    });
  }

  const appendixBIdx = md.indexOf("# 부록 B:", appendixStartIdx);
  const appendixText = appendixBIdx > 0 ? md.slice(appendixStartIdx, appendixBIdx) : md.slice(appendixStartIdx);

  const lines = appendixText.split(/\r?\n/);

  let currentNationKo: string | null = null;
  const out: GDDA_CityRow[] = [];

  for (const line of lines) {
    const nationMatch = line.match(/^###\s+.*?\.?\s*([^\(]+?)\s*\(.*?도시\)/);
    if (nationMatch) {
      const nationKo = nationMatch[1].trim();
      if (nationKoToId[nationKo]) {
        currentNationKo = nationKo;
      } else {
        // Some headings include region number prefix; keep raw
        currentNationKo = nationKo;
      }
      continue;
    }

    if (!line.startsWith("|")) continue;
    if (line.includes(":---")) continue;
    if (line.includes("도시명") && line.includes("등급")) continue;

    // | **서울** | 수도 | 2,000 | 8,000 | 5,000 | 쌀 (500) | ... |
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (cols.length < 6) continue;
    if (!currentNationKo) continue;

    const cityKo = cols[0].replace(/\*+/g, "").trim();
    const gradeKo = cols[1].replace(/\*+/g, "").trim();
    const grade = gradeKoToGrade[gradeKo];
    if (!grade) continue;

    const initialTroops = parseNumber(cols[2]);
    const initialGold = parseNumber(cols[3]);
    const initialFood = parseNumber(cols[4]);

    const specialtyCol = cols[5];
    const amountMatch = specialtyCol.match(/\((\d+)\)/);
    const specialtyAmount = amountMatch ? parseNumber(amountMatch[1]) : 0;
    const specialtyType = mapSpecialtyKoToType(specialtyCol);

    const nationId = nationKoToId[currentNationKo];
    if (!nationId) continue;

    out.push({
      nationId,
      nationNameKo: currentNationKo,
      nameKo: cityKo,
      grade,
      initialTroops,
      initialGold,
      initialFood,
      specialtyType,
      specialtyAmount,
    });
  }

  if (out.length === 0) {
    console.warn(`[gddLoader] Parsed 0 city rows from GDD at ${gddPath}. Falling back to CitiesInitialData.`);
    return CitiesInitialData.map((c) => {
      const stats = CityGradeStats[c.grade];
      return {
        nationId: c.nationId,
        nationNameKo: c.nationId,
        nameKo: c.nameKo,
        grade: c.grade,
        initialTroops: stats?.initialTroops ?? 200,
        initialGold: 5000,
        initialFood: 3000,
        specialtyType: "rice_wheat",
        specialtyAmount: 0,
      } satisfies GDDA_CityRow;
    });
  }

  return out;
}
