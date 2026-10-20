<?php
/**
 * Konek API - Join Squad
 * POST /api/api_join_squad.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "join_code": "string" }
 * Response: { "success": bool, "data": {...}, "message": "string" }
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

if (!$input || !isset($input["join_code"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Join code is required"]);
    exit();
}

$joinCode = strtoupper(trim($input["join_code"]));

if (empty($joinCode)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Join code cannot be empty"]);
    exit();
}

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
    
    $userId = $user["id"];
    
    // Find squad by join code
    $squadStmt = $db->prepare("SELECT id, squad_name FROM squads WHERE join_code = :join_code LIMIT 1");
    $squadStmt->bindParam(":join_code", $joinCode, PDO::PARAM_STR);
    $squadStmt->execute();
    
    $squad = $squadStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$squad) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Invalid join code"]);
        exit();
    }
    
    $squadId = $squad["id"];
    $squadName = $squad["squad_name"];
    
    // Check if already a member
    $memberCheck = $db->prepare("SELECT id FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $memberCheck->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $memberCheck->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $memberCheck->execute();
    
    if ($memberCheck->fetch()) {
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "Already a member of this squad"]);
        exit();
    }
    
    // Add user to squad
    $insertStmt = $db->prepare("INSERT INTO squad_members (squad_id, user_id, role) VALUES (:squad_id, :user_id, 'member')");
    $insertStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $insertStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $insertStmt->execute();
    
    // Get member count
    $countStmt = $db->prepare("SELECT COUNT(*) as count FROM squad_members WHERE squad_id = :squad_id");
    $countStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $countStmt->execute();
    $count = $countStmt->fetch(PDO::FETCH_ASSOC);
    
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Successfully joined squad",
        "data" => [
            "id" => (int)$squadId,
            "squad_name" => $squadName,
            "join_code" => $joinCode,
            "member_count" => (int)$count["count"],
            "user_role" => "member",
        ]
    ]);
    
} catch (PDOException $e) {
    error_log("Join squad error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
