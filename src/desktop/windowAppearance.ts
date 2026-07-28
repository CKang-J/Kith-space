export interface DesktopWindowAppearance {
  titleBarStyle?: "hiddenInset";
}

export function desktopWindowAppearance(platform: NodeJS.Platform): DesktopWindowAppearance {
  if (platform !== "darwin") return {};
  return { titleBarStyle: "hiddenInset" };
}
