import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const COMPACT_EDGE_VAR = "--composer-compact-edge";
const COMPACT_GAP_VAR = "--composer-compact-gap";
const COMPACT_SAFETY_VAR = "--composer-compact-safety";

function cssPixels(style: CSSStyleDeclaration, property: string) {
  return Number.parseFloat(style.getPropertyValue(property)) || 0;
}

export function composerTextNeedsExpansion(text: string, measuredWidth: number, availableWidth: number) {
  if (!text) return false;
  return text.includes("\n") || (availableWidth > 0 && measuredWidth >= availableWidth);
}

export function useComposerExpansion(text: string, inputRef: RefObject<HTMLTextAreaElement>, taskActive: boolean) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textNeedsExpansion, setTextNeedsExpansion] = useState(false);
  textRef.current = text;

  const recalculate = useCallback(() => {
    const box = boxRef.current;
    const input = inputRef.current;
    if (!box || !input) return;

    const currentText = textRef.current;
    if (!currentText || currentText.includes("\n")) {
      setTextNeedsExpansion(!!currentText);
      return;
    }

    const boxStyle = getComputedStyle(box);
    const leadingWidth = box.querySelector<HTMLElement>(".cb-left")?.getBoundingClientRect().width ?? 0;
    const trailingWidth = box.querySelector<HTMLElement>(".cb-right")?.getBoundingClientRect().width ?? 0;
    const availableWidth = box.clientWidth
      - cssPixels(boxStyle, COMPACT_EDGE_VAR) * 2
      - cssPixels(boxStyle, COMPACT_GAP_VAR) * 2
      - cssPixels(boxStyle, COMPACT_SAFETY_VAR)
      - leadingWidth
      - trailingWidth;
    const inputStyle = getComputedStyle(input);
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvasRef.current = canvas;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = inputStyle.font || `${inputStyle.fontWeight} ${inputStyle.fontSize} ${inputStyle.fontFamily}`;
    const measuredWidth = context.measureText(currentText.replace(/\t/g, "        ")).width;
    const letterSpacing = Number.parseFloat(inputStyle.letterSpacing) || 0;
    const widthWithSpacing = measuredWidth + Math.max(0, currentText.length - 1) * letterSpacing;
    const next = composerTextNeedsExpansion(currentText, widthWithSpacing, availableWidth);
    setTextNeedsExpansion((current) => current === next ? current : next);
  }, [inputRef]);

  useLayoutEffect(recalculate, [recalculate, taskActive, text]);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(recalculate);
    observer.observe(box);
    const leading = box.querySelector<HTMLElement>(".cb-left");
    const trailing = box.querySelector<HTMLElement>(".cb-right");
    if (leading) observer.observe(leading);
    if (trailing) observer.observe(trailing);
    return () => observer.disconnect();
  }, [recalculate]);

  return { boxRef, textNeedsExpansion };
}
