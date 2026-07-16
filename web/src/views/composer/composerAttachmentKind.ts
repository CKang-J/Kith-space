export type ComposerAttachmentKind =
  | "markdown"
  | "pdf"
  | "document"
  | "sheet"
  | "slides"
  | "archive"
  | "code"
  | "data"
  | "audio"
  | "video"
  | "text"
  | "file";

export interface ComposerAttachmentVisual {
  kind: ComposerAttachmentKind;
  label: string;
}

const CODE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx", "py", "go", "rs", "java", "c", "cpp", "cs", "css", "html", "sh"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);

export function composerAttachmentVisual(filename: string, mimeType?: string | null): ComposerAttachmentVisual {
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (extension === "md" || extension === "mdx" || mimeType === "text/markdown") return { kind: "markdown", label: "MD" };
  if (extension === "pdf" || mimeType === "application/pdf") return { kind: "pdf", label: "PDF" };
  if (["doc", "docx", "rtf"].includes(extension)) return { kind: "document", label: "DOC" };
  if (["xls", "xlsx", "csv"].includes(extension)) return { kind: "sheet", label: "XLS" };
  if (["ppt", "pptx", "key"].includes(extension)) return { kind: "slides", label: "PPT" };
  if (ARCHIVE_EXTENSIONS.has(extension)) return { kind: "archive", label: "ZIP" };
  if (extension === "json" || extension === "yaml" || extension === "yml") return { kind: "data", label: extension === "json" ? "JSON" : "YML" };
  if (CODE_EXTENSIONS.has(extension)) return { kind: "code", label: "</>" };
  if (mimeType?.startsWith("audio/")) return { kind: "audio", label: "AUD" };
  if (mimeType?.startsWith("video/")) return { kind: "video", label: "VID" };
  if (extension === "txt" || mimeType?.startsWith("text/")) return { kind: "text", label: "TXT" };
  return { kind: "file", label: extension.slice(0, 4).toUpperCase() || "FILE" };
}
