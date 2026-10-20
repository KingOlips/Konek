<?php
/**
 * Konek API - Change Password Endpoint
 * POST /api/api_change_password.php
 *
 * Headers: Authorization: Bearer <auth_token>
 * Request Body: { "current_password": "string", "new_password": "string" }
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

$input = json_decode(file_get_contents("php://input"), true);

if (!is_array($input) || empty($input["current_password"]) || empty($input["new_password"])) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Current and new password are required"]);
    exit();
}

$currentPassword = (string) $input["current_password"];
$newPassword = (string) $input["new_password"];

if (strlen($newPassword) < 6) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password must be at least 6 characters"]);
    exit();
}

if (strlen($newPassword) > 200) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password is too long"]);
    exit();
}

try {
    $db = getDBConnection();

    $stmt = $db->prepare("SELECT id, password_hash FROM users WHERE auth_token = :auth_token LIMIT 1");
    $stmt->bindParam(":auth_token", $authToken, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch();

    if (!$user) {
        http_response_code(401);
        echo json_encode(["success" => false, "message" => "Invalid or expired token"]);
        exit();
    }

    if (!password_verify($currentPassword, $user["password_hash"])) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Current password is incorrect"]);
        exit();
    }

    $newHash = password_hash($newPassword, PASSWORD_ARGON2ID);

    $update = $db->prepare("UPDATE users SET password_hash = :password_hash WHERE id = :id");
    $update->bindParam(":password_hash", $newHash, PDO::PARAM_STR);
    $update->bindParam(":id", $user["id"], PDO::PARAM_INT);
    $update->execute();

    http_response_code(200);
    echo json_encode(["success" => true, "message" => "Password updated successfully"]);
} catch (PDOException $e) {
    error_log("Change password error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Internal server error"]);
}
