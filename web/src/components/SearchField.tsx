import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";

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
  className = "",
  ...inputProps
}, ref) {
  const clear = () => {
    onValueChange("");
    onClear?.();
  };

  return (
    <div className={`search-field${className ? ` ${className}` : ""}`}>
      <Search size={15} aria-hidden="true" />
      <input
        {...inputProps}
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="search-field__clear" aria-label={clearLabel} title={clearLabel} onClick={clear}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});
