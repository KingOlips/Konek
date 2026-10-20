<?php
/**
 * Konek API - Get User Squads
 * GET /api/api_get_squads.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "data": [...], "message": "string" }
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
    
    $userId = $user["id"];
    
    // Get user's squads with member count
    $squadStmt = $db->prepare("
        SELECT 
            s.id,
            s.squad_name,
            s.join_code,
            s.created_at,
            sm.role,
            (SELECT COUNT(*) FROM squad_members WHERE squad_id = s.id) as member_count
        FROM squads s
        INNER JOIN squad_members sm ON s.id = sm.squad_id
        WHERE sm.user_id = :user_id
        ORDER BY s.created_at DESC
    ");
    $squadStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $squadStmt->execute();
    
    $squads = $squadStmt->fetchAll(PDO::FETCH_ASSOC);
    
    $data = [];
    foreach ($squads as $squad) {
        $data[] = [
            "id" => (int)$squad["id"],
            "squad_name" => $squad["squad_name"],
            "join_code" => $squad["join_code"],
            "created_at" => $squad["created_at"],
            "member_count" => (int)$squad["member_count"],
            "user_role" => $squad["role"],
        ];
    }
    
    http_response_code(200);
    echo json_encode(["success" => true, "data" => $data]);
    
} catch (PDOException $e) {
    error_log("Get squads error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
