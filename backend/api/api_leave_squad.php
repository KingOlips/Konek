<?php
/**
 * Konek API - Leave Squad
 * DELETE /api/api_leave_squad.php?squad_id=<id>
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Query Params: squad_id
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

if (!$squadId) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Squad ID is required"]);
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
    
    // Check if user is member
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
    
    // If user is admin, check if there are other admins
    if ($member["role"] === "admin") {
        $adminCountStmt = $db->prepare("SELECT COUNT(*) as count FROM squad_members WHERE squad_id = :squad_id AND role = 'admin'");
        $adminCountStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
        $adminCountStmt->execute();
        $adminCount = $adminCountStmt->fetch(PDO::FETCH_ASSOC);
        
        if ((int)$adminCount["count"] === 1) {
            // Check if there are other members who could become admin
            $memberCountStmt = $db->prepare("SELECT COUNT(*) as count FROM squad_members WHERE squad_id = :squad_id");
            $memberCountStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
            $memberCountStmt->execute();
            $memberCount = $memberCountStmt->fetch(PDO::FETCH_ASSOC);
            
            if ((int)$memberCount["count"] > 1) {
                http_response_code(400);
                echo json_encode(["success" => false, "message" => "Cannot leave as sole admin. Promote another member first."]);
                exit();
            }
        }
    }
    
    // Remove member
    $deleteStmt = $db->prepare("DELETE FROM squad_members WHERE squad_id = :squad_id AND user_id = :user_id");
    $deleteStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $deleteStmt->bindParam(":user_id", $userId, PDO::PARAM_INT);
    $deleteStmt->execute();
    
    // If squad is now empty, delete it
    $countStmt = $db->prepare("SELECT COUNT(*) as count FROM squad_members WHERE squad_id = :squad_id");
    $countStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $countStmt->execute();
    $count = $countStmt->fetch(PDO::FETCH_ASSOC);
    
    if ((int)$count["count"] === 0) {
        $deleteSquadStmt = $db->prepare("DELETE FROM squads WHERE id = :squad_id");
        $deleteSquadStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
        $deleteSquadStmt->execute();
    }
    
    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Left squad successfully"]);
    
} catch (PDOException $e) {
    error_log("Leave squad error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
