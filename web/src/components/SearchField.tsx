import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  value: string;
  onValueChange(value: string): void;
  clearLabel: string;
  onClear?: () => void;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({
  value,
  onValueChange,
  clearLabel,
  onClear,
  className,
  ...inputProps
}, ref) {
  const clear = () => {
    onValueChange("");
    onClear?.();
  };

  return (
    <InputGroup
      className={cn(
        "search-field h-[var(--search-field-height,40px)] rounded-full border-0 bg-[var(--surface-strong)] px-3 text-[var(--muted-soft)] shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:shadow-none",
        className,
      )}
    >
      <InputGroupInput
        {...inputProps}
        ref={ref}
        type="search"
        className="h-full px-0 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted-soft)] focus-visible:!shadow-none md:text-[13px] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <InputGroupAddon className="p-0 text-[var(--muted-soft)]">
        <Search aria-hidden="true" />
      </InputGroupAddon>
      {value ? (
        <InputGroupAddon align="inline-end" className="p-0">
          <InputGroupButton
            size="icon-xs"
            className="size-5 rounded-full text-[var(--muted-soft)] hover:bg-[var(--hair)] hover:text-[var(--ink)]"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={clear}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
});
