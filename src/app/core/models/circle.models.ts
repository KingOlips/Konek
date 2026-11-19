/**
 * Circle-related models shared by the circle service and UI.
 *
 * The backend still uses "squad" in its payload keys (`squad_name`,
 * `squad_id`, `api_get_squads.php`). Those wire names stay untouched; the
 * frontend simply treats the records as circles.
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

export interface Circle {
  id: number;
  /** Backend wire key; shown as the circle name in the UI. */
  squad_name: string;
  join_code: string;
  created_at?: string;
  member_count?: number;
  /** Present in login payloads (`api_login.php`). */
  role?: "member" | "admin";
  /** Present in circle endpoint payloads (`api_get_squads.php`, create/join). */
  user_role?: "member" | "admin";
}

export interface CircleMember {
  user_id: number;
  username: string;
  role: "member" | "admin";
  /** Optional family/friend label, separate from the permission role. */
  relationship?: MemberRelationship | null;
  /** Profile picture path, or null when the member has none. */
  profile_picture?: string | null;
  joined_at: string;
}

export interface CreateCircleRequest {
  /** Backend wire key; holds the user-facing circle name. */
  squad_name: string;
}

export interface JoinCircleRequest {
  join_code: string;
}
