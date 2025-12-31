import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3-flash-preview";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export interface BattleInput {
  attackerTroops: { infantry: number; cavalry: number; archer: number; siege: number };
  defenderTroops: { infantry: number; cavalry: number; archer: number; siege: number };
  terrain: string;
  attackerStrategy: string;
  defenderStrategy: string;
  cityDefenseLevel: number;
}

export interface BattleResult {
  winner: "attacker" | "defender" | "draw";
  attackerLosses: { infantry: number; cavalry: number; archer: number; siege: number };
  defenderLosses: { infantry: number; cavalry: number; archer: number; siege: number };
  narrative: string;
}

export async function resolveBattle(input: BattleInput): Promise<BattleResult> {
  const prompt = `You are a battle resolution AI for a turn-based strategy game.

Given the following battle scenario, determine the outcome:

ATTACKER FORCES:
- Infantry: ${input.attackerTroops.infantry}
- Cavalry: ${input.attackerTroops.cavalry}
- Archer: ${input.attackerTroops.archer}
- Siege: ${input.attackerTroops.siege}
- Strategy: ${input.attackerStrategy}

DEFENDER FORCES:
- Infantry: ${input.defenderTroops.infantry}
- Cavalry: ${input.defenderTroops.cavalry}
- Archer: ${input.defenderTroops.archer}
- Siege: ${input.defenderTroops.siege}
- Strategy: ${input.defenderStrategy}
- City Defense Level: ${input.cityDefenseLevel}

TERRAIN: ${input.terrain}

Consider:
1. Terrain advantages (mountains favor defenders, plains favor cavalry)
2. Unit type matchups (cavalry beats archers, infantry beats cavalry, archers beat infantry at range)
3. City defense bonuses
4. Strategy effectiveness

Respond with ONLY a valid JSON object in this exact format:
{
  "winner": "attacker" or "defender" or "draw",
  "attackerLosses": {"infantry": number, "cavalry": number, "archer": number, "siege": number},
  "defenderLosses": {"infantry": number, "cavalry": number, "archer": number, "siege": number},
  "narrative": "Brief description of the battle outcome in Korean (2-3 sentences)"
}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const result = JSON.parse(jsonMatch[0]) as BattleResult;
    return result;
  } catch (error) {
    console.error("[gemini] Battle resolution error:", error);
    return calculateFallbackResult(input);
  }
}

function calculateFallbackResult(input: BattleInput): BattleResult {
  const attackerPower =
    input.attackerTroops.infantry * 1 +
    input.attackerTroops.cavalry * 1.5 +
    input.attackerTroops.archer * 1.2 +
    input.attackerTroops.siege * 2;

  const defenderBonus = 1 + input.cityDefenseLevel * 0.1;
  const defenderPower =
    (input.defenderTroops.infantry * 1 +
      input.defenderTroops.cavalry * 1.5 +
      input.defenderTroops.archer * 1.2 +
      input.defenderTroops.siege * 0.5) *
    defenderBonus;

  const ratio = attackerPower / (defenderPower || 1);
  let winner: "attacker" | "defender" | "draw";
  let lossRatio: number;

  if (ratio > 1.5) {
    winner = "attacker";
    lossRatio = 0.3;
  } else if (ratio < 0.67) {
    winner = "defender";
    lossRatio = 0.5;
  } else {
    winner = "draw";
    lossRatio = 0.4;
  }

  return {
    winner,
    attackerLosses: {
      infantry: Math.floor(input.attackerTroops.infantry * lossRatio),
      cavalry: Math.floor(input.attackerTroops.cavalry * lossRatio),
      archer: Math.floor(input.attackerTroops.archer * lossRatio),
      siege: Math.floor(input.attackerTroops.siege * lossRatio * 0.5),
    },
    defenderLosses: {
      infantry: Math.floor(input.defenderTroops.infantry * lossRatio * 0.8),
      cavalry: Math.floor(input.defenderTroops.cavalry * lossRatio * 0.8),
      archer: Math.floor(input.defenderTroops.archer * lossRatio * 0.8),
      siege: Math.floor(input.defenderTroops.siege * lossRatio * 0.4),
    },
    narrative:
      winner === "attacker"
        ? "공격군이 승리하여 방어선을 돌파했습니다."
        : winner === "defender"
          ? "방어군이 공격을 성공적으로 막아냈습니다."
          : "양측 모두 큰 피해를 입고 교착 상태가 되었습니다.",
  };
}

export async function generateAIMove(
  nationId: string,
  gameState: {
    ownedCities: string[];
    troops: number;
    gold: number;
    enemies: string[];
    allies: string[];
  },
  difficulty: "easy" | "normal" | "hard"
): Promise<{ actionType: string; targetId: string; reason: string }> {
  const prompt = `You are an AI player in a turn-based strategy game, playing as ${nationId}.
Difficulty: ${difficulty}

Your current state:
- Cities: ${gameState.ownedCities.join(", ")}
- Total troops: ${gameState.troops}
- Gold: ${gameState.gold}
- Enemies: ${gameState.enemies.join(", ") || "none"}
- Allies: ${gameState.allies.join(", ") || "none"}

Based on ${difficulty} difficulty, decide your next action.
For easy: Make conservative, defensive moves
For normal: Balance offense and defense
For hard: Aggressive expansion and optimal resource management

Respond with ONLY a valid JSON object:
{
  "actionType": "attack" or "defend" or "build" or "recruit" or "trade",
  "targetId": "target city or player id",
  "reason": "Brief reasoning in Korean"
}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const text = response.text?.trim() || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("[gemini] AI move generation error:", error);
    return {
      actionType: "defend",
      targetId: gameState.ownedCities[0] || "",
      reason: "AI 결정 오류로 방어 태세를 취합니다.",
    };
  }
}
