<?php
/**
 * Konek API - Get Notifications
 * GET /api/api_get_notifications.php?unread_only=1&limit=50&offset=0
 *
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "data": [...], "unread_count": int, "message": "string" }
 *
 * Returns the signed-in user's inbox, newest first. `age_seconds` is computed
 * by MySQL so the app can render relative times without guessing time zones.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$authToken = requireBearerToken();

$unreadOnly = isset($_GET["unread_only"]) && $_GET["unread_only"] === "1";
$limit = isset($_GET["limit"]) ? (int)$_GET["limit"] : 50;
$offset = isset($_GET["offset"]) ? (int)$_GET["offset"] : 0;

// Clamp so a stray query string cannot ask for the whole table.
$limit = max(1, min(100, $limit));
$offset = max(0, $offset);

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

    $countStmt = $db->prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = :user_id AND read_at IS NULL");
    $countStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $countStmt->execute();
    $unreadCount = (int)$countStmt->fetch(PDO::FETCH_ASSOC)["count"];

    $sql = "
        SELECT
            id,
            type,
            title,
            message,
            data,
            read_at,
            created_at,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
        FROM notifications
        WHERE user_id = :user_id
    ";

    if ($unreadOnly) {
        $sql .= " AND read_at IS NULL";
    }

    $sql .= " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset";

    $listStmt = $db->prepare($sql);
    $listStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $listStmt->bindValue(":limit", $limit, PDO::PARAM_INT);
    $listStmt->bindValue(":offset", $offset, PDO::PARAM_INT);
    $listStmt->execute();

    $rows = $listStmt->fetchAll(PDO::FETCH_ASSOC);

    $data = [];
    foreach ($rows as $row) {
        $decoded = null;
        if ($row["data"] !== null && $row["data"] !== "") {
            $decoded = json_decode($row["data"], true);
        }

        $data[] = [
            "id" => (int)$row["id"],
            "type" => $row["type"],
            "title" => $row["title"],
            "message" => $row["message"],
            "data" => $decoded,
            "read_at" => $row["read_at"],
            "created_at" => $row["created_at"],
            "age_seconds" => max(0, (int)$row["age_seconds"]),
        ];
    }

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "data" => $data,
        "unread_count" => $unreadCount,
    ]);

} catch (PDOException $e) {
    error_log("Get notifications error: " . $e->getMessage());
    http_response_code(500);
    if (strpos($e->getMessage(), "doesn't exist") !== false) {
        echo json_encode([
            "success" => false,
            "message" => "Notifications are not enabled yet. Run the notifications migration from database/migrations",
        ]);
        exit();
    }
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
