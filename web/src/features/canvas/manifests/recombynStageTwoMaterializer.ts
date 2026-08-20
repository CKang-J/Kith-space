const TOOL_STRIP_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/chrome/EditorToolStrip.tsx";
const EDITOR_TOP_CHROME_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/page/EditorTopChrome.tsx";
const CANVAS_CONTEXT_ACTION_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/canvas/runCanvasCtxAction.ts";
const SVG_CANVAS_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/canvas/SvgCanvas.tsx";
const EDITOR_PAGE_SUFFIX = "/features/canvas/upstream/apps/web/src/pages/EditorPage.tsx";
const EDITOR_BOTTOM_HUD_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/page/EditorBottomHud.tsx";
const EDITOR_TOOL_DOCKS_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/page/EditorToolDocks.tsx";
const EXPORT_PANEL_SUFFIX = "/features/canvas/upstream/apps/web/src/components/editor/panels/ExportSelectionPanel.tsx";
const DISABLED_MEDIA_PICKER = "tip={L.uploadMedia}\n        active={imageActive}\n        disabled\n        menuOpen={openMenu === 'upload'}";
const DURABLE_MEDIA_PICKER = "tip={L.uploadMedia}\n        active={imageActive}\n        disabled={toolsLocked}\n        menuOpen={openMenu === 'upload'}";
const LOCAL_HISTORY_ACTIONS = `if (action === 'undo') {
    if (!collabUndo()) dispatch(undo());
    return;
  }
  if (action === 'redo') {
    if (!collabRedo()) dispatch(redo());
    return;
  }`;
const CORE_HISTORY_ACTIONS = `if (action === 'undo' || action === 'redo') {
    const event = new CustomEvent('kith:canvas-history', { detail: { kind: action }, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) {
      if (action === 'undo') {
        if (!collabUndo()) dispatch(undo());
      } else if (!collabRedo()) dispatch(redo());
    }
    return;
  }`;

function replacePatternOnce(value: string, pattern: RegExp, replacement: string, label: string): string {
  const matches = value.match(new RegExp(pattern.source, "g"));
  if (matches?.length !== 1) {
    throw new Error(`Stage2 Canvas materializer expected one ${label} seam, found ${matches?.length ?? 0}`);
  }
  return value.replace(pattern, replacement);
}

/** Compile-time Stage2 host seam. The Stage1 upstream bytes and source-mapping SHA stay immutable. */
export function materializeRecombynStageTwoHostSeams(source: string, id: string): string {
  const sourcePath = id.split("?", 1)[0]!;
  if (sourcePath.endsWith(EDITOR_TOOL_DOCKS_SUFFIX)) {
    const pattern = /<div className="pointer-events-none absolute left-1\/2 top-3 z-\[70\] -translate-x-1\/2 hidden md:block">/g;
    const matches = source.match(pattern);
    if (matches?.length !== 3) {
      throw new Error(`Stage2 Canvas materializer expected three visible-stage tool docks, found ${matches?.length ?? 0}`);
    }
    return source.replace(
      pattern,
      `<div
        style={{ left: 'var(--kith-canvas-tool-dock-center-x)', transform: 'translateX(-50%)' }}
        className="pointer-events-none absolute top-3 z-[70] hidden md:block"
      >`,
    );
  }
  if (sourcePath.endsWith(EDITOR_PAGE_SUFFIX)) {
    let result = replacePatternOnce(
      source,
      /data-tour="editor-tools"\n              className=\{cn\(\n                'pointer-events-none absolute left-1\/2 z-20 -translate-x-1\/2',/,
      `data-tour="editor-tools"
              style={{ left: 'var(--kith-canvas-toolbar-center-x)' }}
              className={cn(
                'pointer-events-none absolute z-20',`,
      "embedded bottom toolbar centering",
    );
    result = replacePatternOnce(
      result,
      /import ShareDialog from '@recombyn-native\/components\/editor\/panels\/ShareDialog';\n/,
      "",
      "native share dialog import",
    );
    result = replacePatternOnce(result, /  const \[shareOpen, setShareOpen\] = useState\(false\);\n/, "", "native share state");
    result = replacePatternOnce(
      result,
      /  const openShareDialog = useCallback\(\(\) => \{\n    setShareOpen\(true\);\n  \}, \[\]\);\n\n/,
      "",
      "native share callback",
    );
    result = replacePatternOnce(result, /              onShare=\{openShareDialog\}\n/, "", "native share prop");
    result = replacePatternOnce(
      result,
      /  const projectName = currentTemplate\?\.name \|\| t\('home\.untitled'\);/,
      "  const projectName = currentTemplate?.name ?? t('home.untitled');",
      "empty title draft display",
    );
    return replacePatternOnce(
      result,
      /        \{shareOpen \? \(\n          <ShareDialog open=\{shareOpen\} onClose=\{\(\) => setShareOpen\(false\)\} \/>\n        \) : null\}\n/,
      "",
      "native share dialog render",
    );
  }
  if (sourcePath.endsWith(EDITOR_BOTTOM_HUD_SUFFIX)) {
    let result = replacePatternOnce(
      source,
      /(<Dropdown\n          trigger="click"\n          open=\{zoomMenuOpen\}\n)/,
      "$1          referenceToggle={false}\n",
      "zoom dropdown toggle owner",
    );
    result = replacePatternOnce(
      result,
      /(            aria-label=\{t\('editor\.zoomMenu'\)\}\n)/,
      "$1            onClick={() => setZoomMenuOpen((open) => !open)}\n",
      "zoom trigger click owner",
    );
    return result;
  }
  if (sourcePath.endsWith(EDITOR_TOP_CHROME_SUFFIX)) {
    let result = replacePatternOnce(
      source,
      /      <Tooltip tip=\{t\('editor\.home', \{ defaultValue: '首页' \}\)\} placement="bottom">[\s\S]*?      <\/Tooltip>\n/,
      "",
      "native home control",
    );
    result = replacePatternOnce(
      result,
      /import \{ HiOutlineHome, HiOutlineShare \} from 'react-icons\/hi2';/,
      "",
      "native home icon import",
    );
    result = replacePatternOnce(result, /  onShare: \(\) => void;\n/, "", "native share prop type");
    result = replacePatternOnce(result, /  onShare,\n/, "", "native share prop binding");
    result = replacePatternOnce(
      result,
      /          <Tooltip tip=\{t\('editor\.share'\)\} placement="bottom">[\s\S]*?          <\/Tooltip>\n/,
      "",
      "native share control",
    );
    result = replacePatternOnce(
      result,
      /import WalletAccountChip from '@recombyn-native\/components\/layout\/WalletAccountChip';\n/,
      "",
      "native account import",
    );
    result = replacePatternOnce(
      result,
      /            <WalletAccountChip \/>\n/,
      "",
      "native account control",
    );
    return replacePatternOnce(
      result,
      /          onChange=\{\(e\) => onRename\(e\.target\.value\)\}\n/,
      `          onChange={(e) => {
            onRename(e.target.value);
            window.dispatchEvent(new CustomEvent('kith:canvas-title', { detail: { title: e.target.value, phase: 'draft' } }));
          }}
          onBlur={(e) => window.dispatchEvent(new CustomEvent('kith:canvas-title', { detail: { title: e.currentTarget.value, phase: 'commit' } }))}
          placeholder={t('home.untitled')}
`,
      "durable title bridge",
    );
  }
  if (sourcePath.endsWith(EXPORT_PANEL_SUFFIX)) {
    let result = replacePatternOnce(
      source,
      /              <DropdownPanelItem\n                role="menuitem"\n                disabled\n                onClick=\{runExportJson\}/,
      `              <DropdownPanelItem
                role="menuitem"
                onClick={runExportJson}`,
      "durable JSON export menu item",
    );
    return replacePatternOnce(
      result,
      /        const result = await exportDocumentJson\(normalizeDocument\(doc\), projectName\);/,
      `        const detail: { complete?: Promise<'saved' | 'cancelled' | 'failed'> } = {};
        const event = new CustomEvent('kith:canvas-export', { cancelable: true, detail });
        window.dispatchEvent(event);
        const result = event.defaultPrevented
          ? await (detail.complete ?? Promise.resolve('failed'))
          : await exportDocumentJson(normalizeDocument(doc), projectName);`,
      "durable JSON export bridge",
    );
  }
  if (sourcePath.endsWith(TOOL_STRIP_SUFFIX)) {
    const first = source.indexOf(DISABLED_MEDIA_PICKER);
    if (first < 0 || source.indexOf(DISABLED_MEDIA_PICKER, first + 1) >= 0) {
      throw new Error("Stage2 Canvas materializer expected exactly one disabled native media picker");
    }
    const replaceOnce = (value: string, from: string, to: string) => {
      const count = value.split(from).length - 1;
      if (count !== 1) throw new Error(`Stage2 Canvas materializer expected one toolbar media seam, found ${count}`);
      return value.replace(from, to);
    };
    let result = source.replace(DISABLED_MEDIA_PICKER, DURABLE_MEDIA_PICKER);
    result = replaceOnce(result,
      "      const preview = await readFileAsDataUrl(file);\n      const natural = await measureImageNaturalSize(preview);",
      "      const uploaded = await uploadImageFile(file);\n      const preview = await readFileAsDataUrl(file);\n      const natural = await measureImageNaturalSize(preview);");
    result = replaceOnce(result,
      "      const prepared = await prepareVideoUploadPreview(file);",
      "      const uploaded = await uploadImageFile(file);\n      const prepared = await prepareVideoUploadPreview(file);");
    result = replaceOnce(result, "startImageUploadPlaceholder({\n          src: preview", "startImageUploadPlaceholder({\n          src: uploaded.url");
    result = replaceOnce(result,
      "startVideoUploadPlaceholder({\n          src: prepared.preview,\n          poster: prepared.poster",
      "startVideoUploadPlaceholder({\n          src: uploaded.url,\n          poster: ''");
    result = replaceOnce(result, "        const uploaded = await uploadImageFile(file, { signal });\n", "");
    result = replaceOnce(result, "      const uploaded = await uploadImageFile(file);\n      dispatch(\n        finishImageProcess({", "      dispatch(\n        finishImageProcess({");
    result = replaceOnce(result, "            ...(prepared.poster ? { poster: prepared.poster } : {}),\n", "");
    return result;
  }
  if (sourcePath.endsWith(CANVAS_CONTEXT_ACTION_SUFFIX)) {
    const first = source.indexOf(LOCAL_HISTORY_ACTIONS);
    if (first < 0 || source.indexOf(LOCAL_HISTORY_ACTIONS, first + 1) >= 0) {
      throw new Error("Stage2 Canvas materializer expected exactly one native history action pair");
    }
    return source.replace(LOCAL_HISTORY_ACTIONS, CORE_HISTORY_ACTIONS);
  }
  if (sourcePath.endsWith(SVG_CANVAS_SUFFIX)) {
    const replaceCount = (value: string, from: string, to: string, expected: number) => {
      const count = value.split(from).length - 1;
      if (count !== expected) throw new Error(`Stage2 Canvas materializer expected ${expected} media seam match(es), found ${count}`);
      return value.split(from).join(to);
    };
    let result = source;
    result = replaceCount(result,
      "      const preview = await readFileAsDataUrl(file);\n      const natural = await measureImageNaturalSize(preview);",
      "      const uploaded = await uploadImageFile(file);\n      const preview = await readFileAsDataUrl(file);\n      const natural = await measureImageNaturalSize(preview);", 1);
    result = replaceCount(result,
      "      const prepared = await prepareVideoUploadPreview(file);",
      "      const uploaded = await uploadImageFile(file);\n      const prepared = await prepareVideoUploadPreview(file);", 1);
    result = replaceCount(result,
      "      const preview = await readFileAsDataUrl(file);\n      const duration = (await probeAudioDuration(preview)) || undefined;",
      "      const uploaded = await uploadImageFile(file);\n      const preview = await readFileAsDataUrl(file);\n      const duration = (await probeAudioDuration(preview)) || undefined;", 1);
    result = replaceCount(result, "startImageUploadPlaceholder({\n          src: preview", "startImageUploadPlaceholder({\n          src: uploaded.url", 1);
    result = replaceCount(result, "startVideoUploadPlaceholder({\n          src: prepared.preview,\n          poster: prepared.poster", "startVideoUploadPlaceholder({\n          src: uploaded.url,\n          poster: ''", 1);
    result = replaceCount(result, "spawnAudio({\n          src: preview", "spawnAudio({\n          src: uploaded.url", 1);
    result = replaceCount(result, "        const uploaded = await uploadImageFile(file, { signal });\n", "", 2);
    result = replaceCount(result, "      const uploaded = await uploadImageFile(file);\n      dispatch(\n        finishImageProcess({", "      dispatch(\n        finishImageProcess({", 1);
    result = replaceCount(result, "            ...(prepared.poster ? { poster: prepared.poster } : {}),\n", "", 1);
    result = replaceCount(result,
      "/Mac/i.test(navigator.platform) ? '?' : 'Ctrl'",
      "/Mac/i.test(navigator.platform) ? '\u2318' : 'Ctrl'",
      1);
    return result;
  }
  return source;
}
