/**
 * Squad ping models shared by the map page and the ping API.
 *
 * A ping is fire-and-forget: the sender only stores it, and the recipient
 * receives it through foreground polling (push delivery is a later upgrade).
 */

export type PingType =
  | "whats_up"
  | "on_my_way"
  | "where_you_at"
  | "meet_here"
  | "almost_there"
  | "leaving_now"
  | "need_help"
  | "coffee"
  | "custom";

export interface SendPingRequest {
  target_user_id: number;
  ping_type: PingType;
  /** Required for `custom` pings, optional otherwise. */
  message?: string;
}

export interface IncomingPing {
  id: number;
  squad_id: number | null;
  from_user_id: number;
  from_username: string;
  target_user_id: number;
  ping_type: PingType;
  message: string | null;
  created_at: string;
  /** Seconds since the ping was stored, computed by the API. */
  age_seconds: number;
}
