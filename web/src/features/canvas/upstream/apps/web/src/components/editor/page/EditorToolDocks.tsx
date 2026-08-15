/*
 * Modified by Kith-space for the Stage 1 native Canvas island.
 * Source: Recombyn abd81983716b41c7fc6e2f591c23e6d9bb9c4643 / apps/web/src/components/editor/page/EditorToolDocks.tsx
 * Changes: repository-local aliases, host typecheck boundary, and any file-specific transforms recorded in source-mapping.json.
 * Apache-2.0 and upstream NOTICE apply.
 */
// @ts-nocheck -- upstream source is bundle-checked; its original monorepo TS project is not portable.
import { memo } from 'react';
import { useDispatch } from 'react-redux';
import PathEditToolbar, {
  type PathEditSubtool,
} from '@recombyn-native/components/editor/chrome/PathEditToolbar';
import PenStrokeToolbar from '@recombyn-native/components/editor/chrome/PenStrokeToolbar';
import BucketFillToolbar from '@recombyn-native/components/editor/chrome/BucketFillToolbar';
import { setActiveTool } from '@recombyn-native/store/modules/editor';

type Props = {
  isDevMode: boolean;
  pathEditOpen: boolean;
  pathEditSubtool: PathEditSubtool;
  onPathEditSubtool: (s: PathEditSubtool) => void;
  onPathEditExit: () => void;
  activeTool: string;
};

/** Top-center floating tool docks (path edit / pen / bucket). */
function EditorToolDocks({
  isDevMode,
  pathEditOpen,
  pathEditSubtool,
  onPathEditSubtool,
  onPathEditExit,
  activeTool,
}: Props) {
  const dispatch = useDispatch();

  if (isDevMode) return null;

  if (pathEditOpen) {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2 hidden md:block">
        <PathEditToolbar
          subtool={pathEditSubtool}
          onSubtoolChange={(s) => {
            onPathEditSubtool(s);
            window.dispatchEvent(
              new CustomEvent('resume:path-edit-subtool', { detail: { subtool: s } })
            );
            // Path-edit Pen is local — do not activate the bottom toolstrip Pen.
            dispatch(setActiveTool('select'));
          }}
          onExit={() => {
            window.dispatchEvent(new Event('resume:exit-path-edit'));
            onPathEditExit();
          }}
        />
      </div>
    );
  }

  if (activeTool === 'pen' || activeTool === 'pencil') {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2 hidden md:block">
        <PenStrokeToolbar
          mode={activeTool === 'pencil' ? 'pencil' : 'pen'}
          placement="dock"
        />
      </div>
    );
  }

  if (activeTool === 'bucket') {
    return (
      <div className="pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2 hidden md:block">
        <BucketFillToolbar />
      </div>
    );
  }

  return null;
}

export default memo(EditorToolDocks);
