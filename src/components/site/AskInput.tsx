import { useEffect, useRef, useState } from "react";

interface AskInputProps {
  placeholder?: string;
  placeholders?: string[];
  onSubmit: (question: string) => void;
  initial?: string;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}

export function AskInput({
  placeholder,
  placeholders,
  onSubmit,
  initial = "",
  value,
  onChange,
  disabled,
}: AskInputProps) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(initial);
  const q = controlled ? (value as string) : internal;
  const setQ = (v: string) => {
    if (controlled) onChange?.(v);
    else setInternal(v);
  };

  const [phIdx, setPhIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!placeholders || placeholders.length <= 1) return;
    const id = setInterval(
      () => setPhIdx((i) => (i + 1) % placeholders.length),
      2400,
    );
    return () => clearInterval(id);
  }, [placeholders]);

  const hasText = q.trim().length > 0;
  const ph = placeholders ? placeholders[phIdx] : (placeholder ?? "");

  function submit() {
    const trimmed = q.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setQ("");
  }

  return (
    <div
      className="ask-input flex w-full items-center gap-2.5 rounded-full"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--line-2)",
        padding: "8px 8px 8px 20px",
        boxShadow: "0 2px 8px rgba(10, 17, 23, 0.04)",
        transition: "all 220ms var(--ease-ios)",
      }}
    >
      <label htmlFor="ask" className="sr-only">
        Ask a question
      </label>
      <input
        id="ask"
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={ph}
        maxLength={500}
        disabled={disabled}
        className="font-body min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none"
        style={{ color: "var(--ink)" }}
        aria-label="Ask Prophiq a question"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !hasText}
        aria-label="Submit question"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:scale-[1.05] active:scale-[0.94]"
        style={{
          background: hasText ? "var(--amber)" : "var(--ink)",
          color: "#fff",
          transition: "all 180ms var(--ease-ios)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>
    </div>
  );
}
