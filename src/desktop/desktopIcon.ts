import path from "node:path";

type DesktopIconPathOptions = Readonly<{
  isDevelopment: boolean;
  repoRoot: string;
  resourcesPath: string;
}>;

export function resolveDesktopIconPath(options: DesktopIconPathOptions): string {
  return options.isDevelopment
    ? path.join(options.repoRoot, "web", "public", "favicon.ico")
    : path.join(options.resourcesPath, "web", "dist", "favicon.ico");
}
