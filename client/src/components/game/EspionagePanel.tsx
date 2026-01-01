import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { City, Spy, SpyLocationType, SpyMission } from "@shared/schema";

interface EspionagePanelProps {
  spies: Spy[];
  myCities: City[];
  onCreateSpy: (cityId: number) => Promise<void>;
  onDeploySpy: (spyId: number, mission: SpyMission, locationType: SpyLocationType, locationId: number) => Promise<void>;
}

const missionOptions: Array<{ value: SpyMission; label: string }> = [
  { value: "idle", label: "대기" },
  { value: "recon", label: "정찰" },
  { value: "sabotage", label: "공작" },
  { value: "theft", label: "자원 탈취" },
  { value: "counter_intelligence", label: "방첩" },
  { value: "assassination", label: "암살" },
];

export function EspionagePanel({ spies, myCities, onCreateSpy, onDeploySpy }: EspionagePanelProps) {
  const [createCityId, setCreateCityId] = useState<string>(myCities[0] ? String(myCities[0].id) : "");
  const [selectedSpyId, setSelectedSpyId] = useState<string>(spies[0] ? String(spies[0].id) : "");
  const [mission, setMission] = useState<SpyMission>("recon");
  const [targetType, setTargetType] = useState<SpyLocationType>("tile");
  const [targetId, setTargetId] = useState<string>("");

  const liveSpies = useMemo(() => spies.filter((s) => s.isAlive), [spies]);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="space-y-2">
        <div className="text-sm font-medium">스파이 목록</div>
        <div className="space-y-2">
          {spies.length === 0 ? (
            <div className="text-sm text-muted-foreground">스파이가 없습니다.</div>
          ) : (
            spies.map((s) => (
              <div key={s.id} className="border rounded-md p-2 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-mono">#{s.id}</div>
                  <div className={s.isAlive ? "text-green-600" : "text-red-600"}>{s.isAlive ? "생존" : "사망"}</div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  미션: {s.mission} | Lv {s.level ?? 1} | EXP {s.experience ?? 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  위치: {s.locationType}:{s.locationId}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="border rounded-md p-3 space-y-3">
        <div className="text-sm font-medium">스파이 생성</div>
        <div className="text-xs text-muted-foreground">비용: 금 1000 (도시 + spy_guild 또는 intelligence_hq 필요)</div>

        <div className="space-y-2">
          <div className="text-xs">도시</div>
          <Select value={createCityId} onValueChange={setCreateCityId}>
            <SelectTrigger>
              <SelectValue placeholder="도시 선택" />
            </SelectTrigger>
            <SelectContent>
              {myCities.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nameKo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          disabled={!createCityId}
          onClick={async () => {
            await onCreateSpy(Number(createCityId));
          }}
        >
          스파이 생성
        </Button>
      </div>

      <div className="border rounded-md p-3 space-y-3">
        <div className="text-sm font-medium">미션 파견</div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs">스파이</div>
            <Select value={selectedSpyId} onValueChange={setSelectedSpyId}>
              <SelectTrigger>
                <SelectValue placeholder="스파이 선택" />
              </SelectTrigger>
              <SelectContent>
                {liveSpies.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    #{s.id} ({s.mission})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs">미션</div>
            <Select value={mission} onValueChange={(v) => setMission(v as SpyMission)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {missionOptions
                  .filter((m) => m.value !== "idle")
                  .map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs">대상 타입</div>
            <Select value={targetType} onValueChange={(v) => setTargetType(v as SpyLocationType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tile">타일</SelectItem>
                <SelectItem value="city">도시</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-xs">대상 ID</div>
            <Input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="예: 123" />
          </div>
        </div>

        <Button
          disabled={!selectedSpyId || !targetId}
          onClick={async () => {
            await onDeploySpy(Number(selectedSpyId), mission, targetType, Number(targetId));
          }}
        >
          파견
        </Button>
      </div>
    </div>
  );
}
