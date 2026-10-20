<?php
/**
 * Konek API - Update Member Role
 * PUT /api/api_update_member_role.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "squad_id": int, "user_id": int, "role": "member|admin" }
 * Response: { "success": bool, "message": "string" }
 */

require_once __DIR__ . "/../config/database.php";
require_once __DIR__ . "/../config/cors.php";



// Only allow PUT requests
if ($_SERVER["REQUEST_METHOD"] !== "PUT") {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

// Get auth token from the Authorization header (Apache may strip/rename it)
$authToken = requireBearerToken();

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["squad_id"]) || !isset($input["user_id"]) || !isset($input["role"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "squad_id, user_id, and role are required"]);
    exit();
}

$squadId = (int)$input["squad_id"];
$targetUserId = (int)$input["user_id"];
$role = $input["role"];

if (!in_array($role, ["member", "admin"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid role. Must be 'member' or 'admin'"]);
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
    
    // Prevent self-demotion from admin
    if ($currentUserId === $targetUserId && $role === "member") {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Cannot demote yourself"]);
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
        echo json_encode(["success" => false, "message" => "Only admins can change member roles"]);
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
    
    // Prevent demoting the last admin
    if ($targetUser["role"] === "admin" && $role === "member") {
        $adminCountStmt = $db->prepare("SELECT COUNT(*) as count FROM squad_members WHERE squad_id = :squad_id AND role = 'admin'");
        $adminCountStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
        $adminCountStmt->execute();
        $adminCount = $adminCountStmt->fetch(PDO::FETCH_ASSOC);
        
        if ((int)$adminCount["count"] <= 1) {
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "Cannot demote the last admin"]);
            exit();
        }
    }
    
    // Update role
    $updateStmt = $db->prepare("UPDATE squad_members SET role = :role WHERE squad_id = :squad_id AND user_id = :user_id");
    $updateStmt->bindParam(":role", $role, PDO::PARAM_STR);
    $updateStmt->bindParam(":squad_id", $squadId, PDO::PARAM_INT);
    $updateStmt->bindParam(":user_id", $targetUserId, PDO::PARAM_INT);
    $updateStmt->execute();
    
    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Member role updated successfully"]);
    
} catch (PDOException $e) {
    error_log("Update member role error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
