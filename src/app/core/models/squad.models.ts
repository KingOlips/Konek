/**
 * Squad-related models shared by the squad service and UI.
 */

export interface Squad {
  id: number;
  squad_name: string;
  join_code: string;
  created_at?: string;
  member_count?: number;
  /** Present in login payloads (`api_login.php`). */
  role?: "member" | "admin";
  /** Present in squad endpoint payloads (`api_get_squads.php`, create/join). */
  user_role?: "member" | "admin";
}

export interface SquadMember {
  user_id: number;
  username: string;
  role: "member" | "admin";
  joined_at: string;
}

export interface CreateSquadRequest {
  squad_name: string;
}

export interface JoinSquadRequest {
  join_code: string;
}
