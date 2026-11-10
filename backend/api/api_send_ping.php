<?php
/**
 * Konek API - Send a Ping
 * POST /api/api_send_ping.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: {
 *   "target_user_id": number,
 *   "ping_type": "whats_up" | "on_my_way" | ... | "custom",
 *   "message": "string"   // optional; required when ping_type is "custom"
 * }
 * Response: { "success": bool, "data": {...}, "message": "string" }
 *
 * The ping is stored for the recipient only. Nothing is delivered to the
 * sender's device; the recipient app picks it up with api_get_pings.php.
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

if (!$input || !isset($input["target_user_id"]) || !isset($input["ping_type"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "target_user_id and ping_type are required"]);
    exit();
}

$targetUserId = (int)$input["target_user_id"];
$pingType = trim((string)$input["ping_type"]);

$allowedTypes = [
    "whats_up",
    "on_my_way",
    "where_you_at",
    "meet_here",
    "almost_there",
    "leaving_now",
    "need_help",
    "coffee",
    "custom",
];

if ($targetUserId <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid target user"]);
    exit();
}

if (!in_array($pingType, $allowedTypes, true)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Unknown ping type"]);
    exit();
}

$message = null;
if (isset($input["message"])) {
    $message = trim((string)$input["message"]);
    if ($message === "") {
        $message = null;
    } elseif (function_exists("mb_substr")) {
        $message = mb_substr($message, 0, 120);
    } else {
        $message = substr($message, 0, 120);
    }
}

if ($pingType === "custom" && $message === null) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "A custom ping needs a message"]);
    exit();
}

try {
    $db = getDBConnection();

    // Get the sender from the auth token
    $stmt = $db->prepare("SELECT id, username FROM users WHERE auth_token = :auth_token AND active_status = 1 LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();

    $sender = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$sender) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    $senderId = (int)$sender["id"];

    if ($senderId === $targetUserId) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "You cannot ping yourself"]);
        exit();
    }

    // Resolve a squad both users belong to. This also proves the recipient is
    // a real squad mate instead of an arbitrary user id.
    $squadStmt = $db->prepare("
        SELECT s.id
        FROM squads s
        INNER JOIN squad_members sender ON sender.squad_id = s.id AND sender.user_id = :sender_id
        INNER JOIN squad_members recipient ON recipient.squad_id = s.id AND recipient.user_id = :target_user_id
        ORDER BY s.id ASC
        LIMIT 1
    ");
    $squadStmt->bindParam(":sender_id", $senderId, PDO::PARAM_INT);
    $squadStmt->bindParam(":target_user_id", $targetUserId, PDO::PARAM_INT);
    $squadStmt->execute();

    $squad = $squadStmt->fetch(PDO::FETCH_ASSOC);

    if (!$squad) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "You can only ping members of your squads"]);
        exit();
    }

    $squadId = (int)$squad["id"];

    $insertStmt = $db->prepare("
        INSERT INTO pings (squad_id, from_user_id, target_user_id, ping_type, message)
        VALUES (:squad_id, :from_user_id, :target_user_id, :ping_type, :message)
    ");
    $insertStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $insertStmt->bindParam(":from_user_id", $senderId, PDO::PARAM_INT);
    $insertStmt->bindParam(":target_user_id", $targetUserId, PDO::PARAM_INT);
    $insertStmt->bindParam(":ping_type", $pingType, PDO::PARAM_STR);
    $insertStmt->bindParam(":message", $message, PDO::PARAM_STR);
    $insertStmt->execute();

    $pingId = (int)$db->lastInsertId();

    http_response_code(201);
    echo json_encode([
        "success" => true,
        "data" => [
            "id" => $pingId,
            "squad_id" => $squadId,
            "from_user_id" => $senderId,
            "from_username" => $sender["username"],
            "target_user_id" => $targetUserId,
            "ping_type" => $pingType,
            "message" => $message,
            "created_at" => date("Y-m-d H:i:s"),
            "age_seconds" => 0,
        ],
        "message" => "Ping sent",
    ]);

} catch (PDOException $e) {
    error_log("Send ping error: " . $e->getMessage());
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
