import { Bot } from 'lucide-react';

export function RobotAgentLabel({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2">
      <Bot className="h-4 w-4" aria-hidden />
      <span>{name}</span>
    </span>
  );
}
