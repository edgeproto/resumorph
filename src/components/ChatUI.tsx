interface ChatMessageProps {
  role: "user" | "assistant" | "system";
  content: string;
  children?: React.ReactNode;
}

export function ChatMessage({ role, content, children }: ChatMessageProps) {
  return (
    <div className={`gpt-message gpt-message-${role}`}>
      <div className="gpt-message-inner">
        <div className="gpt-avatar" aria-hidden>
          {role === "user" ? "You" : role === "assistant" ? "AI" : "·"}
        </div>
        <div className="gpt-message-body">
          {content && <div className="gpt-message-text">{content}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

interface ChatInputBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  leftAction?: React.ReactNode;
}

export function ChatInputBar({
  value,
  onChange,
  onSubmit,
  placeholder = "Message Resumorph...",
  disabled = false,
  loading = false,
  leftAction,
}: ChatInputBarProps) {
  return (
    <div className="gpt-input-wrap">
      <form
        className="gpt-input-bar"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {leftAction}
        <textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="gpt-send-btn"
          disabled={disabled || loading || !value.trim()}
          aria-label="Send"
        >
          {loading ? (
            <span className="gpt-spinner" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </form>
      <p className="gpt-input-hint muted">
        Resumorph can make mistakes. Review tailored content before applying.
      </p>
    </div>
  );
}
