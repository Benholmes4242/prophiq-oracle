import { useEffect, useRef, useState, type FormEvent } from "react";

interface AskInputProps {
  placeholder?: string;
  placeholders?: string[];
  onSubmit: (question: string) => void;
  initial?: string;
}

export function AskInput({
  placeholder,
  placeholders,
  onSubmit,
  initial = "",
}: AskInputProps) {
  const [question, setQuestion] = useState(initial);
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

  function handle(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    onSubmit(q);
    setQuestion("");
  }

  const ph = placeholders ? placeholders[phIdx] : (placeholder ?? "");

  return (
    <form
      onSubmit={handle}
      className="flex items-center gap-3 rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-[var(--amber)]/30"
      style={{
        background: "var(--bg-card)",
        border: "1.5px solid var(--border-strong)",
        boxShadow:
          "0 1px 0 var(--border-soft), 0 10px 24px -14px rgba(11,18,32,0.18)",
      }}
    >
      <label htmlFor="ask" className="sr-only">
        Ask a question
      </label>
      <input
        id="ask"
        ref={inputRef}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={ph}
        maxLength={500}
        className="font-body flex-1 bg-transparent text-[15px] outline-none"
        style={{ color: "var(--ink)" }}
        aria-label="Ask Prophiq a question"
      />
      <button
        type="submit"
        aria-label="Submit question"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform hover:scale-[1.04]"
        style={{ background: "var(--amber)" }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </form>
  );
}
