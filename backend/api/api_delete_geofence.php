<?php
/**
 * Konek API - Delete Geofence
 * DELETE /api/api_delete_geofence.php?id=<id>
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Query Params: id
 * Response: { "success": bool, "message": "string" }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";



// Only allow DELETE requests
if ($_SERVER["REQUEST_METHOD"] !== "DELETE") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();
$geofenceId = isset($_GET["id"]) ? (int)$_GET["id"] : null;

if (!$geofenceId) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Geofence ID is required"]);
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
    
    // Check if geofence exists and get its squad_id and creator
    $geofenceStmt = $db->prepare("SELECT squad_id, created_by FROM geofences WHERE id = :id");
    $geofenceStmt->bindParam(":id", $geofenceId, PDO::PARAM_INT);
    $geofenceStmt->execute();
    
    $geofence = $geofenceStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$geofence) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Geofence not found"]);
        exit();
    }
    
    // Check if user is admin of this squad OR the creator
    $isCreator = ($geofence["created_by"] == $userId);
    
    if (!$isCreator) {
        $adminStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
        $adminStmt->bindParam(":squad_id", $geofence["squad_id"], PDO::PARAM_INT);
        $adminStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
        $adminStmt->execute();
        
        $currentUser = $adminStmt->fetch(PDO::FETCH_ASSOC);
        
        if (!$currentUser || $currentUser["role"] !== "admin") {
            http_response_code(403);
            echo json_encode(["success" => false, "message" => "Only admins or creator can delete geofence"]);
            exit();
        }
    }
    
    // Delete geofence
    $deleteStmt = $db->prepare("DELETE FROM geofences WHERE id = :id");
    $deleteStmt->bindParam(":id", $geofenceId, PDO::PARAM_INT);
    $deleteStmt->execute();
    
    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Geofence deleted successfully"]);
    
} catch (PDOException $e) {
    error_log("Delete geofence error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
