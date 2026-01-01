import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function Auth() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!username.trim() || !password) {
      toast({
        title: "입력 필요",
        description: "아이디와 비밀번호를 입력하세요.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      await apiRequest("POST", url, {
        username: username.trim(),
        password,
      });

      toast({
        title: mode === "login" ? "로그인 완료" : "회원가입 완료",
        description: "로비로 이동합니다.",
      });

      setLocation("/");
    } catch (e: any) {
      toast({
        title: "실패",
        description: e?.message || "요청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4" data-testid="page-auth">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>계정</CardTitle>
          <CardDescription>로그인 또는 회원가입 후 게임을 시작하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login" data-testid="tab-login">
                로그인
              </TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">
                회원가입
              </TabsTrigger>
            </TabsList>

            <TabsContent value={mode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">아이디</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="아이디"
                  autoComplete="username"
                  data-testid="input-username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  data-testid="input-password"
                />
              </div>

              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={isSubmitting}
                data-testid="button-auth-submit"
              >
                {isSubmitting ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
              </Button>

              <Button
                className="w-full"
                variant="outline"
                onClick={() => setLocation("/")}
                data-testid="button-back-lobby"
              >
                로비로 돌아가기
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
