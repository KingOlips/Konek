<?php
/**
 * Konek API - Get Squad Member Locations
 * GET /api/api_get_squad_locations.php?squad_id=<id>
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
    
    // Get latest location for each squad member
    $locationStmt = $db->prepare("
        SELECT 
            u.id as user_id,
            u.username,
            l.latitude,
            l.longitude,
            l.accuracy,
            l.altitude,
            l.speed,
            l.heading,
            l.timestamp,
            sm.role,
            s.id as squad_id,
            s.squad_name
        FROM squad_members sm
        INNER JOIN users u ON sm.user_id = u.id
        INNER JOIN squads s ON sm.squad_id = s.id
        LEFT JOIN (
            SELECT user_id, latitude, longitude, accuracy, altitude, speed, heading, timestamp,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) as rn
            FROM locations
        ) l ON u.id = l.user_id AND l.rn = 1
        WHERE sm.squad_id = :squad_id
        AND u.active_status = 1
        ORDER BY u.username
    ");
    $locationStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $locationStmt->execute();
    
    $locations = $locationStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Format response
    $data = [];
    foreach ($locations as $loc) {
        $data[] = [
            "user_id" => (int)$loc["user_id"],
            "username" => $loc["username"],
            "latitude" => (float)$loc["latitude"],
            "longitude" => (float)$loc["longitude"],
            "accuracy" => $loc["accuracy"] !== null ? (float)$loc["accuracy"] : null,
            "altitude" => $loc["altitude"] !== null ? (float)$loc["altitude"] : null,
            "speed" => $loc["speed"] !== null ? (float)$loc["speed"] : null,
            "heading" => $loc["heading"] !== null ? (float)$loc["heading"] : null,
            "timestamp" => $loc["timestamp"],
            "role" => $loc["role"],
            "squad_id" => (int)$loc["squad_id"],
            "squad_name" => $loc["squad_name"],
        ];
    }
    
    http_response_code(200);
    echo json_encode(["success" => true, "data" => $data]);
    
} catch (PDOException $e) {
    error_log("Get squad locations error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
