<?php
/**
 * Konek API - Get Geofences for Squad
 * GET /api/api_get_geofences.php?squad_id=<id>
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Query Params: squad_id
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
$squadId = isset($_GET["squad_id"]) ? (int)$_GET["squad_id"] : null;

if (!$squadId) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "squad_id is required"]);
    exit();
}

try {
    $db = getDBConnection();
    
    // Get current user ID from auth token
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
    
    // Check if user is member of this squad
    $memberStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $memberStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $memberStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $memberStmt->execute();
    
    $member = $memberStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$member) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Not a member of this squad"]);
        exit();
    }
    
    // Get geofences
    $geofenceStmt = $db->prepare("
        SELECT 
            g.id,
            g.squad_id,
            g.name,
            g.latitude,
            g.longitude,
            g.radius_meters,
            g.created_by,
            g.created_at,
            u.username as creator_name
        FROM geofences g
        INNER JOIN users u ON g.created_by = u.id
        WHERE g.squad_id = :squad_id
        ORDER BY g.created_at DESC
    ");
    $geofenceStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $geofenceStmt->execute();
    
    $geofences = $geofenceStmt->fetchAll(PDO::FETCH_ASSOC);
    
    $data = [];
    foreach ($geofences as $g) {
        $data[] = [
            "id" => (int)$g["id"],
            "squad_id" => (int)$g["squad_id"],
            "name" => $g["name"],
            "latitude" => (float)$g["latitude"],
            "longitude" => (float)$g["longitude"],
            "radius_meters" => (int)$g["radius_meters"],
            "created_by" => (int)$g["created_by"],
            "creator_name" => $g["creator_name"],
            "created_at" => $g["created_at"],
        ];
    }
    
    http_response_code(200);
    echo json_encode(["success" => true, "data" => $data]);
    
} catch (PDOException $e) {
    error_log("Get geofences error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
