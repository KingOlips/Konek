<?php
/**
 * Konek API - Get Pending Pings
 * GET /api/api_get_pings.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "data": [...], "message": "string" }
 *
 * Returns every unread ping addressed to the signed-in user, oldest first.
 * `age_seconds` is computed by MySQL so the app never has to guess time zones
 * when deciding whether a ping is fresh enough to buzz for.
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

// Only allow GET requests
if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();

try {
    $db = getDBConnection();

    // Get user ID from auth token
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

    $pingStmt = $db->prepare("
        SELECT
            p.id,
            p.squad_id,
            p.from_user_id,
            u.username AS from_username,
            p.target_user_id,
            p.ping_type,
            p.message,
            p.created_at,
            TIMESTAMPDIFF(SECOND, p.created_at, NOW()) AS age_seconds
        FROM pings p
        INNER JOIN users u ON u.id = p.from_user_id
        WHERE p.target_user_id = :user_id
          AND p.read_at IS NULL
        ORDER BY p.created_at ASC, p.id ASC
        LIMIT 50
    ");
    $pingStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $pingStmt->execute();

    $pings = $pingStmt->fetchAll(PDO::FETCH_ASSOC);

    $data = [];
    foreach ($pings as $ping) {
        $data[] = [
            "id" => (int)$ping["id"],
            "squad_id" => $ping["squad_id"] === null ? null : (int)$ping["squad_id"],
            "from_user_id" => (int)$ping["from_user_id"],
            "from_username" => $ping["from_username"],
            "target_user_id" => (int)$ping["target_user_id"],
            "ping_type" => $ping["ping_type"],
            "message" => $ping["message"],
            "created_at" => $ping["created_at"],
            "age_seconds" => max(0, (int)$ping["age_seconds"]),
        ];
    }

    http_response_code(200);
    echo json_encode(["success" => true, "data" => $data]);

} catch (PDOException $e) {
    error_log("Get pings error: " . $e->getMessage());
    http_response_code(500);
    if (strpos($e->getMessage(), "doesn't exist") !== false) {
        echo json_encode([
            "success" => false,
            "message" => "Pings are not enabled yet. Run the pings table migration from database/schema.sql",
        ]);
        exit();
    }
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
