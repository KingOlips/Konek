<?php
/**
 * Konek API - Mark Pings Read
 * POST /api/api_mark_ping_read.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "ping_ids": [1, 2, 3] }   // "ping_id": 1 also accepted
 * Response: { "success": bool, "data": { "marked": number }, "message": "string" }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";

// Only allow POST requests
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

$rawIds = [];
if (isset($input["ping_ids"]) && is_array($input["ping_ids"])) {
    $rawIds = $input["ping_ids"];
} elseif (isset($input["ping_id"])) {
    $rawIds = [$input["ping_id"]];
}

$pingIds = [];
foreach ($rawIds as $rawId) {
    $id = (int)$rawId;
    if ($id > 0) {
        $pingIds[$id] = $id;
    }
}
$pingIds = array_values($pingIds);

if (empty($pingIds)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "ping_ids is required"]);
    exit();
}

// Keep the placeholder list bounded.
$pingIds = array_slice($pingIds, 0, 100);

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

    $placeholders = [];
    foreach ($pingIds as $index => $id) {
        $placeholders[] = ":id" . $index;
    }

    $updateStmt = $db->prepare("
        UPDATE pings
        SET read_at = NOW()
        WHERE target_user_id = :user_id
          AND read_at IS NULL
          AND id IN (" . implode(", ", $placeholders) . ")
    ");
    $updateStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    foreach ($pingIds as $index => $id) {
        $updateStmt->bindValue(":id" . $index, $id, PDO::PARAM_INT);
    }
    $updateStmt->execute();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "data" => ["marked" => $updateStmt->rowCount()],
        "message" => "Pings marked read",
    ]);

} catch (PDOException $e) {
    error_log("Mark ping read error: " . $e->getMessage());
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
