<?php
/**
 * Konek API - Mark All Notifications Read
 * PUT /api/api_mark_all_notifications_read.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "unread_count": int, "message": "string" }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "PUT") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$authToken = requireBearerToken();

try {
    $db = getDBConnection();

    $stmt = $db->prepare("SELECT id FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();

    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $userId = (int)$user["id"];

    $updateStmt = $db->prepare("UPDATE notifications SET read_at = NOW() WHERE user_id = :user_id AND read_at IS NULL");
    $updateStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $updateStmt->execute();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "All notifications marked as read",
        "unread_count" => 0,
    ]);

} catch (PDOException $e) {
    error_log("Mark all notifications read error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
