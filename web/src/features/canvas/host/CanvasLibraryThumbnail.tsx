import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { canvasPreviewScene } from "./canvasLibraryPresentation";

export function CanvasLibraryThumbnail({ document, title }: { document: unknown; title: string }) {
  const preview = canvasPreviewScene(document);
  const [renderedThumbnail, setRenderedThumbnail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setRenderedThumbnail(null);
    void import("@recombyn-native/utils/renderProjectThumbnail")
      .then(({ renderProjectThumbnail }) => renderProjectThumbnail(document))
      .then((thumbnail) => {
        if (active) setRenderedThumbnail(thumbnail);
      })
      .catch(() => {
        if (active) setRenderedThumbnail(null);
      });
    return () => {
      active = false;
    };
  }, [document]);

  return (
    <div className="relative size-full overflow-hidden rounded-xl border border-border/80 bg-zinc-100 dark:bg-zinc-800">
      {renderedThumbnail ? (
        <img
          src={renderedThumbnail}
          alt={title}
          className="size-full object-contain"
          loading="lazy"
          draggable={false}
        />
      ) : (
      <svg
        viewBox={preview.viewBox}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
        className="size-full"
      >
        {preview.items.map((item) => {
          if (item.kind === "ellipse") return <ellipse key={item.id} cx={item.x + item.width / 2} cy={item.y + item.height / 2} rx={item.width / 2} ry={item.height / 2} fill={item.fill} stroke={item.stroke} vectorEffect="non-scaling-stroke" />;
          if (item.kind === "path" && item.path) return <path key={item.id} d={item.path} transform={`translate(${item.x} ${item.y})`} fill={item.fill} stroke={item.stroke} vectorEffect="non-scaling-stroke" />;
          if (item.kind === "text") return <text key={item.id} x={item.x} y={item.y + Math.max(12, item.height * 0.7)} fill={item.stroke} fontSize={Math.max(12, Math.min(item.height, 40))}>{item.text || "文字"}</text>;
          if (item.kind === "media" && item.src) return <image key={item.id} href={item.src} x={item.x} y={item.y} width={item.width} height={item.height} preserveAspectRatio="xMidYMid meet" />;
          return <rect key={item.id} x={item.x} y={item.y} width={item.width} height={item.height} rx={item.kind === "media" ? 8 : 0} fill={item.fill} stroke={item.stroke} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      )}
      {preview.items.some((item) => item.kind === "media" && !item.src) ? (
        <ImageIcon aria-hidden className="pointer-events-none absolute right-3 top-3 size-4 text-zinc-500/70" />
      ) : null}
    </div>
  );
}
