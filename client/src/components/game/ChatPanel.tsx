import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, Globe, Flag, Users, Lock } from "lucide-react";
import type { ChatMessage } from "@shared/schema";

interface ChatPanelProps {
  messages: ChatMessage[];
  currentPlayerId: string;
  onSendMessage: (content: string, channel: ChatMessage["channel"]) => void;
}

function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      <Avatar className="w-8 h-8">
        <AvatarFallback className="text-xs">
          {message.senderName.slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <div className={`max-w-[70%] ${isOwn ? "text-right" : ""}`}>
        <div className="text-xs text-muted-foreground mb-1">{message.senderName}</div>
        <div
          className={`px-3 py-2 rounded-md text-sm ${
            isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ messages, currentPlayerId, onSendMessage }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [activeChannel, setActiveChannel] = useState<ChatMessage["channel"]>("global");

  const filteredMessages = messages.filter((m) => m.channel === activeChannel);

  const handleSend = () => {
    if (input.trim()) {
      onSendMessage(input.trim(), activeChannel);
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-card rounded-md border" data-testid="chat-panel">
      <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as ChatMessage["channel"])}>
        <TabsList className="w-full justify-start rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="global"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            data-testid="tab-chat-global"
          >
            <Globe className="w-4 h-4 mr-1" />
            전체
          </TabsTrigger>
          <TabsTrigger
            value="nation"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            data-testid="tab-chat-nation"
          >
            <Flag className="w-4 h-4 mr-1" />
            국가
          </TabsTrigger>
          <TabsTrigger
            value="alliance"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            data-testid="tab-chat-alliance"
          >
            <Users className="w-4 h-4 mr-1" />
            동맹
          </TabsTrigger>
          <TabsTrigger
            value="private"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
            data-testid="tab-chat-private"
          >
            <Lock className="w-4 h-4 mr-1" />
            1:1
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeChannel} className="flex-1 m-0">
          <ScrollArea className="h-48">
            <div className="p-3 space-y-3">
              {filteredMessages.length === 0 ? (
                <div className="text-center text-muted-foreground py-8 text-sm">
                  메시지가 없습니다
                </div>
              ) : (
                filteredMessages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isOwn={msg.senderId === currentPlayerId}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <div className="p-2 border-t flex gap-2">
        <Input
          placeholder="메시지 입력..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
          data-testid="input-chat-message"
        />
        <Button size="icon" onClick={handleSend} data-testid="button-send-message">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
