import type { Channel } from "../store.tsx";

const archivedTime = (channel: Channel) => {
  const value = channel.archivedAt ? Date.parse(channel.archivedAt) : 0;
  return Number.isFinite(value) ? value : 0;
};

/** Returns a copy ordered newest archive first; the Store order is not a UI contract. */
export function orderArchivedChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((left, right) => archivedTime(right) - archivedTime(left));
}
