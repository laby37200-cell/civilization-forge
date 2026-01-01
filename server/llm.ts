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
  const { attackerPower, defenderPower, statsScore } = calculateStatsScore(input);

  const prompt = `당신은 전략 게임의 전투 심판관입니다. 아래 전투에서 **전략 텍스트의 유효성**을 평가해 점수로만 답하세요.

## 전투 상황
- 지형: ${input.terrain}${input.isCity ? ` (도시 방어 레벨: ${input.cityDefenseLevel || 0})` : ""}

## 공격군
병력: ${JSON.stringify(input.attackerTroops)}
전략: "${input.attackerStrategy || "기본 공격"}"
능력치 기반 전투력(공격): ${attackerPower.toFixed(2)}

## 수비군
병력: ${JSON.stringify(input.defenderTroops)}
전략: "${input.defenderStrategy || "기본 방어"}"
능력치 기반 전투력(방어): ${defenderPower.toFixed(2)}

## 능력치 기반 우세도
공격군 우세도(statsScore): ${statsScore.toFixed(4)} (0=수비 압도, 0.5=균형, 1=공격 압도)

## 요청
1. 전략 텍스트를 아래 세부 항목으로 평가하고, 각 항목을 0~1 점수로 환산后 평균을 내어 strategyScore(0~1)를 계산하세요.
   - 지형 일치성: 지형에 맞는 병과/전술 사용 여부
   - 병과 연계성: 보병-기병-궁수 연계 등 조합 전술
   - 심리전/기만: 거짓 철수/매복 등 심리전 활용
   - 첩보 활용: 첩보 병과를 통한 정보 우위
   - 창의성/예측 불가능성: 예상 밖의 전략
   - 만약 전략이 비어 있거나 1~2 단어라면 0점 처리
2. 반드시 아래 JSON 형식으로만 응답하세요:
{"strategyScore": 0.0~1.0, "narrative": "전투 서술 (2-3문장)"}`;

  let llmResponse = await callGeminiAPI(prompt);
  if (!llmResponse) {
    llmResponse = await callDeepseekAPI(prompt);
  }

  // Spec: finalScore = 0.7 * statsScore + 0.3 * strategyScore
  // GDD 13장: 전략 미입력 시 0점 처리
  let strategyScore = 0;
  let narrative = "치열한 전투가 벌어졌습니다.";

  // 전략 미입력 여부 확인 (비어있거나 1~2 단어)
  const hasAttackerStrategy = input.attackerStrategy && input.attackerStrategy.trim().split(/\s+/).length > 2;
  const hasDefenderStrategy = input.defenderStrategy && input.defenderStrategy.trim().split(/\s+/).length > 2;

  if (!hasAttackerStrategy && !hasDefenderStrategy) {
    strategyScore = 0; // 양측 모두 미입력
  } else if (!hasAttackerStrategy || !hasDefenderStrategy) {
    strategyScore = 0.2; // 한쪽만 미입력 (소량 페널티)
  } else {
    // 양측 모두 전략 입력: LLM 평가
    if (llmResponse) {
      try {
        const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (typeof parsed.strategyScore === "number") {
            strategyScore = Math.max(0, Math.min(1, parsed.strategyScore));
          }
          if (parsed.narrative) narrative = parsed.narrative;
        }
      } catch (e) {
        console.error("[LLM] Failed to parse response:", e);
      }
    }
  }

  const finalScore = 0.7 * statsScore + 0.3 * strategyScore;
  const winner: "attacker" | "defender" | "draw" =
    finalScore > 0.55 ? "attacker" : finalScore < 0.45 ? "defender" : "draw";

  // Losses scale with how decisive the outcome is.
  const decisiveness = Math.min(1, Math.abs(finalScore - 0.5) * 2); // 0..1
  const attackerLossRatio =
    winner === "attacker" ? 0.12 + 0.10 * (1 - decisiveness) : winner === "defender" ? 0.35 + 0.15 * decisiveness : 0.22;
  const defenderLossRatio =
    winner === "defender" ? 0.12 + 0.10 * (1 - decisiveness) : winner === "attacker" ? 0.35 + 0.20 * decisiveness : 0.22;

  return {
    result: winner === "attacker" ? "attacker_win" : winner === "defender" ? "defender_win" : "draw",
    attackerLosses: calculateLosses(input.attackerTroops, attackerLossRatio),
    defenderLosses: calculateLosses(input.defenderTroops, defenderLossRatio),
    narrative,
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
