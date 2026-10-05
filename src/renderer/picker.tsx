import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export type PickerOption<T extends string> = { value: T; label: string; disabled?: boolean };

/** A pop-up button whose glass menu replaces the native select, which Chromium draws in light system
 * colors whatever the theme. Follows the select-only combobox pattern: focus stays on the button and
 * the highlighted option is announced through aria-activedescendant. */
export function Picker<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(selected !== -1 && !options[selected].disabled ? selected : nextEnabled(options, -1, 1));
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    const option = options[index];
    if (option && !option.disabled && option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        show();
      }
      return;
    }
    const move: Partial<Record<string, () => number>> = {
      ArrowDown: () => nextEnabled(options, active, 1),
      ArrowUp: () => nextEnabled(options, active, -1),
      Home: () => nextEnabled(options, -1, 1),
      End: () => nextEnabled(options, options.length, -1),
    };
    const target = move[event.key];
    if (target) {
      event.preventDefault();
      setActive(target());
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="picker">
      <label id={`${id}-label`} htmlFor={`${id}-button`}>
        {label}
      </label>
      <button
        id={`${id}-button`}
        type="button"
        role="combobox"
        className="picker-button"
        aria-labelledby={`${id}-label`}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="picker-value">{options[selected]?.label}</span>
        <svg className="picker-chevron" viewBox="0 0 10 14" aria-hidden="true">
          <path d="M2 5l3-3 3 3M2 9l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          id={`${id}-list`}
          className="picker-menu"
          role="listbox"
          aria-labelledby={`${id}-label`}
          // Keeps focus on the button, so a click on an option does not blur and close the menu first.
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              className="picker-option"
              role="option"
              aria-selected={index === selected}
              aria-disabled={option.disabled}
              data-active={index === active}
              onMouseEnter={() => !option.disabled && setActive(index)}
              onClick={() => !option.disabled && choose(index)}
            >
              <svg className="picker-check" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 6.5l2.5 2.5L10 3" />
              </svg>
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The next enabled index from `from` in `step` direction, or `from` itself when none is left. */
export function nextEnabled(options: readonly { disabled?: boolean }[], from: number, step: 1 | -1) {
  for (let index = from + step; index >= 0 && index < options.length; index += step) {
    if (!options[index].disabled) return index;
  }
  return from;
}
