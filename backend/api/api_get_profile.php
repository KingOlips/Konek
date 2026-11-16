<?php
/**
 * Konek API - Get Current User Profile Endpoint
 * GET /api/api_get_profile.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Response: { "success": bool, "message": "string", "data": {...} }
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

    $stmt = $db->prepare("
        SELECT id, username, email, contact_number, profile_picture, active_status, created_at
        FROM users
        WHERE auth_token = :auth_token AND active_status = 1
        LIMIT 1
    ");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    http_response_code(200);
    echo json_encode([
        "success" => true,
        "message" => "Profile loaded",
        "data" => [
            "id" => (int) $user["id"],
            "username" => $user["username"],
            "email" => $user["email"],
            "contact_number" => $user["contact_number"],
            "profile_picture" => $user["profile_picture"],
            "active_status" => (int) $user["active_status"],
            "created_at" => $user["created_at"],
        ],
    ]);
} catch (PDOException $e) {
    error_log("Get profile error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
