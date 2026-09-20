import { useRef, type ReactNode } from "react";
import { Button } from "./Ui";

/** A single tab stop, with local views selected by arrows or Home/End. */
export function TabList<Value extends string>({
  label,
  className,
  panelId,
  value,
  items,
  onChange,
}: {
  label: string;
  className?: string;
  panelId: string;
  value: Value;
  items: ReadonlyArray<{ value: Value; label: ReactNode }>;
  onChange: (value: Value) => void;
}) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  return (
    <div className={className} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <Button
          key={item.value}
          ref={(button) => {
            if (button) buttons.current.set(item.value, button);
            else buttons.current.delete(item.value);
          }}
          variant="unstyled"
          role="tab"
          id={`${panelId}-${item.value}`}
          aria-controls={panelId}
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          className={value === item.value ? "active" : undefined}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            let next: number;
            switch (event.key) {
              case "ArrowRight":
                next = (index + 1) % items.length;
                break;
              case "ArrowLeft":
                next = (index - 1 + items.length) % items.length;
                break;
              case "Home":
                next = 0;
                break;
              case "End":
                next = items.length - 1;
                break;
              default:
                return;
            }
            event.preventDefault();
            const target = items[next].value;
            buttons.current.get(target)?.focus();
            onChange(target);
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
