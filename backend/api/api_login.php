<?php
/**
 * Konek API - User Login Endpoint
 * POST /api/api_login.php
 * 
 * Request Body: { "username": "string", "password": "string" }
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

// Get JSON input
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || !isset($input["username"]) || !isset($input["password"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password are required"]);
    exit();
}

$username = trim($input["username"]);
$password = $input["password"];

if (empty($username) || empty($password)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Username and password cannot be empty"]);
    exit();
}

try {
    $db = getDBConnection();
    
    // Prepare statement to prevent SQL injection
    $stmt = $db->prepare("SELECT id, username, password_hash, active_status FROM users WHERE username = :username LIMIT 1");
    $stmt->bindParam(":username", $username, PDO::PARAM_STR);
    $stmt->execute();
    
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid username or password"]);
        exit();
    }
    
    // Check if user is active
    if (!$user["active_status"]) {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Account is deactivated"]);
        exit();
    }
    
    // Verify password
    if (!password_verify($password, $user["password_hash"])) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid username or password"]);
        exit();
    }
    
    // Generate secure auth token (64 characters)
    $authToken = bin2hex(random_bytes(32));
    
    // Update user with new auth token
    $updateStmt = $db->prepare("UPDATE users SET auth_token = :auth_token WHERE id = :id");
    $updateStmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $updateStmt->bindParam(":id", $user["id"], PDO::PARAM_INT);
    $updateStmt->execute();
    
    // Get user's squad membership
    $squadStmt = $db->prepare("
        SELECT s.id, s.squad_name, s.join_code, sm.role
        FROM squads s
        INNER JOIN squad_members sm ON s.id = sm.squad_id
        WHERE sm.user_id = :user_id
    ");
    $squadStmt->bindParam(":user_id", $user["id"], PDO::PARAM_INT);
    $squadStmt->execute();
    $squads = $squadStmt->fetchAll(PDO::FETCH_ASSOC);
    
    // Return success response with user data (excluding password hash)
    unset($user["password_hash"]);
    $user["auth_token"] = $authToken;
    $user["squads"] = $squads;
    
    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Login successful",
        "data" => $user
    ]);
    
} catch (PDOException $e) {
    error_log("Login error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}