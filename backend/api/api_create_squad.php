<?php
/**
 * Konek API - Create Squad
 * POST /api/api_create_squad.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "squad_name": "string" }
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

if (!$input || !isset($input["squad_name"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Squad name is required"]);
    exit();
}

$squadName = trim($input["squad_name"]);

if (empty($squadName)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Squad name cannot be empty"]);
    exit();
}

if (strlen($squadName) > 100) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Squad name too long (max 100 characters)"]);
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
    
    // Generate unique join code
    $joinCode = "";
    $maxAttempts = 10;
    for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
        $joinCode = strtoupper(substr(md5(uniqid(rand(), true)), 0, 8));
        $checkStmt = $db->prepare("SELECT id FROM squads WHERE join_code = :join_code");
        $checkStmt->bindParam(":join_code", $joinCode, PDO::PARAM_STR);
        $checkStmt->execute();
        if (!$checkStmt->fetch()) {
            break;
        }
    }
    
    if ($attempt >= $maxAttempts) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to generate unique join code"]);
        exit();
    }
    
    // Create squad
    $db->beginTransaction();
    
    try {
        $insertStmt = $db->prepare("INSERT INTO squads (squad_name, join_code) VALUES (:squad_name, :join_code)");
        $insertStmt->bindParam(":squad_name", $squadName, PDO::PARAM_STR);
        $insertStmt->bindParam(":join_code", $joinCode, PDO::PARAM_STR);
        $insertStmt->execute();
        
        $squadId = $db->lastInsertId();
        
        // Add creator as admin
        $memberStmt = $db->prepare("INSERT INTO squad_members (squad_id, user_id, role) VALUES (:squad_id, :user_id, 'admin')");
        $memberStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
        $memberStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $memberStmt->execute();
        
        $db->commit();
        
        http_response_code(201);
        echo json_encode([
            "success" => true,
            "message" => "Squad created successfully",
            "data" => [
                "id" => (int)$squadId,
                "squad_name" => $squadName,
                "join_code" => $joinCode,
                "created_at" => date("Y-m-d H:i:s"),
                "member_count" => 1,
                "user_role" => "admin",
            ]
        ]);
        
    } catch (Exception $e) {
        $db->rollBack();
        throw $e;
    }
    
} catch (PDOException $e) {
    error_log("Create squad error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
