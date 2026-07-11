import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  validatePersonalSetup,
  type PersonalSetupDraft,
  type PersonalSetupField,
  type PersonalSetupFieldErrors,
  type PersonalSetupHuman,
  type PersonalSetupInput,
} from "../personalSetup.ts";
import "./FirstRunSetup.css";

interface FirstRunSetupProps {
  mode: "loading" | "form" | "loadError";
  initialHuman?: PersonalSetupHuman | null;
  loadError?: string;
  onInitialize(input: PersonalSetupInput): Promise<void>;
  onRetry(): void;
}

const EMPTY_DRAFT: PersonalSetupDraft = { name: "", email: "", description: "" };

export function FirstRunSetup({ mode, initialHuman, loadError = "", onInitialize, onRetry }: FirstRunSetupProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PersonalSetupDraft>(() => initialHuman ? {
    name: initialHuman.name,
    email: initialHuman.email ?? "",
    description: initialHuman.description ?? "",
  } : EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<PersonalSetupFieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field: PersonalSetupField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
    setSubmitError("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validation = validatePersonalSetup(draft);
    setFieldErrors(validation.errors);
    setSubmitError("");
    if (!validation.input) return;

    setSubmitting(true);
    try {
      await onInitialize(validation.input);
    } catch (reason) {
      setSubmitError(errorMessage(reason, t("personalSetup.submitFailed")));
      setSubmitting(false);
    }
  };

  return (
    <main className="personal-setup-page">
      <section className="personal-setup-card" aria-busy={mode === "loading" || submitting}>
        <div className="personal-setup-brand">Kith-space</div>

        {mode === "loading" ? (
          <div className="personal-setup-state" role="status">
            <span className="personal-setup-spinner" aria-hidden="true" />
            <h1>{t("personalSetup.checkingTitle")}</h1>
            <p>{t("personalSetup.checkingDescription")}</p>
          </div>
        ) : mode === "loadError" ? (
          <div className="personal-setup-state">
            <h1>{t("personalSetup.loadFailedTitle")}</h1>
            <p>{loadError || t("personalSetup.loadFailedDescription")}</p>
            <button className="personal-setup-primary" type="button" onClick={onRetry}>
              {t("personalSetup.retry")}
            </button>
          </div>
        ) : (
          <form className="personal-setup-form" noValidate onSubmit={submit}>
            <header>
              <p className="personal-setup-eyebrow">{t("personalSetup.eyebrow")}</p>
              <h1>{t("personalSetup.title")}</h1>
              <p>{t("personalSetup.description")}</p>
            </header>

            <label className="personal-setup-field">
              <span>{t("personalSetup.nameLabel")}</span>
              <input
                autoFocus
                autoComplete="name"
                aria-invalid={Boolean(fieldErrors.name)}
                disabled={submitting}
                maxLength={64}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder={t("personalSetup.namePlaceholder")}
                required
                value={draft.name}
              />
              {fieldErrors.name ? (
                <small className="personal-setup-field-error" role="alert">
                  {t(`personalSetup.validation.name.${fieldErrors.name}`)}
                </small>
              ) : null}
            </label>

            <label className="personal-setup-field">
              <span>{t("personalSetup.emailLabel")} <small>{t("personalSetup.optional")}</small></span>
              <input
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.email)}
                disabled={submitting}
                maxLength={254}
                onChange={(event) => updateField("email", event.target.value)}
                placeholder={t("personalSetup.emailPlaceholder")}
                type="email"
                value={draft.email}
              />
              {fieldErrors.email ? (
                <small className="personal-setup-field-error" role="alert">
                  {t(`personalSetup.validation.email.${fieldErrors.email}`)}
                </small>
              ) : null}
            </label>

            <label className="personal-setup-field">
              <span>{t("personalSetup.descriptionLabel")} <small>{t("personalSetup.optional")}</small></span>
              <textarea
                aria-invalid={Boolean(fieldErrors.description)}
                disabled={submitting}
                maxLength={3000}
                onChange={(event) => updateField("description", event.target.value)}
                placeholder={t("personalSetup.descriptionPlaceholder")}
                rows={4}
                value={draft.description}
              />
              <span className="personal-setup-count">{draft.description.length}/3000</span>
              {fieldErrors.description ? (
                <small className="personal-setup-field-error" role="alert">
                  {t(`personalSetup.validation.description.${fieldErrors.description}`)}
                </small>
              ) : null}
            </label>

            {submitError ? <div className="personal-setup-error" role="alert">{submitError}</div> : null}

            <button className="personal-setup-primary" disabled={submitting} type="submit">
              {submitting ? t("personalSetup.creating") : t("personalSetup.continue")}
            </button>
            <p className="personal-setup-footnote">{t("personalSetup.footnote")}</p>
          </form>
        )}
      </section>
    </main>
  );
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
