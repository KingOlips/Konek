<?php
/**
 * Konek API - Update Member Relationship
 * PUT /api/api_update_member_relationship.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: {
 *   "squad_id": int,
 *   "user_id": int,
 *   "relationship": "dad|mom|son|daughter|child|grandparent|partner|friend|other|null"
 * }
 * Response: { "success": bool, "data": string|null, "message": "string" }
 *
 * A member can label themselves; circle admins can label anyone. The
 * relationship is a display label only and never changes permissions.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "PUT") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$authToken = requireBearerToken();
$input = json_decode(file_get_contents("php://input"), true);

if (
    !$input
    || !isset($input["squad_id"])
    || !isset($input["user_id"])
    || !array_key_exists("relationship", $input)
) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Circle ID, user ID, and relationship are required"]);
    exit();
}

$squadId = (int)$input["squad_id"];
$targetUserId = (int)$input["user_id"];
$relationship = $input["relationship"];

if ($relationship === "" || $relationship === null) {
    $relationship = null;
} elseif (!in_array(
    $relationship,
    ["dad", "mom", "son", "daughter", "child", "grandparent", "partner", "friend", "other"],
    true
)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid relationship"]);
    exit();
}

try {
    $db = getDBConnection();

    // Resolve the caller from the bearer token.
    $stmt = $db->prepare("SELECT id FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $currentUserId = (int)$user["id"];

    // The caller must belong to this circle.
    $memberStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $memberStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $memberStmt->bindParam(":user_id", $currentUserId, PDO::PARAM_INT);
    $memberStmt->execute();
    $currentMember = $memberStmt->fetch(PDO::FETCH_ASSOC);

    if (!$currentMember) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Not a member of this circle"]);
        exit();
    }

    // Admins can label anyone; everyone else can only label themselves.
    if ($currentUserId !== $targetUserId && $currentMember["role"] !== "admin") {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Only admins can change another member's relationship"]);
        exit();
    }

    // The target must be in the same circle.
    $targetStmt = $db->prepare("SELECT id FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $targetStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $targetStmt->bindParam(":user_id", $targetUserId, PDO::PARAM_INT);
    $targetStmt->execute();

    if (!$targetStmt->fetch(PDO::FETCH_ASSOC)) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "User is not a member of this circle"]);
        exit();
    }

    $updateStmt = $db->prepare("UPDATE squad_members SET relationship = :relationship WHERE squad_id = :squad_id AND user_id = :user_id");
    $updateStmt->bindValue(":relationship", $relationship, $relationship === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
    $updateStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $updateStmt->bindParam(":user_id", $targetUserId, PDO::PARAM_INT);
    $updateStmt->execute();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => $relationship === null ? "Relationship cleared" : "Relationship updated",
        "data" => $relationship,
    ]);

} catch (PDOException $e) {
    error_log("Update member relationship error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
