import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CanvasAssetValidationError } from "./canvasAssetErrors.js";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** A fail-closed filesystem boundary for Canvas assets. It rejects symlinks/junctions
 * in every existing path segment and verifies native real paths remain inside Space. */
export class CanvasAssetFileBoundary {
  private readonly spaceRoot: string;
  readonly root: string;
  readonly stagingRoot: string;

  constructor(spaceRoot: string) {
    mkdirSync(spaceRoot, { recursive: true });
    this.spaceRoot = realpathSync.native(spaceRoot);
    this.root = path.join(this.spaceRoot, ".kith", "canvas-assets");
    this.stagingRoot = path.join(this.root, ".staging");
  }

  ensureDirectory(directory: string): void {
    this.assertLexical(directory);
    const relative = path.relative(this.spaceRoot, directory);
    let current = this.spaceRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!existsSync(current)) mkdirSync(current);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) this.reject();
      this.assertReal(current);
    }
  }

  resolveStorageKey(storageKey: string): string {
    const target = path.resolve(this.root, storageKey);
    if (target === this.root || !isInside(this.root, target)) this.reject();
    this.assertExistingSegments(path.dirname(target));
    if (existsSync(target)) this.assertRegularFile(target);
    return target;
  }

  stagingPath(id: string): string {
    if (!/^[0-9a-f-]+$/i.test(id)) this.reject();
    const target = path.join(this.stagingRoot, `${id}.tmp`);
    this.assertLexical(target);
    this.assertExistingSegments(path.dirname(target));
    if (existsSync(target)) this.assertRegularFile(target);
    return target;
  }

  writeExclusive(target: string, bytes: Buffer): void {
    this.assertExistingSegments(path.dirname(target));
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const fd = openSync(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600);
    try {
      this.assertOpenedTarget(fd, target);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally { closeSync(fd); }
  }

  read(target: string): Buffer {
    this.assertRegularFile(target);
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const fd = openSync(target, constants.O_RDONLY | noFollow);
    try {
      this.assertOpenedTarget(fd, target);
      return readFileSync(fd);
    } finally { closeSync(fd); }
  }

  rename(source: string, destination: string): void {
    // Copy through verified file descriptors rather than trusting a path-only
    // rename after validation. Recovery tolerates both names across a crash.
    const bytes = this.read(source);
    this.writeExclusive(destination, bytes);
    // Stage 2 deliberately retains the verified staging source. Node does not
    // expose portable handle-relative unlink/unlinkat semantics, so physical
    // cleanup of user-mutable directories is deferred to the later GC phase.
  }

  assertDirectory(directory: string): void {
    this.assertExistingSegments(directory);
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) this.reject();
  }

  private assertRegularFile(target: string): void {
    this.assertLexical(target);
    this.assertExistingSegments(path.dirname(target));
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) this.reject();
    this.assertReal(target);
  }

  private assertExistingSegments(directory: string): void {
    this.assertLexical(directory);
    const relative = path.relative(this.spaceRoot, directory);
    let current = this.spaceRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!existsSync(current)) break;
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) this.reject();
      this.assertReal(current);
    }
  }

  private assertLexical(target: string): void {
    if (!isInside(this.spaceRoot, path.resolve(target))) this.reject();
  }

  private assertReal(target: string): void {
    if (!isInside(this.spaceRoot, realpathSync.native(target))) this.reject();
  }

  /** Bind validation to the exact opened inode/file-id. A parent link swapped
   * between the path walk and open is rejected before bytes are read or written. */
  private assertOpenedTarget(fd: number, target: string): void {
    this.assertLexical(target);
    const opened = fstatSync(fd);
    const named = lstatSync(target);
    if (!opened.isFile() || named.isSymbolicLink() || !named.isFile()
      || opened.dev !== named.dev || opened.ino !== named.ino) this.reject();
    this.assertReal(target);
  }

  private reject(): never {
    throw new CanvasAssetValidationError("Canvas asset path escaped its Space container or crossed a filesystem link");
  }
}
