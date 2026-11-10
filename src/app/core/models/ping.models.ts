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
  from_user_id: number;
  message?: string;
}

export interface Ping {
  id: number;
  squad_id: number;
  from_user_id: number;
  from_username?: string;
  target_user_id: number;
  ping_type: PingType;
  message?: string | null;
  created_at: string;
}
