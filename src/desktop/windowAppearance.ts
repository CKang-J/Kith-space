export interface DesktopWindowAppearance {
  titleBarStyle?: "hiddenInset";
  trafficLightPosition?: Readonly<{ x: number; y: number }>;
}

export function desktopWindowAppearance(platform: NodeJS.Platform): DesktopWindowAppearance {
  if (platform !== "darwin") return {};
  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
  };
}
