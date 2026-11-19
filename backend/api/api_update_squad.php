<?php
/**
 * Konek API - Rename a Circle
 * PUT /api/api_update_squad.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "squad_id": int, "squad_name": "string" }
 * Response: { "success": bool, "data": { "id": int, "squad_name": string }, "message": "string" }
 *
 * Only an admin of the circle can rename it.
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

if (!$input || !isset($input["squad_id"]) || !isset($input["squad_name"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Circle ID and name are required"]);
    exit();
}

$squadId = (int)$input["squad_id"];
$squadName = trim((string)$input["squad_name"]);

if ($squadId <= 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid circle ID"]);
    exit();
}

if ($squadName === "" || strlen($squadName) > 100) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Circle name must be between 1 and 100 characters"]);
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

    $memberStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $memberStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $memberStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $memberStmt->execute();

    $member = $memberStmt->fetch(PDO::FETCH_ASSOC);

    if (!$member) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Not a member of this circle"]);
        exit();
    }

    if ($member["role"] !== "admin") {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Only circle admins can rename this circle"]);
        exit();
    }

    $updateStmt = $db->prepare("UPDATE squads SET squad_name = :squad_name WHERE id = :squad_id");
    $updateStmt->bindParam(":squad_name", $squadName, PDO::PARAM_STR);
    $updateStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $updateStmt->execute();

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Circle renamed",
        "data" => [
            "id" => $squadId,
            "squad_name" => $squadName,
        ],
    ]);

} catch (PDOException $e) {
    error_log("Update squad error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
