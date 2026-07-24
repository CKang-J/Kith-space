import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Eye, EyeOff } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { useStore } from "../../store.tsx";
import {
  CodeBlock,
  ColorSwatch,
  GithubAlertBlockquote,
  MarkdownTable,
  colorValueFromTag,
  markdownSchema,
  markdownUrlTransform,
  remarkColorSwatches,
  remarkGithubAlerts,
  remarkHtmlAsText,
} from "../../messageRender.tsx";

interface AgentMemoryFile {
  path: string;
  name?: string;
  size?: number;
  isDirectory?: boolean;
}

/** The existing Space-local agentMemoryDir browser, retained as the Files view. */
export function FilesMemoryView({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { api } = useStore();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [files, setFiles] = useState<AgentMemoryFile[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{ path: string; content?: string; error?: string } | null>(null);
  const [mode, setMode] = useState<"preview" | "raw">("preview");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [root, setRoot] = useState("...");

  useEffect(() => {
    let current = true;
    setSelected(null);
    setExpanded(new Set());
    setRoot("...");
    void apiRef.current("GET", `/api/agents/${agentId}/workspace-files`).then((result) => {
      if (!current) return;
      if (result.error) {
        setError(result.error);
        setFiles([]);
        return;
      }
      setError("");
      setFiles(result.files || []);
      if (result.root) setRoot(result.root);
    });
    return () => { current = false; };
  }, [agentId]);

  const open = async (file: AgentMemoryFile) => {
    setMode("preview");
    const result = await apiRef.current("GET", `/api/agents/${agentId}/workspace-files/read?path=${encodeURIComponent(file.path)}`);
    setSelected({ path: file.path, content: result.content, error: result.error });
  };
  const toggleDirectory = (path: string) => setExpanded((current) => {
    const next = new Set(current);
    next.has(path) ? next.delete(path) : next.add(path);
    return next;
  });
  const copyRoot = () => navigator.clipboard?.writeText(root).then(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  });
  const visible = files.filter((file) => {
    const parts = file.path.split("/");
    if (!showHidden && parts.some((segment) => segment.startsWith("."))) return false;
    for (let i = 1; i < parts.length; i += 1) {
      if (!expanded.has(parts.slice(0, i).join("/"))) return false;
    }
    return true;
  });
  const isMarkdown = Boolean(selected && /\.md$/i.test(selected.path));

  return (
    <div className="ws agent-memory-files">
      <div className="ws-tree">
        <div className="ws-rootbar">
          <span className="ws-root" title={root}>{root}</span>
          <button className="ws-copy" title={showHidden ? t("members.hideDotFiles") : t("members.showHiddenFiles")} onClick={() => setShowHidden((value) => !value)}>
            {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button className="ws-copy" title={copied ? t("members.copied") : t("members.copyPath")} onClick={copyRoot}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
        {error ? <div className="empty">{error}</div> : files.length === 0 ? <div className="empty">{t("members.memoryEmpty")}</div>
          : visible.map((file) => (
            <div key={file.path} className={`ws-row${selected?.path === file.path ? " active" : ""}`}
              style={{ paddingLeft: 6 + (file.path.split("/").length - 1) * 14 }}
              onClick={() => (file.isDirectory ? toggleDirectory(file.path) : void open(file))}>
              <span className={`grow${file.name?.toLowerCase() === "memory.md" ? " ws-mem" : ""}`}>
                {file.isDirectory ? <ChevronRight size={12} className={`ws-caret${expanded.has(file.path) ? " open" : ""}`} style={{ verticalAlign: "-2px" }} /> : null}
                {file.name}
              </span>
              {!file.isDirectory ? <span className="ws-size">{file.size}</span> : null}
            </div>
          ))}
      </div>
      <div className="ws-view">
        {!selected ? <div className="hint">{t("members.memoryHint")}</div>
          : selected.error ? <div className="empty">{selected.error}</div>
            : <>
              <div className="ws-path">{selected.path}
                {isMarkdown ? <span className="ws-toggle">
                  <button className={mode === "preview" ? "on" : ""} onClick={() => setMode("preview")}>{t("members.memoryPanel.preview")}</button>
                  <button className={mode === "raw" ? "on" : ""} onClick={() => setMode("raw")}>{t("members.memoryPanel.raw")}</button>
                </span> : null}
              </div>
              {isMarkdown && mode === "preview"
                ? <div className="ws-md"><ReactMarkdown urlTransform={markdownUrlTransform} remarkPlugins={[remarkGfm, remarkBreaks, remarkHtmlAsText, remarkGithubAlerts, remarkColorSwatches]} rehypePlugins={[[rehypeSanitize, markdownSchema]]} components={{
                  a: ({ href, children }) => { const color = colorValueFromTag(href); return color ? <ColorSwatch value={color} /> : <a href={href} target="_blank" rel="noreferrer">{children}</a>; },
                  blockquote: ({ node: _node, children, ...props }) => <GithubAlertBlockquote {...props}>{children}</GithubAlertBlockquote>,
                  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                  table: ({ children, ...props }) => <MarkdownTable {...props}>{children}</MarkdownTable>,
                }}>{selected.content || ""}</ReactMarkdown></div>
                : <pre className="ws-content">{selected.content}</pre>}
            </>}
      </div>
    </div>
  );
}
