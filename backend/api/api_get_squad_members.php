<?php
/**
 * Konek API - Get Squad Members
 * GET /api/api_get_squad_members.php?squad_id=<id>
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Query Params: squad_id (optional - defaults to user's first squad)
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
    
    // If no squad_id provided, get user's first squad
    if (!$squadId) {
        $squadStmt = $db->prepare("
            SELECT s.id 
            FROM squads s
            INNER JOIN squad_members sm ON s.id = sm.squad_id
            WHERE sm.user_id = :user_id
            LIMIT 1
        ");
        $squadStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $squadStmt->execute();
        $squad = $squadStmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$squad) {
            http_response_code(200);
            echo json_encode(["success" => true, "data" => [], "message" => "No squad found"]);
            exit();
        }
        
        $squadId = $squad["id"];
    }
    
    // Verify user is member of this squad
    $memberStmt = $db->prepare("
        SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id
    ");
    $memberStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $memberStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $memberStmt->execute();
    
    $member = $memberStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$member) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Not a member of this squad"]);
        exit();
    }
    
    // Get all members with their latest location
    $membersStmt = $db->prepare("
        SELECT 
            u.id as user_id,
            u.username,
            sm.role,
            sm.joined_at,
            l.latitude,
            l.longitude,
            l.accuracy,
            l.timestamp
        FROM squad_members sm
        INNER JOIN users u ON sm.user_id = u.id
        LEFT JOIN (
            SELECT user_id, latitude, longitude, accuracy, timestamp,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
            FROM locations
        ) l ON u.id = l.user_id AND l.rn = 1
        WHERE sm.squad_id = :squad_id
        AND u.active_status = 1
        ORDER BY 
            CASE sm.role WHEN 'admin' THEN 0 ELSE 1 END,
            u.username
    ");
    $membersStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $membersStmt->execute();
    
    $members = $membersStmt->fetchAll(PDO::FETCH_ASSOC);
    
    $data = [];
    foreach ($members as $m) {
        $data[] = [
            "user_id" => (int)$m["user_id"],
            "username" => $m["username"],
            "role" => $m["role"],
            "joined_at" => $m["joined_at"],
            "last_location" => $m["latitude"] !== null ? [
                "latitude" => (float)$m["latitude"],
                "longitude" => (float)$m["longitude"],
                "accuracy" => $m["accuracy"] !== null ? (float)$m["accuracy"] : null,
                "timestamp" => $m["timestamp"],
            ] : null,
        ];
    }
    
    http_response_code(200);
    echo json_encode(["success" => true, "data" => $data]);
    
} catch (PDOException $e) {
    error_log("Get squad members error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
