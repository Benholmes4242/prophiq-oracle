import { useEffect, useRef, useState } from "react";

interface OTPInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

const LENGTH = 6;

export function OTPInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus = true,
}: OTPInputProps) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputs.current[0]?.focus();
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (value.length === LENGTH && /^\d{6}$/.test(value)) {
      onComplete?.(value);
    }
  }, [value, onComplete]);

  function setDigit(index: number, digit: string) {
    const digits = value.split("");
    digits[index] = digit;
    while (digits.length < LENGTH) digits.push("");
    onChange(digits.join("").slice(0, LENGTH));
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement>,
    index: number,
  ) {
    const raw = e.target.value.replace(/\D/g, "");
    if (raw.length === 0) {
      setDigit(index, "");
      return;
    }
    if (raw.length > 1) {
      const digits = raw.slice(0, LENGTH).split("");
      const newValue = digits.join("").padEnd(LENGTH, "").slice(0, LENGTH);
      onChange(newValue);
      const focusAt = Math.min(digits.length, LENGTH - 1);
      inputs.current[focusAt]?.focus();
      setFocusIndex(focusAt);
      return;
    }
    setDigit(index, raw);
    if (index < LENGTH - 1) {
      inputs.current[index + 1]?.focus();
      setFocusIndex(index + 1);
    }
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (e.key === "Backspace") {
      const digits = value.split("");
      if (digits[index]) {
        setDigit(index, "");
      } else if (index > 0) {
        setDigit(index - 1, "");
        inputs.current[index - 1]?.focus();
        setFocusIndex(index - 1);
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
      setFocusIndex(index - 1);
      e.preventDefault();
    } else if (e.key === "ArrowRight" && index < LENGTH - 1) {
      inputs.current[index + 1]?.focus();
      setFocusIndex(index + 1);
      e.preventDefault();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (pasted.length >= LENGTH) {
      const newValue = pasted.slice(0, LENGTH);
      onChange(newValue);
      inputs.current[LENGTH - 1]?.focus();
      setFocusIndex(LENGTH - 1);
      e.preventDefault();
    }
  }

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: LENGTH }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={value[index] ?? ""}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          onPaste={handlePaste}
          onFocus={() => setFocusIndex(index)}
          disabled={disabled}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          className="w-12 h-14 text-center text-xl font-semibold rounded-lg border outline-none disabled:opacity-50 transition-colors"
          style={{
            background: "var(--bg)",
            borderColor: focusIndex === index ? "var(--ink)" : "var(--line)",
            color: "var(--ink)",
          }}
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
        />
      ))}
    </div>
  );
}
