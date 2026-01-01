import { UnitStats, type UnitTypeDB } from "@shared/schema";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// GDD 11장: 병과 상성 (가위바위보 시스템)
// 보병 > 궁병 > 기병 > 보병
// 공성은 도시 공격 특화, 해군은 바다 전용
function getUnitTypeBonus(
  myType: UnitTypeDB,
  enemyTroops: Record<UnitTypeDB, number>,
  terrain: string,
  isCity: boolean
): number {
  let bonus = 1.0;
  
  const enemyTotal = Object.values(enemyTroops).reduce((a, b) => a + b, 0);
  if (enemyTotal === 0) return bonus;

  // 적 병과 비율 계산
  const enemyInfantryRatio = (enemyTroops.infantry ?? 0) / enemyTotal;
  const enemyCavalryRatio = (enemyTroops.cavalry ?? 0) / enemyTotal;
  const enemyArcherRatio = (enemyTroops.archer ?? 0) / enemyTotal;

  // 상성 적용
  switch (myType) {
    case "infantry":
      // 보병 > 궁병 (1.2배), 보병 < 기병 (0.8배)
      bonus += enemyArcherRatio * 0.2;
      bonus -= enemyCavalryRatio * 0.2;
      break;
    case "cavalry":
      // 기병 > 보병 (1.2배), 기병 < 궁병 (0.8배)
      bonus += enemyInfantryRatio * 0.2;
      bonus -= enemyArcherRatio * 0.2;
      break;
    case "archer":
      // 궁병 > 기병 (1.2배), 궁병 < 보병 (0.8배)
      bonus += enemyCavalryRatio * 0.2;
      bonus -= enemyInfantryRatio * 0.2;
      break;
    case "siege":
      // 공성: 도시 공격 시 보너스
      if (isCity) bonus += 0.3;
      break;
    case "navy":
      // 해군: 바다에서만 유효
      if (terrain === "sea") bonus += 0.25;
      else bonus -= 0.5;
      break;
    case "spy":
      // 첩보: 전투력 없음
      bonus = 0.1;
      break;
  }

  return Math.max(0.5, Math.min(1.5, bonus));
}

interface BattleInput {
  attackerTroops: Record<UnitTypeDB, number>;
  defenderTroops: Record<UnitTypeDB, number>;
  attackerStrategy: string;
  defenderStrategy: string;
  terrain: string;
  isCity: boolean;
  cityDefenseLevel?: number;
}

interface BattleResult {
  result: "attacker_win" | "defender_win" | "draw";
  attackerLosses: Record<UnitTypeDB, number>;
  defenderLosses: Record<UnitTypeDB, number>;
  narrative: string;
}

function getTerrainMultiplier(terrain: string, unitType: UnitTypeDB, side: "attacker" | "defender"): number {
  // Keep this simple and predictable: small multipliers only.
  switch (terrain) {
    case "mountain":
    case "hill":
      return side === "defender" ? 1.12 : 0.95;
    case "forest":
    case "deep_forest":
      if (unitType === "archer" || unitType === "spy") return 1.08;
      return side === "defender" ? 1.06 : 0.98;
    case "plains":
    case "grassland":
      if (unitType === "cavalry") return 1.1;
      return 1.0;
    case "desert":
      return unitType === "cavalry" ? 0.95 : 0.98;
    case "sea":
      if (unitType === "navy") return 1.15;
      return unitType === "siege" ? 0.9 : 0.95;
    default:
      return 1.0;
  }
}

function calculateStatsScore(input: BattleInput): { attackerPower: number; defenderPower: number; statsScore: number } {
  const attackerPower = (Object.entries(input.attackerTroops) as Array<[UnitTypeDB, number]>).reduce(
    (sum, [type, count]) => {
      const base = UnitStats[type]?.attack ?? 1;
      const terrainMult = getTerrainMultiplier(input.terrain, type, "attacker");
      const typeMult = getUnitTypeBonus(type, input.defenderTroops, input.terrain, input.isCity);
      return sum + count * base * terrainMult * typeMult;
    },
    0
  );

  const defenderTerrainPower = (Object.entries(input.defenderTroops) as Array<[UnitTypeDB, number]>).reduce(
    (sum, [type, count]) => {
      const base = UnitStats[type]?.defense ?? 1;
      const terrainMult = getTerrainMultiplier(input.terrain, type, "defender");
      const typeMult = getUnitTypeBonus(type, input.attackerTroops, input.terrain, input.isCity);
      return sum + count * base * terrainMult * typeMult;
    },
    0
  );

  const cityBonus = input.isCity ? 1 + Math.min(0.35, (input.cityDefenseLevel ?? 0) * 0.03) : 1.0;
  const defenderPower = defenderTerrainPower * cityBonus;

  const denom = attackerPower + defenderPower;
  const statsScore = denom > 0 ? attackerPower / denom : 0.5;

  return { attackerPower, defenderPower, statsScore };
}

function normalizeCombat70(attackerPower: number, defenderPower: number): { attacker70: number; defender70: number } {
  const denom = attackerPower + defenderPower;
  const attackerRatio = denom > 0 ? attackerPower / denom : 0.5;
  const attacker70 = 70 * attackerRatio;
  return { attacker70, defender70: 70 - attacker70 };
}

function isMeaningfulStrategyText(text: string): boolean {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  return trimmed.split(/\s+/).length > 2;
}

function clampInt(n: number, min: number, max: number): number {
  const x = Math.floor(n);
  return Math.max(min, Math.min(max, x));
}

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function getLossRatioRangeByPowerRatio(powerRatio: number): { winner: [number, number]; loser: [number, number] } {
  if (powerRatio >= 2.0) return { winner: [0.10, 0.20], loser: [0.80, 1.00] };
  if (powerRatio >= 1.5) return { winner: [0.20, 0.30], loser: [0.60, 0.80] };
  if (powerRatio >= 1.2) return { winner: [0.30, 0.40], loser: [0.50, 0.60] };
  return { winner: [0.40, 0.50], loser: [0.50, 0.60] };
}

async function judgeStrategyScores(input: BattleInput, attackerPower: number, defenderPower: number): Promise<{ attacker: number; defender: number; narrative: string }>{
  const totalTroops = Object.values({ ...input.attackerTroops, ...input.defenderTroops }).reduce((a, b) => a + (b ?? 0), 0);
  const attackerHasStrategy = isMeaningfulStrategyText(input.attackerStrategy);
  const defenderHasStrategy = isMeaningfulStrategyText(input.defenderStrategy);

  if (!attackerHasStrategy && !defenderHasStrategy) {
    return { attacker: 0, defender: 0, narrative: "치열한 전투가 벌어졌습니다." };
  }

  if (totalTroops < 500) {
    return { attacker: attackerHasStrategy ? 15 : 0, defender: defenderHasStrategy ? 15 : 0, narrative: "치열한 전투가 벌어졌습니다." };
  }

  const prompt = `당신은 전략 게임의 전투 심판관입니다. 아래 전투에서 양측의 전략 텍스트를 평가하여 점수만 산출하세요.

## 전투 상황
- 지형: ${input.terrain}${input.isCity ? ` (도시 방어 레벨: ${input.cityDefenseLevel || 0})` : ""}

## 공격군
병력: ${JSON.stringify(input.attackerTroops)}
전략: "${input.attackerStrategy || ""}"
능력치 기반 전투력(공격): ${attackerPower.toFixed(2)}

## 수비군
병력: ${JSON.stringify(input.defenderTroops)}
전략: "${input.defenderStrategy || ""}"
능력치 기반 전투력(방어): ${defenderPower.toFixed(2)}

## 요청
1) 공격자 전략 점수(attackerScore)를 0~30 정수로 채점하세요.
2) 방어자 전략 점수(defenderScore)를 0~30 정수로 채점하세요.
3) 배점 기준은 다음을 참고하세요:
- 지형 일치성(0~10)
- 병과 연계성(0~5)
- 병법 논리성(0~10)
- 첩보 카운터(0~5) (방어자에게 특히 중요)
4) 전략 텍스트가 비어 있거나 1~2단어이면 해당 측 점수는 0점입니다.
5) 반드시 아래 JSON 형식으로만 응답하세요(반드시 유효한 JSON):
{"attackerScore": 0, "defenderScore": 0, "narrative": "전투 서술 (2-3문장)"}`;

  let llmResponse = await callGeminiAPI(prompt);
  if (!llmResponse) {
    llmResponse = await callDeepseekAPI(prompt);
  }

  let attackerScore = attackerHasStrategy ? 15 : 0;
  let defenderScore = defenderHasStrategy ? 15 : 0;
  let narrative = "치열한 전투가 벌어졌습니다.";

  if (llmResponse) {
    try {
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.attackerScore === "number") attackerScore = clampInt(parsed.attackerScore, 0, 30);
        if (typeof parsed.defenderScore === "number") defenderScore = clampInt(parsed.defenderScore, 0, 30);
        if (typeof parsed.narrative === "string" && parsed.narrative.trim()) narrative = parsed.narrative;
      }
    } catch (e) {
      console.error("[LLM] Failed to parse response:", e);
    }
  }

  if (!attackerHasStrategy) attackerScore = 0;
  if (!defenderHasStrategy) defenderScore = 0;

  return { attacker: attackerScore, defender: defenderScore, narrative };
}

function calculateLosses(
  troops: Record<UnitTypeDB, number>,
  lossRatio: number
): Record<UnitTypeDB, number> {
  const losses: Record<UnitTypeDB, number> = {
    infantry: 0,
    cavalry: 0,
    archer: 0,
    siege: 0,
    navy: 0,
    spy: 0,
  };
  for (const [type, count] of Object.entries(troops)) {
    losses[type as UnitTypeDB] = Math.floor(count * lossRatio * (0.8 + Math.random() * 0.4));
  }
  return losses;
}

async function callGeminiAPI(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          },
        }),
      }
    );
    
    if (!response.ok) {
      console.error("[LLM] Gemini API error:", response.status);
      return null;
    }
    
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("[LLM] Gemini API error:", error);
    return null;
  }
}

async function callDeepseekAPI(prompt: string): Promise<string | null> {
  if (!DEEPSEEK_API_KEY) return null;
  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });
    
    if (!response.ok) {
      console.error("[LLM] Deepseek API error:", response.status);
      return null;
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    console.error("[LLM] Deepseek API error:", error);
    return null;
  }
}

export async function judgeBattle(input: BattleInput): Promise<BattleResult> {
  const { attackerPower, defenderPower } = calculateStatsScore(input);
  const { attacker70, defender70 } = normalizeCombat70(attackerPower, defenderPower);
  const strategy = await judgeStrategyScores(input, attackerPower, defenderPower);

  const attackerFinal = attacker70 + strategy.attacker;
  const defenderFinal = defender70 + strategy.defender;

  const winner: "attacker" | "defender" | "draw" =
    attackerFinal > defenderFinal + 2 ? "attacker" : defenderFinal > attackerFinal + 2 ? "defender" : "draw";

  let attackerLossRatio = 0.22;
  let defenderLossRatio = 0.22;

  if (winner === "attacker" || winner === "defender") {
    const w = winner === "attacker" ? attackerFinal : defenderFinal;
    const l = winner === "attacker" ? defenderFinal : attackerFinal;
    const ratio = l > 0 ? w / l : 99;
    const ranges = getLossRatioRangeByPowerRatio(ratio);
    const wLoss = randomInRange(ranges.winner[0], ranges.winner[1]);
    const lLoss = randomInRange(ranges.loser[0], ranges.loser[1]);
    if (winner === "attacker") {
      attackerLossRatio = wLoss;
      defenderLossRatio = lLoss;
    } else {
      attackerLossRatio = lLoss;
      defenderLossRatio = wLoss;
    }
  } else {
    attackerLossRatio = randomInRange(0.40, 0.50);
    defenderLossRatio = randomInRange(0.50, 0.60);
  }

  return {
    result: winner === "attacker" ? "attacker_win" : winner === "defender" ? "defender_win" : "draw",
    attackerLosses: calculateLosses(input.attackerTroops, attackerLossRatio),
    defenderLosses: calculateLosses(input.defenderTroops, defenderLossRatio),
    narrative: strategy.narrative,
  };
}

export async function generateNewsNarrative(event: {
  type: "battle" | "diplomacy" | "espionage" | "economy";
  data: Record<string, unknown>;
}): Promise<string> {
  const prompts: Record<string, string> = {
    battle: `전투 결과를 뉴스 형식으로 1문장 작성: ${JSON.stringify(event.data)}`,
    diplomacy: `외교 이벤트를 뉴스 형식으로 1문장 작성: ${JSON.stringify(event.data)}`,
    espionage: `첩보 활동을 뉴스 형식으로 1문장 작성: ${JSON.stringify(event.data)}`,
    economy: `경제 이벤트를 뉴스 형식으로 1문장 작성: ${JSON.stringify(event.data)}`,
  };

  const prompt = prompts[event.type] || "이벤트를 뉴스 형식으로 1문장 작성";
  
  let response = await callGeminiAPI(prompt);
  if (!response) {
    response = await callDeepseekAPI(prompt);
  }
  
  return response || "새로운 소식이 전해졌습니다.";
}
