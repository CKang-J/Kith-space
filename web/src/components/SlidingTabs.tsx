import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

export interface SlidingSegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type SlidingTabOption<T extends string> = SlidingSegmentOption<T>;

export interface SlidingSegmentedControlProps<T extends string> {
  value: T;
  options: readonly SlidingSegmentOption<T>[];
  onChange(value: T): void;
  ariaLabel: string;
  id?: string;
  className?: string;
  size?: "regular" | "compact";
}

export type SlidingTabsProps<T extends string> = SlidingSegmentedControlProps<T>;

const idValue = (value: string): string => encodeURIComponent(value);

export const slidingTabId = (id: string, value: string): string => `${id}-tab-${idValue(value)}`;
export const slidingTabPanelId = (id: string, value: string): string => `${id}-panel-${idValue(value)}`;

interface SlidingControlProps<T extends string> extends SlidingSegmentedControlProps<T> {
  semantics: "tabs" | "radio";
}

function SlidingControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  id,
  className,
  size = "regular",
  semantics,
}: SlidingControlProps<T>) {
  const generatedId = useId().replace(/:/g, "");
  const tabsId = id ?? `sliding-tabs-${generatedId}`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const rovingIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex;

  const focusTab = (index: number) => tabRefs.current[index]?.focus();
  const focusEdge = (fromEnd: boolean): number | null => {
    const indices = options.map((_, index) => index).filter((index) => !options[index]?.disabled);
    const nextIndex = fromEnd ? indices[indices.length - 1] : indices[0];
    if (nextIndex == null) return null;
    focusTab(nextIndex);
    return nextIndex;
  };
  const focusSibling = (index: number, direction: 1 | -1): number | null => {
    if (options.length < 2) return null;
    let nextIndex = index;
    for (let count = 0; count < options.length; count += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        focusTab(nextIndex);
        return nextIndex;
      }
    }
    return null;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, option: SlidingSegmentOption<T>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        {
          const nextIndex = focusSibling(index, 1);
          if (semantics === "radio" && nextIndex != null) onChange(options[nextIndex]!.value);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        {
          const nextIndex = focusSibling(index, -1);
          if (semantics === "radio" && nextIndex != null) onChange(options[nextIndex]!.value);
        }
        break;
      case "Home":
        event.preventDefault();
        {
          const nextIndex = focusEdge(false);
          if (semantics === "radio" && nextIndex != null) onChange(options[nextIndex]!.value);
        }
        break;
      case "End":
        event.preventDefault();
        {
          const nextIndex = focusEdge(true);
          if (semantics === "radio" && nextIndex != null) onChange(options[nextIndex]!.value);
        }
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
      className={["sliding-tabs", `sliding-tabs--${size}`, className].filter(Boolean).join(" ")}
      role={semantics === "tabs" ? "tablist" : "radiogroup"}
      aria-label={ariaLabel}
      style={style}
    >
      {selectedIndex >= 0 ? <span className="sliding-tabs__indicator" aria-hidden="true" /> : null}
      {options.map((option, index) => {
        const selected = option.value === value;
        const semanticProps = semantics === "tabs"
          ? {
            role: "tab" as const,
            id: slidingTabId(tabsId, option.value),
            "aria-controls": slidingTabPanelId(tabsId, option.value),
            "aria-selected": selected,
          }
          : {
            role: "radio" as const,
            "aria-checked": selected,
          };
        return (
          <button
            key={option.value}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            className="sliding-tabs__tab"
            tabIndex={index === rovingIndex ? 0 : -1}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, option, index)}
            {...semanticProps}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SlidingSegmentedControl<T extends string>(props: SlidingSegmentedControlProps<T>) {
  return <SlidingControl {...props} semantics="radio" />;
}

export function SlidingTabs<T extends string>(props: SlidingTabsProps<T>) {
  return <SlidingControl {...props} semantics="tabs" />;
}
