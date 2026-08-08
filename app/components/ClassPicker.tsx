"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { HttpError, requestJson } from "../lib/http-client";

type ClassOption = {
  id: number;
  name: string;
  stage?: string | null;
  grade?: string | null;
};

type ClassPickerProps = {
  value: string;
  onChange: (value: string) => void;
  status?: string;
  disabled?: boolean;
  placeholder?: string;
  includeAll?: boolean;
  label?: string;
  required?: boolean;
  id?: string;
  allowClear?: boolean;
  refreshKey?: number;
  onError?: (message: string) => void;
};

type MenuPosition = { top: number; left: number; width: number };

export function ClassPicker({
  value,
  onChange,
  status = "active",
  disabled = false,
  placeholder = "请选择班级",
  includeAll = false,
  label,
  required = false,
  id,
  allowClear = false,
  refreshKey = 0,
  onError,
}: ClassPickerProps) {
  const generatedId = useId();
  const inputId = id || `class-picker-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<MenuPosition | null>(null);

  const numericValue =
    value && Number.isFinite(Number(value)) && Number(value) > 0 ? String(Number(value)) : "";

  const updatePosition = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, 200), viewportWidth - 16);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const estimatedHeight = Math.min(260, viewportHeight - 24);
    let top = rect.bottom + 6;
    if (top + estimatedHeight > viewportHeight - 8 && rect.top - estimatedHeight > 8) {
      top = Math.max(8, rect.top - estimatedHeight - 6);
    }
    setMenuStyle({ top, left, width });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", "50");
        if (status) params.set("status", status);
        if (query.trim()) params.set("q", query.trim());
        if (numericValue) params.set("ids", numericValue);
        const data = await requestJson<{ classes?: ClassOption[] }>(
          `/api/classes/options?${params.toString()}`,
          { signal: controller.signal },
        );
        setOptions(data?.classes ?? []);
        onError?.("");
      } catch (fetchError) {
        if (fetchError instanceof HttpError) {
          if (!controller.signal.aborted) {
            setError(fetchError.message);
            onError?.(fetchError.message);
          }
          return;
        }
        if (controller.signal.aborted) return;
        setError("班级加载失败");
        onError?.("班级加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [numericValue, onError, query, refreshKey, status]);

  useEffect(() => {
    setHighlighted(-1);
  }, [options, query]);

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const visibleOptions = useMemo(() => {
    if (includeAll && !query.trim()) {
      return [{ id: 0, name: "全部班级", stage: null, grade: null }, ...options];
    }
    return options;
  }, [includeAll, options, query]);

  const selectOption = useCallback(
    (option: ClassOption) => {
      onChange(option.id ? String(option.id) : "");
      setQuery("");
      setOpen(false);
      setHighlighted(-1);
    },
    [onChange],
  );

  const selected = options.find((option) => String(option.id) === value);
  const displayValue =
    query ||
    selected?.name ||
    (includeAll && value === "" ? "全部班级" : "");
  const selectedOptionId = value || (includeAll ? "0" : "");

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    updatePosition();
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setHighlighted(-1);
    handleOpen();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      handleOpen();
      if (visibleOptions.length) {
        setHighlighted((current) => Math.min(current + 1, visibleOptions.length - 1));
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      handleOpen();
      if (visibleOptions.length) {
        setHighlighted((current) =>
          current < 0 ? visibleOptions.length - 1 : Math.max(0, current - 1),
        );
      }
      return;
    }
    if (event.key === "Enter") {
      if (open && highlighted >= 0 && visibleOptions[highlighted]) {
        event.preventDefault();
        selectOption(visibleOptions[highlighted]);
      } else {
        handleOpen();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setHighlighted(-1);
    }
  };

  const handleClear = () => {
    setQuery("");
    onChange("");
    setOpen(true);
    updatePosition();
    fieldRef.current?.querySelector("input")?.focus();
  };

  const showClear =
    !disabled && (allowClear || includeAll) && (value !== "" || query !== "");

  const optionLabel = (option: ClassOption) => {
    if (!option.id) return "全部班级";
    const stage = option.stage ? option.stage : "";
    const grade = option.grade ? ` · ${option.grade}` : "";
    return `${stage}${grade}`;
  };

  return (
    <div className={`class-picker${disabled ? " class-picker--disabled" : ""}`}>
      {label ? (
        <label className="class-picker__label" htmlFor={inputId}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      <div className="class-picker__field" ref={fieldRef}>
        <input
          id={inputId}
          className="class-picker__input"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={
            open && highlighted >= 0 && visibleOptions[highlighted]
              ? `${listboxId}-option-${visibleOptions[highlighted].id || "all"}`
              : undefined
          }
          aria-label={label || placeholder}
          aria-required={required}
          aria-busy={loading}
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleInputChange}
          onFocus={handleOpen}
          onClick={handleOpen}
          onBlur={() => {
            setOpen(false);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {showClear ? (
          <button
            type="button"
            className="class-picker__clear"
            aria-label={value === "" ? "清空搜索" : "清除班级选择"}
            onClick={handleClear}
          >
            ×
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="class-picker__listbox"
          style={menuStyle ?? undefined}
          aria-label={label || "班级选项"}
        >
          {loading ? <li className="class-picker__status">加载中…</li> : null}
          {!loading && error ? (
            <li className="class-picker__error" role="alert">
              {error}
            </li>
          ) : null}
          {!loading && !error && visibleOptions.length === 0 ? (
            <li className="class-picker__status">未找到班级</li>
          ) : null}
          {!loading &&
            !error &&
            visibleOptions.map((option, index) => (
              <li
                key={option.id || "all"}
                id={`${listboxId}-option-${option.id || "all"}`}
                role="option"
                className={`class-picker__option${
                  index === highlighted ? " class-picker__option--highlighted" : ""
                }`}
                aria-selected={String(option.id) === selectedOptionId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setHighlighted(index)}
              >
                <strong>{option.name}</strong>
                {option.id ? <small>{optionLabel(option)}</small> : null}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
