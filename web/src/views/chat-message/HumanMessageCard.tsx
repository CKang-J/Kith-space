import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../../Avatar.tsx";
import { MessageIdentityCardFrame, type MessageCardAnchor } from "./MessageIdentityCardFrame.tsx";

interface HumanMessageCardProps {
  name: string;
  avatarUrl: string | null;
  anchor: MessageCardAnchor;
  trigger: HTMLElement;
  onClose(): void;
}

export function HumanMessageCard({ name, avatarUrl, anchor, trigger, onClose }: HumanMessageCardProps) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <MessageIdentityCardFrame
      anchor={anchor}
      trigger={trigger}
      className="human-message-card"
      labelledBy={titleId}
      onClose={onClose}
    >
      <Avatar seed={name} url={avatarUrl} size={42} />
      <strong id={titleId}>
        {name}
        <span>{t("chat.currentHumanSuffix")}</span>
      </strong>
    </MessageIdentityCardFrame>
  );
}
