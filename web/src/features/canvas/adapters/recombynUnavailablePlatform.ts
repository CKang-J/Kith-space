import { StageOneCapabilityUnavailable } from "@/features/canvas/adapters/recombynStageOneServices";

const unavailable = (capability: string): never => { throw new StageOneCapabilityUnavailable(capability); };

export async function invoke(): Promise<never> { return unavailable("native.invoke"); }
export async function save(): Promise<never> { return unavailable("native.dialog.save"); }
export async function writeFile(): Promise<never> { return unavailable("native.fs.writeFile"); }
export async function openUrl(): Promise<never> { return unavailable("native.opener.openUrl"); }
export async function listen(): Promise<never> { return unavailable("native.event.listen"); }
export function getCurrentWindow() {
  return { setTheme: async () => unavailable("native.window.setTheme") };
}
