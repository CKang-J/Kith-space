import { useTranslation } from "react-i18next";

export function DeletedAgentName({ displayName }: { displayName: string }) {
  const { t } = useTranslation();
  return (
    <span className="who deleted-agent-name">
      <span>{displayName}</span>
      <span className="deleted-agent-name__badge">{t("chat.deletedAgent")}</span>
    </span>
  );
}
