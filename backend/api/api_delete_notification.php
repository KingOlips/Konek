<?php
/**
 * Konek API - Delete Notification
 * DELETE /api/api_delete_notification.php?id=<id>
 *
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "unread_count": int, "message": "string" }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "DELETE") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$authToken = requireBearerToken();
$notificationId = isset($_GET["id"]) ? (int)$_GET["id"] : 0;

if ($notificationId <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Notification ID is required"]);
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

    $deleteStmt = $db->prepare("DELETE FROM notifications WHERE id = :id AND user_id = :user_id");
    $deleteStmt->bindParam(":id", $notificationId, PDO::PARAM_INT);
    $deleteStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $deleteStmt->execute();

    if ($deleteStmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Notification not found"]);
        exit();
    }

    $countStmt = $db->prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = :user_id AND read_at IS NULL");
    $countStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $countStmt->execute();
    $unreadCount = (int)$countStmt->fetch(PDO::FETCH_ASSOC)["count"];

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Notification deleted",
        "unread_count" => $unreadCount,
    ]);

} catch (PDOException $e) {
    error_log("Delete notification error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
