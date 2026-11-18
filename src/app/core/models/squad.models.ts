/**
 * Squad-related models shared by the squad service and UI.
 */

/** Family/friend label a member can carry inside a circle. */
export type MemberRelationship =
  | "dad"
  | "mom"
  | "son"
  | "daughter"
  | "child"
  | "grandparent"
  | "partner"
  | "friend"
  | "other";

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
  /** Optional family/friend label, separate from the permission role. */
  relationship?: MemberRelationship | null;
  joined_at: string;
}

export interface CreateSquadRequest {
  squad_name: string;
}

export interface JoinSquadRequest {
  join_code: string;
}
