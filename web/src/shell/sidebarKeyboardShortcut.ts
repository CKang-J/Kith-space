function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable], [role=\"textbox\"]"));
}

export function isSidebarToggleShortcut(event: KeyboardEvent): boolean {
  return !event.defaultPrevented
    && !event.isComposing
    && !event.repeat
    && !event.altKey
    && !event.shiftKey
    && (event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === "b"
    && !isEditableTarget(event.target);
}
