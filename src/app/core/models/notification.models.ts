/**
 * In-app notification inbox models.
 */

/** Known notification kinds; the UI picks an icon from this value. */
export type NotificationType =
  | "welcome"
  | "circle"
  | "ping"
  | "geofence"
  | "system";

export interface AppNotification {
  id: number;
  /** A known NotificationType, or a newer server value the app doesn't know yet. */
  type: NotificationType | string;
  title: string;
  message: string | null;
  /** Optional JSON payload attached by the server. */
  data?: Record<string, unknown> | unknown[] | null;
  read_at: string | null;
  created_at: string;
  /** Server-computed age, used for relative time labels. */
  age_seconds: number;
}

export interface NotificationPage {
  items: AppNotification[];
  unreadCount: number;
}
