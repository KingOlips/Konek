<?php
/**
 * Konek API - User Logout Endpoint
 * POST /api/api_logout.php
 * 
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "message": "string" }
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

try {
    $db = getDBConnection();
    
    // Invalidate the auth token by setting it to NULL
    $stmt = $db->prepare("UPDATE users SET auth_token = NULL WHERE auth_token = :auth_token");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    
    // Check if any row was affected (token was valid)
    if ($stmt->rowCount() > 0) {
        http_response_code(200);
        echo json_encode(["success" => true, "message" => "Logged out successfully"]);
    } else {
        // Token not found or already invalidated
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
    }
    
} catch (PDOException $e) {
    error_log("Logout error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
