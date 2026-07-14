import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import "./SlidingTabs.css";

export interface SlidingTabOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SlidingTabsProps<T extends string> {
  value: T;
  options: readonly SlidingTabOption<T>[];
  onChange(value: T): void;
  ariaLabel: string;
  id?: string;
  className?: string;
}

const idValue = (value: string): string => encodeURIComponent(value);

export const slidingTabId = (id: string, value: string): string => `${id}-tab-${idValue(value)}`;
export const slidingTabPanelId = (id: string, value: string): string => `${id}-panel-${idValue(value)}`;

export function SlidingTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  className,
}: SlidingTabsProps<T>) {
  const generatedId = useId().replace(/:/g, "");
  const tabsId = id ?? `sliding-tabs-${generatedId}`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const rovingIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex;

  const focusTab = (index: number) => tabRefs.current[index]?.focus();
  const focusEdge = (fromEnd: boolean) => {
    const indices = options.map((_, index) => index).filter((index) => !options[index]?.disabled);
    const nextIndex = fromEnd ? indices[indices.length - 1] : indices[0];
    if (nextIndex != null) focusTab(nextIndex);
  };
  const focusSibling = (index: number, direction: 1 | -1) => {
    if (options.length < 2) return;
    let nextIndex = index;
    for (let count = 0; count < options.length; count += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        focusTab(nextIndex);
        return;
      }
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, option: SlidingTabOption<T>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusSibling(index, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusSibling(index, -1);
        break;
      case "Home":
        event.preventDefault();
        focusEdge(false);
        break;
      case "End":
        event.preventDefault();
        focusEdge(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!option.disabled) onChange(option.value);
        break;
    }
  };

  const style = {
    "--sliding-tabs-count": Math.max(options.length, 1),
    "--sliding-tabs-index": Math.max(selectedIndex, 0),
  } as CSSProperties;

  return (
    <div
      id={tabsId}
      className={["sliding-tabs", className].filter(Boolean).join(" ")}
      role="tablist"
      aria-label={ariaLabel}
      style={style}
    >
      {selectedIndex >= 0 ? <span className="sliding-tabs__indicator" aria-hidden="true" /> : null}
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { tabRefs.current[index] = element; }}
          type="button"
          className="sliding-tabs__tab"
          role="tab"
          id={slidingTabId(tabsId, option.value)}
          aria-controls={slidingTabPanelId(tabsId, option.value)}
          aria-selected={option.value === value}
          tabIndex={index === rovingIndex ? 0 : -1}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => handleKeyDown(event, option, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
