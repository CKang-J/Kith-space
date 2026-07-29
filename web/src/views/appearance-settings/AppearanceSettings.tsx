import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  applyAppearanceFonts,
  applyAppearanceColorMode,
  isAppearanceSettings,
  type AppearanceSettings as AppearanceSettingsValue,
  type ColorMode,
  type CodeFont,
  type ContentFont,
  type InterfaceFont,
  type UiFontSize,
} from "@/appearanceFonts";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/toast";

type ApiRequest = (method: string, path: string, body?: unknown) => Promise<unknown>;
type AppearanceField = keyof AppearanceSettingsValue;

const INTERFACE_OPTIONS: Array<{ value: InterfaceFont; label: string }> = [
  { value: "sora", label: "Sora" },
  { value: "system_ui", label: "System UI" },
  { value: "inter", label: "Inter" },
  { value: "geist", label: "Geist" },
];
const INTERFACE_MONOSPACE_OPTIONS: Array<{ value: InterfaceFont; label: string }> = [
  { value: "system_monospace", label: "System Monospace" },
  { value: "jetbrains_mono", label: "JetBrains Mono" },
  { value: "fira_code", label: "Fira Code" },
  { value: "geist_mono", label: "Geist Mono" },
];
const CONTENT_OPTIONS: Array<{ value: ContentFont; label: string }> = [
  { value: "follow_interface", label: "" },
  { value: "system_ui", label: "System UI" },
  { value: "sora", label: "Sora" },
  { value: "inter", label: "Inter" },
  { value: "geist", label: "Geist" },
];
const CODE_OPTIONS: Array<{ value: CodeFont; label: string }> = [
  { value: "system_monospace", label: "System Monospace" },
  { value: "jetbrains_mono", label: "JetBrains Mono" },
  { value: "fira_code", label: "Fira Code" },
  { value: "geist_mono", label: "Geist Mono" },
];
const UI_FONT_SIZE_OPTIONS: UiFontSize[] = [12, 13, 14, 15, 16];
const COLOR_MODE_OPTIONS: Array<{ value: ColorMode; label: string }> = [
  { value: "light", label: "misc.appearanceColorModeLight" },
  { value: "dark", label: "misc.appearanceColorModeDark" },
  { value: "system", label: "misc.appearanceColorModeSystem" },
];

export function AppearanceSettings({ api }: { api: ApiRequest }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [settings, setSettings] = useState<AppearanceSettingsValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    api("GET", "/api/settings/appearance")
      .then((result) => {
        if (!active) return;
        if (!isAppearanceSettings(result)) {
          setLoadError(t("misc.appearanceLoadError"));
          return;
        }
        setSettings(result);
        applyAppearanceFonts(result);
        applyAppearanceColorMode(result);
      })
      .catch(() => {
        if (active) setLoadError(t("misc.appearanceLoadError"));
      });
    return () => { active = false; };
  }, []); // Settings navigation remounts this page; avoid reloading on unrelated Store updates.

  const save = async (next: AppearanceSettingsValue) => {
    if (!settings || busy) return;
    const previous = settings;
    setBusy(true);
    setSettings(next);
    setLoadError("");
    applyAppearanceFonts(next);
    applyAppearanceColorMode(next);
    try {
      const result = await api("PATCH", "/api/settings/appearance", next);
      if (!isAppearanceSettings(result)) throw new Error("invalid appearance settings response");
      setSettings(result);
      applyAppearanceFonts(result);
      applyAppearanceColorMode(result);
    } catch {
      setSettings(previous);
      applyAppearanceFonts(previous);
      applyAppearanceColorMode(previous);
      toast.error(t("misc.appearanceSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const update = <K extends AppearanceField>(field: K, value: AppearanceSettingsValue[K]) => {
    if (settings) void save({ ...settings, [field]: value });
  };

  if (!settings && !loadError) {
    return <div className="text-sm text-muted-foreground">{t("misc.appearanceLoading")}</div>;
  }
  if (!settings) {
    return <FieldError>{loadError}</FieldError>;
  }

  return (
    <div className="mr-auto flex w-full max-w-3xl flex-col gap-8 pb-10">
      <section className="rounded-2xl border border-border/80 bg-card p-6 text-card-foreground">
        <FieldSet className="m-0 border-0 p-0">
          <FieldLegend>{t("misc.appearanceColorModeTitle")}</FieldLegend>
          <FieldDescription>{t("misc.appearanceColorModeDesc")}</FieldDescription>
          <FieldGroup>
            <Field orientation="responsive">
              <div className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor="appearance-color-mode">{t("misc.appearanceColorMode")}</FieldLabel>
                <FieldDescription>{t("misc.appearanceColorModeHelp")}</FieldDescription>
              </div>
              <Select
                value={settings.colorMode}
                disabled={busy}
                onValueChange={(value) => update("colorMode", value as ColorMode)}
              >
                <SelectTrigger id="appearance-color-mode" className="w-full @md/field-group:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COLOR_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </FieldSet>
      </section>

      <section className="rounded-2xl border border-border/80 bg-card p-6 text-card-foreground">
        <FieldSet className="m-0 border-0 p-0">
          <FieldLegend>{t("misc.appearanceTypographyTitle")}</FieldLegend>
          <FieldDescription>{t("misc.appearanceTypographyDesc")}</FieldDescription>
          <FieldGroup>
            <Field orientation="responsive">
              <div className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor="appearance-ui-font-size">{t("misc.appearanceUiFontSize")}</FieldLabel>
                <FieldDescription>{t("misc.appearanceUiFontSizeDesc")}</FieldDescription>
              </div>
              <Select
                value={String(settings.uiFontSize)}
                disabled={busy}
                onValueChange={(value) => update("uiFontSize", Number(value) as UiFontSize)}
              >
                <SelectTrigger id="appearance-ui-font-size" className="w-full @md/field-group:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {UI_FONT_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>{t("misc.appearanceUiFontSizeOption", { size })}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="responsive">
              <div className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor="appearance-interface-font">{t("misc.appearanceInterfaceFont")}</FieldLabel>
                <FieldDescription>{t("misc.appearanceInterfaceFontDesc")}</FieldDescription>
              </div>
              <Select
                value={settings.interfaceFont}
                disabled={busy}
                onValueChange={(value) => update("interfaceFont", value as InterfaceFont)}
              >
                <SelectTrigger id="appearance-interface-font" className="w-full @md/field-group:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("misc.appearanceSansSerifGroup")}</SelectLabel>
                    {INTERFACE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>{t("misc.appearanceMonospaceGroup")}</SelectLabel>
                    {INTERFACE_MONOSPACE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="responsive">
              <div className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor="appearance-content-font">{t("misc.appearanceContentFont")}</FieldLabel>
                <FieldDescription>{t("misc.appearanceContentFontDesc")}</FieldDescription>
              </div>
              <Select
                value={settings.contentFont}
                disabled={busy}
                onValueChange={(value) => update("contentFont", value as ContentFont)}
              >
                <SelectTrigger id="appearance-content-font" className="w-full @md/field-group:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("misc.appearanceSansSerifGroup")}</SelectLabel>
                    {CONTENT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.value === "follow_interface" ? t("misc.appearanceFollowInterface") : option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="responsive">
              <div className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor="appearance-code-font">{t("misc.appearanceCodeFont")}</FieldLabel>
                <FieldDescription>{t("misc.appearanceCodeFontDesc")}</FieldDescription>
              </div>
              <Select
                value={settings.codeFont}
                disabled={busy}
                onValueChange={(value) => update("codeFont", value as CodeFont)}
              >
                <SelectTrigger id="appearance-code-font" className="w-full @md/field-group:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("misc.appearanceMonospaceGroup")}</SelectLabel>
                    {CODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </FieldSet>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border/80 bg-card p-6 text-card-foreground">
        <div>
          <h2 className="m-0 text-base font-normal">{t("misc.appearancePreviewTitle")}</h2>
          <p className="mt-1 mb-0 text-sm text-muted-foreground">{t("misc.appearancePreviewDesc")}</p>
        </div>
        <div className="rounded-lg bg-muted p-4">
          <p className="m-0 [font-family:var(--font-content)]">{t("misc.appearancePreviewBody")}</p>
          <code className="mt-3 block text-sm [font-family:var(--font-code)]">
            const agentCount = 3;
          </code>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy || (
              settings.interfaceFont === DEFAULT_APPEARANCE_SETTINGS.interfaceFont
              && settings.contentFont === DEFAULT_APPEARANCE_SETTINGS.contentFont
              && settings.codeFont === DEFAULT_APPEARANCE_SETTINGS.codeFont
              && settings.uiFontSize === DEFAULT_APPEARANCE_SETTINGS.uiFontSize
              && settings.colorMode === DEFAULT_APPEARANCE_SETTINGS.colorMode
            )}
            onClick={() => void save(DEFAULT_APPEARANCE_SETTINGS)}
          >
            {t("misc.appearanceRestoreDefaults")}
          </Button>
        </div>
      </section>
    </div>
  );
}
