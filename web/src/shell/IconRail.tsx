import { ArrowLeft, Hash, LayoutGrid, MessageCircle, Users } from "lucide-react";
import { shellActions } from "./shellStore.ts";

interface IconRailProps {
  legacyHref: string;
}

export function IconRail({ legacyHref }: IconRailProps) {
  return (
    <nav className="shell-icon-rail" aria-label="空间导航">
      <button type="button" className="shell-icon-rail__brand" aria-label="返回空间总览" onClick={shellActions.returnToOverview}>
        K
      </button>
      <div className="shell-icon-rail__group" aria-label="频道与私聊占位入口">
        <button type="button" className="is-active" aria-label="频道（占位）" title="频道（占位）"><Hash size={19} /></button>
        <button type="button" aria-label="私聊（占位）" title="私聊（占位）"><MessageCircle size={19} /></button>
        <button type="button" aria-label="成员（占位）" title="成员（占位）"><Users size={19} /></button>
      </div>
      <div className="shell-icon-rail__spacer" />
      <a href={legacyHref} aria-label="打开现有界面" title="现有界面"><LayoutGrid size={19} /></a>
      <button type="button" aria-label="返回空间总览" title="返回总览" onClick={shellActions.returnToOverview}><ArrowLeft size={19} /></button>
    </nav>
  );
}
