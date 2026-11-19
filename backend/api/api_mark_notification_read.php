<?php
/**
 * Konek API - Mark One Notification Read
 * PUT /api/api_mark_notification_read.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "id": int }
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
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["id"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Notification ID is required"]);
    exit();
}

$notificationId = (int)$input["id"];
if ($notificationId <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid notification ID"]);
    exit();
}

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

    $updateStmt = $db->prepare("
        UPDATE notifications
        SET read_at = NOW()
        WHERE id = :id AND user_id = :user_id AND read_at IS NULL
    ");
    $updateStmt->bindParam(":id", $notificationId, PDO::PARAM_INT);
    $updateStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $updateStmt->execute();

    $countStmt = $db->prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = :user_id AND read_at IS NULL");
    $countStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $countStmt->execute();
    $unreadCount = (int)$countStmt->fetch(PDO::FETCH_ASSOC)["count"];

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Notification marked as read",
        "unread_count" => $unreadCount,
    ]);

} catch (PDOException $e) {
    error_log("Mark notification read error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
