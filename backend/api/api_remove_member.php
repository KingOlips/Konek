<?php
/**
 * Konek API - Remove Member from Squad
 * DELETE /api/api_remove_member.php?squad_id=<id>&user_id=<id>
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Query Params: squad_id, user_id
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
$squadId = isset($_GET["squad_id"]) ? (int)$_GET["squad_id"] : null;
$targetUserId = isset($_GET["user_id"]) ? (int)$_GET["user_id"] : null;

if (!$squadId || !$targetUserId) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "squad_id and user_id are required"]);
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
    
    $currentUserId = $user["id"];
    
    // Prevent self-removal (use leave squad instead)
    if ($currentUserId === $targetUserId) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Use leave squad endpoint to remove yourself"]);
        exit();
    }
    
    // Check if current user is admin of this squad
    $adminStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $adminStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $adminStmt->bindParam(":user_id", $currentUserId, PDO::PARAM_INT);
    $adminStmt->execute();
    
    $currentUser = $adminStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$currentUser || $currentUser["role"] !== "admin") {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Only admins can remove members"]);
        exit();
    }
    
    // Check if target user is member of this squad
    $targetStmt = $db->prepare("SELECT role FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $targetStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $targetStmt->bindParam(":user_id", $targetUserId, PDO::PARAM_INT);
    $targetStmt->execute();
    
    $targetUser = $targetStmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$targetUser) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "User is not a member of this squad"]);
        exit();
    }
    
    // Prevent removing another admin
    if ($targetUser["role"] === "admin") {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Cannot remove another admin. Demote them first."]);
        exit();
    }
    
    // Remove member
    $deleteStmt = $db->prepare("DELETE FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $deleteStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $deleteStmt->bindParam(":user_id", $targetUserId, PDO::PARAM_INT);
    $deleteStmt->execute();
    
    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Member removed successfully"]);
    
} catch (PDOException $e) {
    error_log("Remove member error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
