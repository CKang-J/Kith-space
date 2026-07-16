interface AgentMentionNameProps {
  displayName: string;
  mentionName: string;
  disabled?: boolean;
  onMention(mentionName: string): void;
}

export function AgentMentionName({ displayName, mentionName, disabled = false, onMention }: AgentMentionNameProps) {
  if (disabled) return <span className="who">{displayName}</span>;
  return (
    <button
      type="button"
      className="who agent-mention-name"
      aria-label={`@${mentionName}`}
      onClick={() => onMention(mentionName)}
    >
      <span className="agent-mention-name__at" aria-hidden="true">@</span>
      <span className="agent-mention-name__label">{displayName}</span>
    </button>
  );
}
