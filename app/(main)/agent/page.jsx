import { AgentPanel } from '@/components/modules/agent-panel';

export default function AgentPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold md:text-2xl">Agent 问股</h1>
      <AgentPanel />
    </div>
  );
}
